import { ComponentBridge, type ComponentBridgeOptions } from '../bridge/ComponentBridge'
import type { ContextItem, Environment, SaveStatus } from '../bridge/types'
import {
  FontImportError,
  addFaceToLibrary,
  groupFamilies,
  importFontFile,
  parseStoredFaces,
} from '../fonts/library'
import { FontRegistry } from '../fonts/registry'
import { sameFontRef } from '../fonts/stack'
import type { FontRef, StoredFontFace } from '../fonts/types'
import { NoteSession } from '../note/NoteSession'
import { DEFAULT_SETTINGS, parseSettings, uniqueNames, type Settings, type View } from '../settings'

const SETTINGS_KEY = 'settings'
const FONTS_KEY = 'fonts'
/** Longest we hide the note while waiting for its font, to avoid a flash of the fallback font. */
const FONT_WAIT_MS = 1000

export interface NoteState {
  uuid: string
  locked: boolean
  spellcheck: boolean
  /** Font chosen for this note only. */
  textFont?: FontRef
  /** Increments whenever the text changes outside the editor and must be re-applied. */
  revision: number
}

export interface AppState {
  /** False until the note is loaded and its fonts are ready. */
  ready: boolean
  environment?: Environment
  settings: Settings
  library: StoredFontFace[]
  note?: NoteState
  view: View
  saveStatus: SaveStatus
  /** Problems loading imported fonts on this device. */
  fontErrors: string[]
}

export interface ImportResult {
  imported: string[]
  /** Files that had to be repaired before the browser would load them. */
  repaired: string[]
  errors: string[]
  /** Family that became the text font for all notes because none was chosen yet. */
  defaultFamily?: string
}

export class AppController {
  private state: AppState = {
    ready: false,
    settings: DEFAULT_SETTINGS,
    library: [],
    view: DEFAULT_SETTINGS.defaultView,
    saveStatus: 'saved',
    fontErrors: [],
  }
  private readonly listeners = new Set<() => void>()
  private readonly bridge: ComponentBridge
  private readonly session: NoteSession
  private readonly registry = new FontRegistry()

  constructor(
    options: {
      onThemesChange?: () => void
      /** Lets tests talk to the bridge without a real Standard Notes parent window. */
      bridge?: Pick<ComponentBridgeOptions, 'window' | 'parent' | 'componentDataDelayMs'>
    } = {},
  ) {
    this.bridge = new ComponentBridge({
      ...options.bridge,
      onReady: () => this.handleReady(),
      onThemesChange: options.onThemesChange,
      onSaveStatusChange: (saveStatus) => this.setState({ saveStatus }),
    })
    this.session = new NoteSession(this.bridge)
    this.bridge.streamContextItem((item) => this.handleItem(item))
  }

  destroy(): void {
    this.bridge.destroy()
    this.listeners.clear()
  }

  readonly getState = (): AppState => this.state

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** The editor's current text. Read on demand so typing does not re-render the app. */
  get noteText(): string {
    return this.session.text
  }

  editText(text: string): void {
    this.session.editText(text)
  }

  setView(view: View): void {
    this.setState({ view })
  }

  updateSettings(patch: Partial<Settings>): void {
    const { settings } = this.state
    const unchanged = Object.entries(patch).every(
      ([key, value]) => JSON.stringify(settings[key as keyof Settings]) === JSON.stringify(value),
    )
    // Every write re-uploads the plugin's synced data, imported fonts included.
    if (!unchanged) {
      this.saveSettings({ ...settings, ...patch })
    }
  }

  setNoteFont(ref: FontRef | undefined): void {
    const note = this.state.note
    if (!note || note.locked) {
      return
    }
    this.session.setTextFont(ref)
    this.setState({ note: { ...note, textFont: this.session.textFont } })
    void this.loadFontsInUse()
  }

  async importFontFiles(files: File[]): Promise<ImportResult> {
    const result: ImportResult = { imported: [], repaired: [], errors: [] }
    let library = this.state.library
    let firstImported: StoredFontFace | undefined
    for (const file of files) {
      try {
        const { face, repaired } = await importFontFile(file, library)
        library = addFaceToLibrary(library, face)
        firstImported ??= face
        result.imported.push(face.family)
        if (repaired) {
          result.repaired.push(file.name)
        }
      } catch (error) {
        result.errors.push(
          error instanceof FontImportError ? error.message : `${file.name} could not be imported: ${String(error)}`,
        )
      }
    }
    if (firstImported) {
      this.saveLibrary(library)
      // Importing a font usually means wanting to read in it; a font already chosen is kept.
      if (this.state.settings.textFont.type === 'theme') {
        this.useForAllNotes(firstImported.familyId)
        result.defaultFamily = firstImported.family
      }
      await this.loadAllImportedFonts()
    }
    return result
  }

  /** Makes an imported font the text font for all notes. */
  useForAllNotes(familyId: string): void {
    this.updateSettings({ textFont: { type: 'imported', familyId } })
  }

  renameFamily(familyId: string, name: string): void {
    const family = name.trim()
    if (!family) {
      return
    }
    this.saveLibrary(this.state.library.map((face) => (face.familyId === familyId ? { ...face, family } : face)))
  }

  removeFamily(familyId: string): void {
    this.saveLibrary(this.state.library.filter((face) => face.familyId !== familyId))
    const removed: FontRef = { type: 'imported', familyId }
    this.resetSettingsUsing(removed)
  }

  addInstalledFont(name: string): void {
    this.updateSettings({ installedFonts: uniqueNames([...this.state.settings.installedFonts, name]) })
  }

  removeInstalledFont(name: string): void {
    this.updateSettings({ installedFonts: this.state.settings.installedFonts.filter((font) => font !== name) })
    this.resetSettingsUsing({ type: 'installed', family: name })
  }

  /** Makes every imported font available, e.g. for previews in the settings panel. */
  loadAllImportedFonts(): Promise<void> {
    const familyIds = groupFamilies(this.state.library).map((family) => family.familyId)
    return this.loadFamilies(familyIds)
  }

  private handleReady(): void {
    const settings = parseSettings(this.bridge.getComponentData(SETTINGS_KEY))
    const library = parseStoredFaces(this.bridge.getComponentData(FONTS_KEY))
    this.setState({ settings, library, view: settings.defaultView, environment: this.bridge.environment })
  }

  private handleItem(item: ContextItem): void {
    const update = this.session.receive(item)
    const previous = this.state.note
    const note: NoteState = {
      uuid: item.uuid,
      locked: this.session.locked,
      spellcheck: this.session.spellcheck,
      textFont: this.session.textFont,
      revision: (previous?.revision ?? 0) + (update === 'metadata-changed' ? 0 : 1),
    }

    if (update !== 'loaded') {
      this.setState({ note })
      if (!sameFontRef(previous?.textFont, note.textFont)) {
        void this.loadFontsInUse()
      }
      return
    }

    this.setState({ note, view: this.state.settings.defaultView })
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, FONT_WAIT_MS))
    void Promise.race([this.loadFontsInUse(), timeout]).then(() => this.setState({ ready: true }))
  }

  private saveSettings(settings: Settings): void {
    this.setState({ settings })
    this.bridge.setComponentData(SETTINGS_KEY, settings)
    void this.loadFontsInUse()
  }

  private saveLibrary(library: StoredFontFace[]): void {
    this.setState({ library })
    this.bridge.setComponentData(FONTS_KEY, library)
    this.registry.prune(library)
  }

  /** Points settings that use a font which no longer exists back to the defaults. */
  private resetSettingsUsing(ref: FontRef): void {
    const { settings } = this.state
    const patch: Partial<Settings> = {}
    if (sameFontRef(settings.textFont, ref)) {
      patch.textFont = DEFAULT_SETTINGS.textFont
    }
    if (sameFontRef(settings.codeFont, ref)) {
      patch.codeFont = DEFAULT_SETTINGS.codeFont
    }
    if (Object.keys(patch).length > 0) {
      this.updateSettings(patch)
    }
  }

  private loadFontsInUse(): Promise<void> {
    const { settings, note } = this.state
    const familyIds = [settings.textFont, settings.codeFont, note?.textFont]
      .filter((ref): ref is Extract<FontRef, { type: 'imported' }> => ref?.type === 'imported')
      .map((ref) => ref.familyId)
    return this.loadFamilies(familyIds)
  }

  private async loadFamilies(familyIds: string[]): Promise<void> {
    const library = this.state.library
    const errors: string[] = []
    await Promise.all(
      Array.from(new Set(familyIds)).map((familyId) =>
        this.registry.ensureFamily(familyId, library).catch(() => {
          const family = library.find((face) => face.familyId === familyId)?.family ?? 'An imported font'
          errors.push(`${family} could not be loaded on this device.`)
        }),
      ),
    )
    if (errors.length > 0 || this.state.fontErrors.length > 0) {
      this.setState({ fontErrors: errors })
    }
  }

  private setState(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) {
      listener()
    }
  }
}

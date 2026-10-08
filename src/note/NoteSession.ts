import { SN_APP_DOMAIN, type ContextItem } from '../bridge/types'
import { parseFontRef } from '../fonts/stack'
import type { FontRef } from '../fonts/types'
import { makePreview } from './preview'

export type NoteUpdate =
  /** A different note was loaded. */
  | 'loaded'
  /** The text was changed outside this editor (another device, the history panel, ...). */
  | 'text-changed'
  /** Only metadata changed: lock state, spellcheck, or our own save coming back from sync. */
  | 'metadata-changed'

export interface SaveScheduler {
  scheduleSave(buildItem: () => ContextItem | undefined): void
  flush(): void
}

/** Tracks the note being edited and decides what to save and what to apply from Standard Notes. */
export class NoteSession {
  private item?: ContextItem
  private currentText = ''
  /** The text Standard Notes has, as far as this editor knows. */
  private savedText = ''
  private pendingClientData?: Record<string, unknown>

  constructor(private readonly scheduler: SaveScheduler) {}

  get uuid(): string | undefined {
    return this.item?.uuid
  }

  get text(): string {
    return this.currentText
  }

  get locked(): boolean {
    return this.item?.content.appData?.[SN_APP_DOMAIN]?.locked === true
  }

  get spellcheck(): boolean {
    return this.item?.content.spellcheck !== false
  }

  /** Font chosen for this note only, if any. */
  get textFont(): FontRef | undefined {
    return parseFontRef({ ...this.item?.clientData, ...this.pendingClientData }.textFont)
  }

  receive(item: ContextItem): NoteUpdate {
    const isNewNote = this.item?.uuid !== item.uuid
    this.item = item
    const incomingText = typeof item.content.text === 'string' ? item.content.text : ''

    if (isNewNote) {
      this.pendingClientData = undefined
      this.currentText = incomingText
      this.savedText = incomingText
      return 'loaded'
    }
    if (incomingText === this.currentText) {
      this.savedText = incomingText
      return 'metadata-changed'
    }
    if (item.isMetadataUpdate || this.currentText !== this.savedText) {
      // Either our own save echoing back, or unsaved local edits that are newer than this
      // update. The pending save carries the editor's text.
      return 'metadata-changed'
    }
    this.currentText = incomingText
    this.savedText = incomingText
    return 'text-changed'
  }

  editText(text: string): void {
    if (text === this.currentText) {
      return
    }
    this.currentText = text
    this.scheduler.scheduleSave(this.buildSave)
  }

  /** Overrides the text font for this note only; `undefined` goes back to the default. */
  setTextFont(ref: FontRef | undefined): void {
    this.pendingClientData = { ...this.pendingClientData, textFont: ref ?? null }
    this.scheduler.scheduleSave(this.buildSave)
    this.scheduler.flush()
  }

  private readonly buildSave = (): ContextItem | undefined => {
    const item = this.item
    if (!item || this.locked) {
      return undefined
    }
    const next: ContextItem = {
      ...item,
      content: {
        ...item.content,
        text: this.currentText,
        preview_plain: makePreview(this.currentText),
        preview_html: null,
      },
    }
    if (this.pendingClientData) {
      next.clientData = { ...item.clientData, ...this.pendingClientData }
      this.pendingClientData = undefined
    }
    this.savedText = this.currentText
    this.item = next
    return next
  }
}

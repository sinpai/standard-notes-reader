// @vitest-environment jsdom
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppController } from '../src/app/AppController'
import type { StoredFontFace } from '../src/fonts/types'
import { buildSfnt } from './helpers/sfnt'

const ORIGIN = 'https://app.standardnotes.com'

const importedFace: StoredFontFace = {
  id: 'face-1',
  familyId: 'fam1',
  family: 'Literata',
  weight: 400,
  italic: false,
  fileName: 'Literata.ttf',
  format: 'truetype',
  size: 10,
  encoding: 'base64',
  data: 'AAAA',
  addedAt: 0,
}

/** Creates a controller that Standard Notes has registered with the given plugin data. */
function startController(componentData: Record<string, unknown>) {
  const parent = new JSDOM('').window as unknown as Window
  const postMessage = vi.fn()
  parent.postMessage = postMessage as unknown as Window['postMessage']
  const controller = new AppController({ bridge: { window, parent, componentDataDelayMs: 100 } })
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: ORIGIN,
      source: parent,
      data: {
        action: 'component-registered',
        sessionKey: 'session',
        componentData,
        data: { environment: 'web' },
      },
    }),
  )
  const posted = (action: string) =>
    postMessage.mock.calls.map(([message]) => message as { action: string; data: any }).filter((m) => m.action === action)
  return { controller, posted }
}

describe('AppController', () => {
  let controller: AppController
  let posted: ReturnType<typeof startController>['posted']

  beforeEach(() => {
    vi.useFakeTimers()
    ;({ controller, posted } = startController({
      settings: { textFont: { type: 'imported', familyId: 'fam1' }, width: 'medium' },
      fonts: [importedFace],
    }))
  })

  afterEach(() => {
    controller.destroy()
    vi.useRealTimers()
  })

  it('loads settings and imported fonts from the synced plugin data', () => {
    const state = controller.getState()
    expect(state.settings.textFont).toEqual({ type: 'imported', familyId: 'fam1' })
    expect(state.library).toEqual([importedFace])
  })

  it('does not rewrite the synced data when a setting is set to its current value', () => {
    controller.updateSettings({ width: 'medium' })
    vi.advanceTimersByTime(200)
    expect(posted('set-component-data')).toHaveLength(0)

    controller.updateSettings({ width: 'wide' })
    vi.advanceTimersByTime(200)
    const writes = posted('set-component-data')
    expect(writes).toHaveLength(1)
    expect(writes[0]!.data.componentData.settings.width).toBe('wide')
    // Fonts are kept when settings change: the app replaces the plugin's data as a whole.
    expect(writes[0]!.data.componentData.fonts).toEqual([importedFace])
  })

  it('falls back to the default font when the font in use is deleted', () => {
    controller.removeFamily('fam1')
    vi.advanceTimersByTime(200)
    expect(controller.getState().settings.textFont).toEqual({ type: 'theme' })
    const [write] = posted('set-component-data')
    expect(write!.data.componentData).toMatchObject({ fonts: [], settings: { textFont: { type: 'theme' } } })
  })
})

describe('AppController font import', () => {
  let controller: AppController
  const fontFile = () => new File([buildSfnt({ family: 'Literaturnaya 20', weight: 400 }) as BlobPart], 'Literaturnaya20-Regular.ttf')

  beforeEach(() => {
    // jsdom has no font engine: accept every font.
    vi.stubGlobal(
      'FontFace',
      class {
        load() {
          return Promise.resolve(this)
        }
      },
    )
  })

  afterEach(() => {
    controller.destroy()
    vi.unstubAllGlobals()
  })

  it('uses the first imported font for all notes while none has been chosen', async () => {
    ;({ controller } = startController({}))
    const result = await controller.importFontFiles([fontFile()])

    const [face] = controller.getState().library
    expect(result.defaultFamily).toBe('Literaturnaya 20')
    expect(controller.getState().settings.textFont).toEqual({ type: 'imported', familyId: face!.familyId })
  })

  it('keeps a text font that was already chosen', async () => {
    const chosen = { type: 'installed', family: 'Georgia' }
    ;({ controller } = startController({ settings: { textFont: chosen } }))
    const result = await controller.importFontFiles([fontFile()])

    expect(result.defaultFamily).toBeUndefined()
    expect(controller.getState().settings.textFont).toEqual(chosen)
  })

  it('switches all notes to an imported font in one step', () => {
    ;({ controller } = startController({ fonts: [importedFace] }))
    controller.useForAllNotes('fam1')
    expect(controller.getState().settings.textFont).toEqual({ type: 'imported', familyId: 'fam1' })
  })
})

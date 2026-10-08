// @vitest-environment jsdom
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppController } from '../src/app/AppController'
import type { StoredFontFace } from '../src/fonts/types'

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

describe('AppController', () => {
  let parent: Window
  let postMessage: ReturnType<typeof vi.fn>
  let controller: AppController

  const posted = (action: string) =>
    postMessage.mock.calls.map(([message]) => message as { action: string; data: any }).filter((m) => m.action === action)

  beforeEach(() => {
    vi.useFakeTimers()
    parent = new JSDOM('').window as unknown as Window
    postMessage = vi.fn()
    parent.postMessage = postMessage as unknown as Window['postMessage']
    controller = new AppController({ bridge: { window, parent, componentDataDelayMs: 100 } })
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: ORIGIN,
        source: parent,
        data: {
          action: 'component-registered',
          sessionKey: 'session',
          componentData: {
            settings: { textFont: { type: 'imported', familyId: 'fam1' }, width: 'medium' },
            fonts: [importedFace],
          },
          data: { environment: 'web' },
        },
      }),
    )
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

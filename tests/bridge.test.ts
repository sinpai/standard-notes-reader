// @vitest-environment jsdom
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ComponentBridge } from '../src/bridge/ComponentBridge'
import type { ContextItem, SaveStatus } from '../src/bridge/types'

const APP_ORIGIN = 'https://app.standardnotes.com'

type Posted = { action: string; data: Record<string, any>; messageId: string; sessionKey: string; api: string }

describe('ComponentBridge', () => {
  let parent: Window
  let postMessage: ReturnType<typeof vi.fn>
  let bridge: ComponentBridge
  let statuses: SaveStatus[]

  /** Messages the editor sent to Standard Notes. */
  const posted = (): Posted[] =>
    postMessage.mock.calls.map(([message]) => (typeof message === 'string' ? JSON.parse(message) : message))
  const postedActions = () => posted().map((message) => message.action)
  const lastPosted = (action: string) => posted().filter((message) => message.action === action).at(-1)!

  function fromApp(data: unknown, options: { origin?: string; source?: Window } = {}) {
    window.dispatchEvent(
      new MessageEvent('message', { data, origin: options.origin ?? APP_ORIGIN, source: options.source ?? parent }),
    )
  }

  function register(overrides: Record<string, unknown> = {}, environment = 'web', origin = APP_ORIGIN) {
    const message = {
      action: 'component-registered',
      sessionKey: 'session-1',
      componentData: { settings: { fontSize: 20 } },
      data: { uuid: 'component-1', environment, platform: 'macos', activeThemeUrls: [] },
      ...overrides,
    }
    fromApp(environment === 'mobile' ? JSON.stringify(message) : message, { origin })
  }

  function replyTo(action: string, data: Record<string, unknown>) {
    fromApp({ action: 'reply', original: { messageId: lastPosted(action).messageId }, data })
  }

  function note(text: string, uuid = 'note-1'): ContextItem {
    return { uuid, content_type: 'Note', content: { title: 'Note', text } }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    parent = new JSDOM('').window as unknown as Window
    postMessage = vi.fn()
    parent.postMessage = postMessage as unknown as Window['postMessage']
    statuses = []
    bridge = new ComponentBridge({
      window,
      parent,
      saveDelayMs: 100,
      componentDataDelayMs: 100,
      saveTimeoutMs: 1000,
      onSaveStatusChange: (status) => statuses.push(status),
    })
  })

  afterEach(() => {
    bridge.destroy()
    document.head.querySelectorAll('link').forEach((link) => link.remove())
    vi.useRealTimers()
  })

  it('queues requests until Standard Notes registers the editor', () => {
    const onItem = vi.fn()
    bridge.streamContextItem(onItem)
    expect(postMessage).not.toHaveBeenCalled()

    register()
    expect(bridge.isRegistered).toBe(true)
    expect(bridge.getComponentData('settings')).toEqual({ fontSize: 20 })
    expect(posted()[0]).toMatchObject({ action: 'stream-context-item', sessionKey: 'session-1', api: 'component' })
    expect(postedActions()).toContain('themes-activated')
    expect(postMessage.mock.calls[0]![1]).toBe(APP_ORIGIN)
  })

  it('ignores messages that do not come from the parent window', () => {
    register({}, 'web')
    const before = postMessage.mock.calls.length
    fromApp({ action: 'themes', data: { themes: ['https://evil.example/theme.css'] } }, { source: window })
    fromApp({ action: 'themes', data: { themes: ['https://evil.example/theme.css'] } }, { origin: 'https://evil.example' })
    expect(document.querySelectorAll('link').length).toBe(0)
    expect(postMessage.mock.calls.length).toBe(before)
  })

  it('delivers every update of the note to the stream callback', () => {
    const onItem = vi.fn()
    register()
    bridge.streamContextItem(onItem)
    replyTo('stream-context-item', { item: note('one') })
    replyTo('stream-context-item', { item: note('two') })
    expect(onItem.mock.calls.map(([item]) => item.content.text)).toEqual(['one', 'two'])
  })

  it('coalesces saves and sends the latest state', () => {
    register()
    let text = 'a'
    const build = () => ({ ...note(text), isMetadataUpdate: true })
    bridge.scheduleSave(build)
    text = 'ab'
    bridge.scheduleSave(build)
    expect(statuses).toEqual(['saving'])
    expect(postedActions()).not.toContain('save-items')

    vi.advanceTimersByTime(100)
    const save = lastPosted('save-items')
    expect(postedActions().filter((action) => action === 'save-items')).toHaveLength(1)
    expect(save.data.items[0].content.text).toBe('ab')
    expect(save.data.items[0]).not.toHaveProperty('isMetadataUpdate')

    replyTo('save-items', {})
    expect(statuses).toEqual(['saving', 'saved'])
  })

  it('reports saves that fail or are never confirmed', () => {
    register()
    bridge.scheduleSave(() => note('x'))
    bridge.flush()
    replyTo('save-items', { error: 'save-error' })
    expect(statuses.at(-1)).toBe('error')

    bridge.scheduleSave(() => note('xy'))
    bridge.flush()
    replyTo('save-items', {})
    expect(statuses.at(-1)).toBe('saved')

    bridge.scheduleSave(() => note('xyz'))
    bridge.flush()
    vi.advanceTimersByTime(1000)
    expect(statuses.at(-1)).toBe('error')
  })

  it('saves the previous note before switching to another one', () => {
    const received: string[] = []
    register()
    bridge.streamContextItem((item) => received.push(item.uuid))
    replyTo('stream-context-item', { item: note('first') })
    bridge.scheduleSave(() => note('first, edited'))

    replyTo('stream-context-item', { item: note('second', 'note-2') })
    expect(lastPosted('save-items').data.items[0]).toMatchObject({ uuid: 'note-1', content: { text: 'first, edited' } })
    expect(received).toEqual(['note-1', 'note-2'])
  })

  it('saves pending work when the editor loses focus', () => {
    register()
    bridge.scheduleSave(() => note('typed just before switching notes'))
    window.dispatchEvent(new Event('blur'))
    expect(postedActions()).toContain('save-items')
  })

  it('writes plugin data in one debounced message with all keys', () => {
    register()
    bridge.setComponentData('settings', { fontSize: 18 })
    bridge.setComponentData('fonts', [])
    expect(postedActions()).not.toContain('set-component-data')

    vi.advanceTimersByTime(100)
    expect(lastPosted('set-component-data').data).toEqual({ componentData: { settings: { fontSize: 18 }, fonts: [] } })
    expect(postedActions().filter((action) => action === 'set-component-data')).toHaveLength(1)
  })

  it('speaks JSON strings on mobile, where the app origin is "null"', () => {
    register({}, 'mobile', 'null')
    expect(bridge.environment).toBe('mobile')
    bridge.streamContextItem(() => {})
    const [message, targetOrigin] = postMessage.mock.calls.at(-1)!
    expect(typeof message).toBe('string')
    expect(targetOrigin).toBe('*')

    const onItem = vi.fn()
    bridge.streamContextItem(onItem)
    fromApp(
      JSON.stringify({ action: 'reply', original: { messageId: lastPosted('stream-context-item').messageId }, data: { item: note('hi') } }),
      { origin: 'null' },
    )
    expect(onItem).toHaveBeenCalledOnce()
  })

  it('applies and removes Standard Notes themes', () => {
    register({ data: { environment: 'web', activeThemeUrls: ['https://themes.example/a.css'] } })
    expect(Array.from(document.querySelectorAll('link.sn-theme'), (link) => link.getAttribute('href'))).toEqual([
      'https://themes.example/a.css',
    ])

    fromApp({ action: 'themes', data: { themes: ['https://themes.example/b.css'] } })
    expect(Array.from(document.querySelectorAll('link.sn-theme'), (link) => link.getAttribute('href'))).toEqual([
      'https://themes.example/b.css',
    ])
  })

  it('forwards app shortcuts but keeps text editing keys in the editor', () => {
    register()
    const press = (init: KeyboardEventInit) => window.dispatchEvent(new KeyboardEvent('keydown', init))

    press({ key: 'f', code: 'KeyF', metaKey: true, shiftKey: true })
    press({ key: 'a', code: 'KeyA', metaKey: true })
    press({ key: 'Backspace', code: 'Backspace', ctrlKey: true })
    press({ key: 'x', code: 'KeyX' })

    const keys = posted().filter((message) => message.action === 'key-down')
    expect(keys).toHaveLength(1)
    expect(keys[0]!.data).toMatchObject({ key: 'f', code: 'KeyF', metaKey: true, shiftKey: true, keyboardModifier: 'Shift' })
  })
})

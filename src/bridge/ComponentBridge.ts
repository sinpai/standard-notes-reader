import { randomId } from '../util/random'
import {
  Action,
  type ComponentData,
  type ContextItem,
  type Environment,
  type IncomingMessage,
  type OutgoingMessage,
  type RegistrationInfo,
  type SaveStatus,
} from './types'

type ReplyCallback = (data: Record<string, unknown>) => void

interface PendingMessage {
  action: string
  data: Record<string, unknown>
  callback?: ReplyCallback
  /** Stream subscriptions receive many replies to the same message. */
  persistent: boolean
}

export interface ComponentBridgeOptions {
  /** The editor's window. Defaults to the global window. */
  window?: Window
  /** The Standard Notes window. Defaults to `window.parent`. */
  parent?: Window
  /** Keystrokes within this window are coalesced into a single save. */
  saveDelayMs?: number
  /** Settings changes within this window are coalesced into a single write. */
  componentDataDelayMs?: number
  /** A save that Standard Notes has not confirmed within this time is reported as failed. */
  saveTimeoutMs?: number
  onReady?: (info: RegistrationInfo) => void
  onThemesChange?: () => void
  onSaveStatusChange?: (status: SaveStatus) => void
}

const MODIFIER_KEYS = ['Control', 'Shift', 'Meta', 'Alt']

/**
 * Standard Notes runs forwarded shortcuts against the whole app, where these mean "move note to
 * trash" (Mod+Backspace) or "select all notes" (Mod+A). Inside the editor they edit text, so they
 * stay here.
 */
const TEXT_EDITING_KEYS = new Set(['a', 'c', 'v', 'x', 'y', 'z', 'backspace', 'delete'])

/**
 * Talks to Standard Notes over postMessage. Implements the same protocol as
 * `@standardnotes/component-relay` 2.3.2 (the version the app itself pins), which is not
 * published to npm; the npm release (2.2.2) breaks on mobile, where the app's origin is "null".
 */
export class ComponentBridge {
  private readonly win: Window
  private readonly parent: Window
  private readonly saveDelayMs: number
  private readonly componentDataDelayMs: number
  private readonly saveTimeoutMs: number
  private readonly options: ComponentBridgeOptions

  private sessionKey?: string
  private parentOrigin?: string
  private info: RegistrationInfo = {}
  private componentData: ComponentData = {}
  private readonly queue: PendingMessage[] = []
  private readonly callbacks = new Map<string, { callback: ReplyCallback; persistent: boolean }>()
  private readonly themeLinks = new Map<string, HTMLLinkElement>()
  private lastStreamedUuid?: string

  private buildPendingSave?: () => ContextItem | undefined
  private saveTimer?: ReturnType<typeof setTimeout>
  private readonly savesInFlight = new Set<object>()
  private saveFailed = false
  private lastSaveStatus?: SaveStatus

  private componentDataDirty = false
  private componentDataTimer?: ReturnType<typeof setTimeout>

  private readonly removeListeners: Array<() => void> = []

  constructor(options: ComponentBridgeOptions = {}) {
    this.options = options
    this.win = options.window ?? window
    this.parent = options.parent ?? this.win.parent
    this.saveDelayMs = options.saveDelayMs ?? 250
    this.componentDataDelayMs = options.componentDataDelayMs ?? 500
    this.saveTimeoutMs = options.saveTimeoutMs ?? 5000

    this.listen(this.win, 'message', this.onMessage)
    this.listen(this.win, 'keydown', (event) => this.forwardKeyboardEvent(Action.KeyDown, event))
    this.listen(this.win, 'keyup', (event) => this.forwardKeyboardEvent(Action.KeyUp, event))
    this.listen(this.win, 'click', () => {
      if (this.sessionKey) {
        this.post(Action.Click, {})
      }
    })
    // Standard Notes replaces the iframe when another note is opened. Commit unsaved work as soon
    // as the editor loses focus so nothing is lost in between.
    this.listen(this.win, 'blur', () => this.flush())
    this.listen(this.win, 'pagehide', () => this.flush())
    this.listen(this.win.document, 'visibilitychange', () => {
      if (this.win.document.visibilityState === 'hidden') {
        this.flush()
      }
    })
  }

  get isRegistered(): boolean {
    return this.sessionKey !== undefined
  }

  get environment(): Environment | undefined {
    return this.info.environment
  }

  get platform(): string | undefined {
    return this.info.platform
  }

  getComponentData(key: string): unknown {
    return this.componentData[key]
  }

  /** Stores a value in this plugin's preferences, which Standard Notes syncs (encrypted). */
  setComponentData(key: string, value: unknown): void {
    if (!this.sessionKey) {
      throw new Error('Cannot store plugin data before Standard Notes has registered the editor')
    }
    this.componentData = { ...this.componentData, [key]: value }
    this.componentDataDirty = true
    clearTimeout(this.componentDataTimer)
    this.componentDataTimer = setTimeout(() => this.flushComponentData(), this.componentDataDelayMs)
  }

  /** Subscribes to the note being edited. Called again whenever the note changes. */
  streamContextItem(callback: (item: ContextItem) => void): void {
    this.post(
      Action.StreamContextItem,
      {},
      (data) => {
        const item = data.item
        if (!isContextItem(item)) {
          return
        }
        if (this.lastStreamedUuid !== undefined && this.lastStreamedUuid !== item.uuid) {
          // Commit work on the previous note before the UI switches to the new one.
          this.flushSave()
        }
        this.lastStreamedUuid = item.uuid
        callback(item)
      },
      true,
    )
  }

  /**
   * Schedules a save. Rapid calls are coalesced; `buildItem` runs right before the message is
   * sent so the save always carries the latest editor state.
   */
  scheduleSave(buildItem: () => ContextItem | undefined): void {
    this.buildPendingSave = buildItem
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.flushSave(), this.saveDelayMs)
    this.emitSaveStatus()
  }

  /** Sends any pending save and settings change immediately. */
  flush(): void {
    this.flushSave()
    this.flushComponentData()
  }

  destroy(): void {
    this.flush()
    clearTimeout(this.saveTimer)
    clearTimeout(this.componentDataTimer)
    for (const remove of this.removeListeners.splice(0)) {
      remove()
    }
    this.callbacks.clear()
  }

  private flushSave(): void {
    clearTimeout(this.saveTimer)
    this.saveTimer = undefined
    const buildItem = this.buildPendingSave
    this.buildPendingSave = undefined
    const item = buildItem?.()
    if (!item) {
      this.emitSaveStatus()
      return
    }

    const save = {}
    this.savesInFlight.add(save)
    const watchdog = setTimeout(() => {
      if (this.savesInFlight.delete(save)) {
        this.saveFailed = true
        this.emitSaveStatus()
      }
    }, this.saveTimeoutMs)

    this.post(Action.SaveItems, { items: [toTransferItem(item)] }, (reply) => {
      clearTimeout(watchdog)
      this.savesInFlight.delete(save)
      // Every save carries the full note, so a later success supersedes an earlier failure.
      this.saveFailed = reply.error !== undefined
      this.emitSaveStatus()
    })
    this.emitSaveStatus()
  }

  private flushComponentData(): void {
    clearTimeout(this.componentDataTimer)
    this.componentDataTimer = undefined
    if (!this.componentDataDirty) {
      return
    }
    this.componentDataDirty = false
    this.post(Action.SetComponentData, { componentData: this.componentData })
  }

  private emitSaveStatus(): void {
    const status: SaveStatus = this.saveFailed
      ? 'error'
      : this.buildPendingSave || this.savesInFlight.size > 0
        ? 'saving'
        : 'saved'
    if (status !== this.lastSaveStatus) {
      this.lastSaveStatus = status
      this.options.onSaveStatusChange?.(status)
    }
  }

  private readonly onMessage = (event: MessageEvent): void => {
    if (event.source !== this.parent) {
      return
    }
    const message = parseMessage(event.data)
    if (!message) {
      return
    }

    if (message.action === Action.ComponentRegistered) {
      if (!this.sessionKey) {
        this.register(message, event.origin)
      }
      return
    }

    if (!this.sessionKey || event.origin !== this.parentOrigin) {
      return
    }

    if (message.action === Action.ActivateThemes) {
      this.activateThemes(message.data?.themes)
    } else if (message.action === Action.Reply) {
      this.handleReply(message)
    }
  }

  private register(message: IncomingMessage, origin: string): void {
    if (typeof message.sessionKey !== 'string' || message.sessionKey.length === 0) {
      return
    }
    this.sessionKey = message.sessionKey
    this.parentOrigin = origin
    this.componentData = isRecord(message.componentData) ? { ...message.componentData } : {}

    const data = message.data ?? {}
    this.info = {
      uuid: typeof data.uuid === 'string' ? data.uuid : undefined,
      environment: parseEnvironment(data.environment),
      platform: typeof data.platform === 'string' ? data.platform : undefined,
    }

    for (const pending of this.queue.splice(0)) {
      this.send(pending)
    }

    this.activateThemes(data.activeThemeUrls)
    this.post(Action.ThemesActivated, {})
    this.options.onReady?.(this.info)
  }

  private handleReply(message: IncomingMessage): void {
    const messageId = message.original?.messageId
    if (!messageId) {
      return
    }
    const entry = this.callbacks.get(messageId)
    if (!entry) {
      return
    }
    if (!entry.persistent) {
      this.callbacks.delete(messageId)
    }
    entry.callback(isRecord(message.data) ? message.data : {})
  }

  private activateThemes(urls: unknown): void {
    const incoming = Array.isArray(urls)
      ? urls.filter((url): url is string => typeof url === 'string' && url.length > 0)
      : []
    const unchanged =
      incoming.length === this.themeLinks.size && incoming.every((url) => this.themeLinks.has(url))
    if (unchanged) {
      return
    }

    for (const [url, link] of this.themeLinks) {
      if (!incoming.includes(url)) {
        link.remove()
        this.themeLinks.delete(url)
      }
    }

    const document = this.win.document
    for (const url of incoming) {
      if (this.themeLinks.has(url)) {
        continue
      }
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = url
      link.className = 'sn-theme'
      // Theme variables only apply once the stylesheet has loaded.
      link.addEventListener('load', () => this.options.onThemesChange?.())
      document.head.append(link)
      this.themeLinks.set(url, link)
    }

    this.options.onThemesChange?.()
  }

  private forwardKeyboardEvent(action: string, event: KeyboardEvent): void {
    if (!this.sessionKey || event.isComposing) {
      return
    }
    const isModifierKey = MODIFIER_KEYS.includes(event.key)
    const hasModifier = event.ctrlKey || event.metaKey || event.shiftKey || event.altKey
    if (!hasModifier && !isModifierKey) {
      return
    }
    if ((event.ctrlKey || event.metaKey) && TEXT_EDITING_KEYS.has(event.key.toLowerCase())) {
      return
    }

    const data: Record<string, unknown> = {
      key: event.key,
      code: event.code,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
    }
    const legacyModifier = legacyKeyboardModifier(action, event)
    if (legacyModifier) {
      // Understood by Standard Notes versions released before full shortcut forwarding.
      data.keyboardModifier = legacyModifier
    }
    this.post(action, data)
  }

  private post(action: string, data: Record<string, unknown>, callback?: ReplyCallback, persistent = false): void {
    const message: PendingMessage = { action, data, callback, persistent }
    if (!this.sessionKey) {
      this.queue.push(message)
      return
    }
    this.send(message)
  }

  private send({ action, data, callback, persistent }: PendingMessage): void {
    if (!this.sessionKey) {
      return
    }
    const messageId = randomId()
    if (callback) {
      this.callbacks.set(messageId, { callback, persistent })
    }
    const message: OutgoingMessage = { action, data, messageId, sessionKey: this.sessionKey, api: 'component' }
    // The mobile app expects JSON strings.
    const payload = this.info.environment === 'mobile' ? JSON.stringify(message) : message
    this.parent.postMessage(payload, targetOriginFor(this.parentOrigin))
  }

  private listen<K extends keyof WindowEventMap>(
    target: Window,
    type: K,
    handler: (event: WindowEventMap[K]) => void,
  ): void
  private listen<K extends keyof DocumentEventMap>(
    target: Document,
    type: K,
    handler: (event: DocumentEventMap[K]) => void,
  ): void
  private listen(target: EventTarget, type: string, handler: (event: never) => void): void {
    const listener = handler as EventListener
    target.addEventListener(type, listener)
    this.removeListeners.push(() => target.removeEventListener(type, listener))
  }
}

/** Only the fields Standard Notes reads back from a save; drops our transient flags. */
function toTransferItem(item: ContextItem): Record<string, unknown> {
  const { isMetadataUpdate: _isMetadataUpdate, ...rest } = item
  return rest
}

/**
 * The app's origin is "null" (or file://) on mobile, which postMessage cannot target. Messages
 * always go to `window.parent`, so falling back to "*" only matters for those platforms.
 */
function targetOriginFor(origin: string | undefined): string {
  return origin && /^https?:\/\//.test(origin) ? origin : '*'
}

function legacyKeyboardModifier(action: string, event: KeyboardEvent): string | undefined {
  if (action === Action.KeyDown) {
    if (event.ctrlKey) return 'Control'
    if (event.shiftKey) return 'Shift'
    if (event.metaKey || event.key === 'Meta') return 'Meta'
    return undefined
  }
  return ['Control', 'Shift', 'Meta'].includes(event.key) ? event.key : undefined
}

function parseMessage(data: unknown): IncomingMessage | undefined {
  let value = data
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return undefined
    }
  }
  return isRecord(value) ? (value as IncomingMessage) : undefined
}

function parseEnvironment(value: unknown): Environment | undefined {
  return value === 'web' || value === 'desktop' || value === 'mobile' ? value : undefined
}

function isContextItem(value: unknown): value is ContextItem {
  return isRecord(value) && typeof value.uuid === 'string' && isRecord(value.content)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

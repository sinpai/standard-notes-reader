/** Item domain Standard Notes uses for its own per-item metadata (locked, pinned, ...). */
export const SN_APP_DOMAIN = 'org.standardnotes.sn'

export type Environment = 'web' | 'desktop' | 'mobile'

export interface NoteContent {
  title?: string
  text?: string
  preview_plain?: string
  preview_html?: string | null
  /** Injected by Standard Notes: the note's (or the global) spellcheck preference. */
  spellcheck?: boolean
  appData?: Record<string, Record<string, unknown> | undefined>
  [key: string]: unknown
}

/** The note being edited, as streamed by Standard Notes. */
export interface ContextItem {
  uuid: string
  content_type: string
  content: NoteContent
  /** This plugin's private per-note data. Saved back only when present. */
  clientData?: Record<string, unknown>
  /** True when the update only reflects a sync round-trip of our own save. */
  isMetadataUpdate?: boolean
  [key: string]: unknown
}

export type ComponentData = Record<string, unknown>

export interface RegistrationInfo {
  uuid?: string
  environment?: Environment
  platform?: string
}

export type SaveStatus = 'saving' | 'saved' | 'error'

/** Actions of the Standard Notes component protocol that this editor uses. */
export const Action = {
  ComponentRegistered: 'component-registered',
  ActivateThemes: 'themes',
  ThemesActivated: 'themes-activated',
  Reply: 'reply',
  StreamContextItem: 'stream-context-item',
  SaveItems: 'save-items',
  SetComponentData: 'set-component-data',
  KeyDown: 'key-down',
  KeyUp: 'key-up',
  Click: 'click',
} as const

export interface IncomingMessage {
  action?: string
  data?: Record<string, unknown>
  sessionKey?: string
  componentData?: ComponentData
  original?: { messageId?: string }
}

export interface OutgoingMessage {
  action: string
  data: Record<string, unknown>
  messageId: string
  sessionKey: string
  api: 'component'
}

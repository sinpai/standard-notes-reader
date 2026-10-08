import { parseFontRef } from './fonts/stack'
import type { FontRef } from './fonts/types'

export type ContentWidth = 'narrow' | 'medium' | 'wide' | 'full'
export type View = 'edit' | 'read'

export interface Settings {
  textFont: FontRef
  /** Used for code in Read view, and for editing when `monospaceEditing` is on. */
  codeFont: FontRef
  monospaceEditing: boolean
  fontSize: number
  lineHeight: number
  width: ContentWidth
  defaultView: View
  /** Installed fonts the user added by name, offered in the font pickers. */
  installedFonts: string[]
}

export const DEFAULT_SETTINGS: Settings = {
  textFont: { type: 'theme' },
  codeFont: { type: 'generic', family: 'monospace' },
  monospaceEditing: false,
  fontSize: 17,
  lineHeight: 1.6,
  width: 'medium',
  defaultView: 'edit',
  installedFonts: [],
}

export const FONT_SIZE_RANGE = { min: 12, max: 32 } as const
export const LINE_HEIGHT_RANGE = { min: 1.1, max: 2.4 } as const

/** Width of the text column; `em` keeps the line length constant when the font size changes. */
export const CONTENT_WIDTHS: Record<ContentWidth, string> = {
  narrow: '34em',
  medium: '42em',
  wide: '54em',
  full: '100%',
}

/** Reads settings from synced data, falling back to defaults for anything missing or invalid. */
export function parseSettings(value: unknown): Settings {
  if (typeof value !== 'object' || value === null) {
    return DEFAULT_SETTINGS
  }
  const raw = value as Record<string, unknown>
  return {
    textFont: parseFontRef(raw.textFont) ?? DEFAULT_SETTINGS.textFont,
    codeFont: parseFontRef(raw.codeFont) ?? DEFAULT_SETTINGS.codeFont,
    monospaceEditing: typeof raw.monospaceEditing === 'boolean' ? raw.monospaceEditing : DEFAULT_SETTINGS.monospaceEditing,
    fontSize: clampNumber(raw.fontSize, FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max, DEFAULT_SETTINGS.fontSize),
    lineHeight: clampNumber(raw.lineHeight, LINE_HEIGHT_RANGE.min, LINE_HEIGHT_RANGE.max, DEFAULT_SETTINGS.lineHeight),
    width: typeof raw.width === 'string' && raw.width in CONTENT_WIDTHS ? (raw.width as ContentWidth) : DEFAULT_SETTINGS.width,
    defaultView: raw.defaultView === 'read' ? 'read' : 'edit',
    installedFonts: Array.isArray(raw.installedFonts)
      ? uniqueNames(raw.installedFonts.filter((name): name is string => typeof name === 'string'))
      : [],
  }
}

export function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const name of names) {
    const trimmed = name.trim()
    if (trimmed && !seen.has(trimmed.toLowerCase())) {
      seen.add(trimmed.toLowerCase())
      result.push(trimmed)
    }
  }
  return result
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  return Math.min(max, Math.max(min, value))
}

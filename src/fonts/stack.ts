import { findBuiltinFont } from './builtin'
import { cssFamilyForImported } from './registry'
import type { FontRef } from './types'

export const THEME_TEXT_STACK =
  "var(--sn-stylekit-editor-font-family, var(--sn-stylekit-sans-serif-font, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif))"

export const THEME_MONO_STACK =
  "var(--sn-stylekit-monospace-font, ui-monospace, 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace)"

const GENERIC_STACKS = {
  'sans-serif': "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  serif: "ui-serif, 'Iowan Old Style', Charter, Georgia, Cambria, 'Times New Roman', serif",
  monospace: THEME_MONO_STACK,
} as const

/** Quotes a family name for use in a CSS `font-family` value. */
export function cssString(value: string): string {
  return `"${value.replace(/[\\"]/g, '\\$&').replace(/[\n\r\f]/g, ' ')}"`
}

/**
 * CSS `font-family` value for a font reference. Device fonts fall back to `fallback`, so a note
 * still renders sensibly on a device where the font is missing.
 */
export function fontStack(ref: FontRef, fallback: string = THEME_TEXT_STACK): string {
  switch (ref.type) {
    case 'theme':
      return fallback
    case 'generic':
      return GENERIC_STACKS[ref.family]
    case 'installed':
      return `${cssString(ref.family)}, ${fallback}`
    case 'imported':
      return `${cssString(cssFamilyForImported(ref.familyId))}, ${fallback}`
    case 'builtin': {
      const font = findBuiltinFont(ref.id)
      return font ? `${cssString(font.cssFamily)}, ${fallback}` : fallback
    }
  }
}

/** CSS `font-weight` for text set in a font. Only some built-in fonts are not regular weight. */
export function fontWeight(ref: FontRef): number {
  return ref.type === 'builtin' ? (findBuiltinFont(ref.id)?.weight ?? 400) : 400
}

export function sameFontRef(a: FontRef | undefined, b: FontRef | undefined): boolean {
  return encodeFontRef(a) === encodeFontRef(b)
}

/** Compact string form, used as `<select>` option values. */
export function encodeFontRef(ref: FontRef | undefined): string {
  if (!ref) return ''
  switch (ref.type) {
    case 'theme':
      return 'theme'
    case 'generic':
      return `generic:${ref.family}`
    case 'installed':
      return `installed:${ref.family}`
    case 'imported':
      return `imported:${ref.familyId}`
    case 'builtin':
      return `builtin:${ref.id}`
  }
}

export function decodeFontRef(value: string): FontRef | undefined {
  if (value === 'theme') {
    return { type: 'theme' }
  }
  const separator = value.indexOf(':')
  if (separator < 0) {
    return undefined
  }
  const type = value.slice(0, separator)
  const rest = value.slice(separator + 1)
  if (type === 'imported') {
    return parseFontRef({ type, familyId: rest })
  }
  return parseFontRef(type === 'builtin' ? { type, id: rest } : { type, family: rest })
}

/** Validates a font reference read from synced data. */
export function parseFontRef(value: unknown): FontRef | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const ref = value as Record<string, unknown>
  switch (ref.type) {
    case 'theme':
      return { type: 'theme' }
    case 'generic':
      return ref.family === 'sans-serif' || ref.family === 'serif' || ref.family === 'monospace'
        ? { type: 'generic', family: ref.family }
        : undefined
    case 'installed':
      return typeof ref.family === 'string' && ref.family.trim()
        ? { type: 'installed', family: ref.family.trim() }
        : undefined
    case 'imported':
      return typeof ref.familyId === 'string' && ref.familyId ? { type: 'imported', familyId: ref.familyId } : undefined
    case 'builtin': {
      // Settings may come from a newer version of the plugin with fonts this one does not ship.
      const font = typeof ref.id === 'string' ? findBuiltinFont(ref.id) : undefined
      return font ? { type: 'builtin', id: font.id } : undefined
    }
  }
  return undefined
}

import { hintsFromFileName } from './fileNameHints'
import { cssString } from './stack'

/**
 * Popular reading, writing and coding fonts, checked to suggest fonts that are installed on the
 * device. Browsers do not let a sandboxed plugin list installed fonts, so this is the best we can
 * offer; any other installed font can still be added by name.
 */
export const SUGGESTED_FONTS = [
  // Serif
  'Alegreya', 'Athelas', 'Baskerville', 'Big Caslon', 'Bitter', 'Book Antiqua', 'Cambria', 'Charis SIL',
  'Charter', 'Cochin', 'Constantia', 'Cormorant Garamond', 'Crimson Pro', 'Crimson Text', 'DejaVu Serif',
  'EB Garamond', 'Garamond', 'Gentium Plus', 'Georgia', 'Hoefler Text', 'IBM Plex Serif', 'Iowan Old Style',
  'Libre Baskerville', 'Literata', 'Lora', 'Merriweather', 'Newsreader', 'Noto Serif', 'Palatino',
  'Palatino Linotype', 'PT Serif', 'Sitka Text', 'Source Serif 4', 'Source Serif Pro', 'Spectral',
  'Times New Roman', 'Vollkorn',
  // Sans-serif
  'Atkinson Hyperlegible', 'Atkinson Hyperlegible Next', 'Avenir', 'Avenir Next', 'Calibri', 'Candara',
  'Corbel', 'DejaVu Sans', 'Fira Sans', 'Futura', 'Geist', 'Gill Sans', 'Helvetica Neue', 'IBM Plex Sans',
  'Inter', 'Lato', 'Lexend', 'Noto Sans', 'Open Sans', 'OpenDyslexic', 'Optima', 'PT Sans', 'Roboto',
  'Segoe UI', 'Seravek', 'Source Sans 3', 'Source Sans Pro', 'Ubuntu', 'Verdana',
  // Monospace and writing
  'Berkeley Mono', 'Cascadia Code', 'Cascadia Mono', 'Commit Mono', 'Consolas', 'Courier Prime',
  'DejaVu Sans Mono', 'Fira Code', 'Fira Mono', 'Geist Mono', 'Hack', 'iA Writer Duo S', 'iA Writer Mono S',
  'iA Writer Quattro S', 'IBM Plex Mono', 'Iosevka', 'JetBrains Mono', 'Menlo', 'Monaco', 'Monaspace Neon',
  'Recursive', 'Roboto Mono', 'SF Mono', 'Source Code Pro', 'Ubuntu Mono', 'Victor Mono',
  // Handwriting and display
  'American Typewriter', 'Comic Neue', 'Noteworthy', 'Bradley Hand', 'Segoe Print',
]

const SAMPLE = 'mmmmmmmmmmlli10WQ@#&%'
const BASES = ['monospace', 'serif', 'sans-serif'] as const

let context: CanvasRenderingContext2D | null | undefined
const cache = new Map<string, boolean>()

/**
 * Detects an installed font by measuring text: if the font is missing, the browser falls back to
 * the generic family and the width does not change. Safari only exposes fonts bundled with the
 * OS, so fonts the user installed are reported as missing there, which matches what will render.
 */
export function isFontInstalled(family: string): boolean {
  const name = family.trim()
  const cached = cache.get(name)
  if (cached !== undefined) {
    return cached
  }
  context ??= document.createElement('canvas').getContext('2d')
  if (!context || !name) {
    return false
  }
  let installed = false
  for (const base of BASES) {
    context.font = `48px ${base}`
    const fallbackWidth = context.measureText(SAMPLE).width
    context.font = `48px ${cssString(name)}, ${base}`
    if (context.measureText(SAMPLE).width !== fallbackWidth) {
      installed = true
      break
    }
  }
  cache.set(name, installed)
  return installed
}

export function detectSuggestedFonts(): string[] {
  return SUGGESTED_FONTS.filter(isFontInstalled).sort((a, b) => a.localeCompare(b))
}

/**
 * Suggests the family name when a file or PostScript name was typed: "Literaturnaya20" or
 * "Literaturnaya20-Regular" → "Literaturnaya 20". Only the family name brings in all its styles.
 */
export function suggestInstalledFamily(name: string): string | undefined {
  const family = hintsFromFileName(name).family
  return family.toLowerCase() !== name.trim().toLowerCase() && isFontInstalled(family) ? family : undefined
}

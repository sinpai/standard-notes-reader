import type { BuiltinFontId } from './types'

export interface BuiltinFace {
  /** Path of the font file, relative to the editor's index.html (files live in `public/`). */
  file: string
  weight: number
  style: 'normal' | 'italic'
}

export interface BuiltinFont {
  id: BuiltinFontId
  name: string
  /** CSS family the faces are registered under; variants of one family share it. */
  cssFamily: string
  faces: BuiltinFace[]
  /** Weight used for text set in this font. */
  weight: number
}

/**
 * Old Standard TT by Alexey Kryukov, SIL Open Font License 1.1 (see public/fonts/old-standard-tt/OFL.txt).
 * There is no bold italic, so browsers embolden the italic when it is needed.
 */
const OLD_STANDARD_FACES: BuiltinFace[] = [
  { file: 'fonts/old-standard-tt/OldStandard-Regular.ttf', weight: 400, style: 'normal' },
  { file: 'fonts/old-standard-tt/OldStandard-Italic.ttf', weight: 400, style: 'italic' },
  { file: 'fonts/old-standard-tt/OldStandard-Bold.ttf', weight: 700, style: 'normal' },
]

export const BUILTIN_FONTS: readonly BuiltinFont[] = [
  {
    id: 'old-standard-tt',
    name: 'Old Standard TT',
    cssFamily: 'snr-builtin-old-standard-tt',
    faces: OLD_STANDARD_FACES,
    weight: 400,
  },
  {
    id: 'old-standard-tt-bold',
    name: 'Old Standard TT Bold',
    cssFamily: 'snr-builtin-old-standard-tt',
    faces: OLD_STANDARD_FACES,
    weight: 700,
  },
]

export function findBuiltinFont(id: string): BuiltinFont | undefined {
  return BUILTIN_FONTS.find((font) => font.id === id)
}

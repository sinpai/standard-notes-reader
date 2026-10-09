export type GenericFamily = 'sans-serif' | 'serif' | 'monospace'

/** Which font to use for a piece of text. Stored in settings and per-note data. */
export type FontRef =
  /** The font Standard Notes uses for editors (follows the active theme). */
  | { type: 'theme' }
  | { type: 'generic'; family: GenericFamily }
  /** A font installed on the device, referenced by its family name. */
  | { type: 'installed'; family: string }
  /** Font files the user imported, grouped by family. */
  | { type: 'imported'; familyId: string }
  /** A free font shipped with the plugin. */
  | { type: 'builtin'; id: BuiltinFontId }

export type BuiltinFontId = 'old-standard-tt' | 'old-standard-tt-bold'

export type FontFormat = 'truetype' | 'opentype' | 'woff' | 'woff2' | 'collection'

/** One imported font file (a single face of a family), as stored in the plugin's synced data. */
export interface StoredFontFace {
  id: string
  /** Faces imported with the same family name share an id, so references survive renames. */
  familyId: string
  family: string
  /** A fixed weight, or the [min, max] range of a variable font. */
  weight: number | [number, number]
  italic: boolean
  fileName: string
  format: FontFormat
  /** Size of the original file in bytes. */
  size: number
  encoding: 'base64' | 'gzip+base64'
  data: string
  addedAt: number
}

export interface ImportedFamily {
  familyId: string
  family: string
  faces: StoredFontFace[]
}

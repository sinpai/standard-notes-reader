import type { BuiltinFont } from './builtin'
import { removeStrayHintMasks } from './cffRepair'
import { base64ToBytes, gunzip } from './codec'
import type { StoredFontFace } from './types'

/** CSS family name an imported family is registered under. Never collides with installed fonts. */
export function cssFamilyForImported(familyId: string): string {
  return `snr-${familyId.replace(/[^a-z0-9]/gi, '')}`
}

export async function decodeFace(face: StoredFontFace): Promise<Uint8Array> {
  const bytes = base64ToBytes(face.data)
  return face.encoding === 'gzip+base64' ? gunzip(bytes) : bytes
}

/**
 * Registers imported faces with `document.fonts` on demand. Decoding is lazy so a large library
 * does not slow down opening a note that uses a single font.
 */
export class FontRegistry {
  private readonly registered = new Map<string, { face: FontFace; signature: string }>()
  private readonly loading = new Map<string, Promise<void>>()
  private readonly builtinFaces = new Map<string, FontFace>()

  constructor(private readonly fontSet: FontFaceSet = document.fonts) {}

  /**
   * Registers the faces of a font shipped with the plugin. Files are downloaded only when text
   * needs them; this waits for the face used for normal text.
   */
  ensureBuiltin(font: BuiltinFont, baseUrl: string = document.baseURI): Promise<void> {
    let textFace: FontFace | undefined
    for (const face of font.faces) {
      const key = `${font.cssFamily}|${face.file}`
      let fontFace = this.builtinFaces.get(key)
      if (!fontFace) {
        const url = new URL(face.file, baseUrl).href
        fontFace = new FontFace(font.cssFamily, `url(${JSON.stringify(url)})`, {
          weight: String(face.weight),
          style: face.style,
        })
        this.fontSet.add(fontFace)
        this.builtinFaces.set(key, fontFace)
      }
      if (face.style === 'normal' && face.weight === font.weight) {
        textFace = fontFace
      }
    }
    return textFace ? textFace.load().then(() => undefined) : Promise.resolve()
  }

  /** Loads every face of a family. Resolves once the fonts are ready to render. */
  ensureFamily(familyId: string, library: StoredFontFace[]): Promise<void> {
    const faces = library.filter((face) => face.familyId === familyId)
    return Promise.all(faces.map((face) => this.ensureFace(face))).then(() => undefined)
  }

  /** Unregisters faces that were removed from the library or changed. */
  prune(library: StoredFontFace[]): void {
    const current = new Map(library.map((face) => [face.id, signatureOf(face)]))
    for (const [id, entry] of this.registered) {
      if (current.get(id) !== entry.signature) {
        this.fontSet.delete(entry.face)
        this.registered.delete(id)
      }
    }
  }

  private ensureFace(face: StoredFontFace): Promise<void> {
    const signature = signatureOf(face)
    if (this.registered.get(face.id)?.signature === signature) {
      return Promise.resolve()
    }
    const key = `${face.id}:${signature}`
    let pending = this.loading.get(key)
    if (!pending) {
      pending = this.load(face, signature).finally(() => this.loading.delete(key))
      this.loading.set(key, pending)
    }
    return pending
  }

  private async load(face: StoredFontFace, signature: string): Promise<void> {
    const decoded = await decodeFace(face)
    // Fonts imported in Safari used to be stored without the repair that stricter browsers need.
    const bytes = removeStrayHintMasks(decoded)?.bytes ?? decoded
    const fontFace = new FontFace(cssFamilyForImported(face.familyId), bytes as BufferSource, {
      weight: Array.isArray(face.weight) ? `${face.weight[0]} ${face.weight[1]}` : String(face.weight),
      style: face.italic ? 'italic' : 'normal',
    })
    await fontFace.load()
    const previous = this.registered.get(face.id)
    if (previous) {
      this.fontSet.delete(previous.face)
    }
    this.fontSet.add(fontFace)
    this.registered.set(face.id, { face: fontFace, signature })
  }
}

/** Changes whenever anything that affects how the face is registered changes. */
function signatureOf(face: StoredFontFace): string {
  return `${face.familyId}|${String(face.weight)}|${face.italic}|${face.data.length}|${face.data.slice(0, 32)}`
}

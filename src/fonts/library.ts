import { randomId } from '../util/random'
import { removeStrayHintMasks } from './cffRepair'
import { bytesToBase64, canCompress, gzip } from './codec'
import { hintsFromFileName } from './fileNameHints'
import { detectFontFormat, readFontMetadata, type FontMetadata } from './fontMetadata'
import type { FontFormat, ImportedFamily, StoredFontFace } from './types'

/**
 * Imported fonts live in Standard Notes' synced preferences, which are re-uploaded whenever any
 * preference changes, so the library is kept small.
 */
export const MAX_FONT_FILE_BYTES = 2 * 1024 * 1024
export const MAX_LIBRARY_BYTES = 3 * 1024 * 1024

export const FONT_FILE_EXTENSIONS = ['.ttf', '.otf', '.woff', '.woff2', '.ttc']

export class FontImportError extends Error {}

export interface ImportOptions {
  /** Checks that the browser can actually render the font. Throws if it cannot. */
  validate?: (bytes: Uint8Array) => Promise<void>
}

export interface ImportedFont {
  face: StoredFontFace
  /** The file was repaired so that every browser loads it. */
  repaired: boolean
}

/** Turns a font file picked by the user into a face that can be stored and synced. */
export async function importFontFile(
  file: File,
  library: StoredFontFace[],
  options: ImportOptions = {},
): Promise<ImportedFont> {
  if (file.size > MAX_FONT_FILE_BYTES) {
    throw new FontImportError(
      `${file.name} is ${formatBytes(file.size)}. Fonts up to ${formatBytes(MAX_FONT_FILE_BYTES)} are supported — try the WOFF2 version of the font, which is much smaller.`,
    )
  }

  let bytes: Uint8Array = new Uint8Array(await file.arrayBuffer())
  const format = detectFontFormat(bytes)
  if (!format) {
    throw new FontImportError(`${file.name} is not a TrueType, OpenType, WOFF or WOFF2 font.`)
  }

  // Chrome, Firefox and the desktop app run fonts through a strict validator (the OpenType
  // Sanitizer); Safari does not. The library syncs between them, so known defects are repaired
  // even when this browser would accept the file.
  const repair = removeStrayHintMasks(bytes)
  if (repair) {
    bytes = repair.bytes
  }
  try {
    await (options.validate ?? validateWithFontFace)(bytes)
  } catch {
    throw new FontImportError(
      format === 'collection'
        ? `${file.name} is a font collection, which this device cannot load. Export a single style as .ttf or .otf instead.`
        : `${file.name} was rejected by this browser's font checker: the file is damaged or contains data browsers do not accept. If the font is installed on this device, add it under Installed fonts instead.`,
    )
  }

  const metadata: FontMetadata = await readFontMetadata(bytes).catch(() => ({}))
  const hints = hintsFromFileName(file.name)
  // Apple's hidden system fonts are named like ".New York".
  const family = (metadata.family ?? hints.family).replace(/^\.+/, '').trim() || 'Imported font'
  const sameFamily = library.find((face) => face.family.toLowerCase() === family.toLowerCase())

  const { encoding, data } = await encodeFont(bytes, format)
  const face: StoredFontFace = {
    id: randomId(8),
    familyId: sameFamily?.familyId ?? randomId(8),
    family: sameFamily?.family ?? family,
    weight: metadata.weightRange ?? metadata.weight ?? hints.weight ?? 400,
    italic: metadata.italic ?? hints.italic,
    fileName: file.name,
    format,
    size: bytes.length,
    encoding,
    data,
    addedAt: Date.now(),
  }
  return { face, repaired: repair !== undefined }
}

/**
 * Adds a face to the library, replacing a face of the same family and style.
 * Throws if the library would exceed its size budget.
 */
export function addFaceToLibrary(library: StoredFontFace[], face: StoredFontFace): StoredFontFace[] {
  const remaining = library.filter(
    (existing) =>
      !(
        existing.familyId === face.familyId &&
        existing.italic === face.italic &&
        String(existing.weight) === String(face.weight)
      ),
  )
  const next = [...remaining, face]
  const total = libraryBytes(next)
  if (total > MAX_LIBRARY_BYTES) {
    throw new FontImportError(
      `Adding ${face.fileName} would use ${formatBytes(total)} of the ${formatBytes(MAX_LIBRARY_BYTES)} available for imported fonts. Remove a font or use WOFF2 files, which are much smaller.`,
    )
  }
  return next
}

export function groupFamilies(library: StoredFontFace[]): ImportedFamily[] {
  const families = new Map<string, ImportedFamily>()
  for (const face of library) {
    const family = families.get(face.familyId)
    if (family) {
      family.faces.push(face)
    } else {
      families.set(face.familyId, { familyId: face.familyId, family: face.family, faces: [face] })
    }
  }
  for (const family of families.values()) {
    family.faces.sort((a, b) => lowestWeight(a) - lowestWeight(b) || Number(a.italic) - Number(b.italic))
  }
  return Array.from(families.values()).sort((a, b) => a.family.localeCompare(b.family))
}

/** Bytes the library occupies in the synced preferences. */
export function libraryBytes(library: StoredFontFace[]): number {
  return library.reduce((total, face) => total + face.data.length, 0)
}

export function describeFace(face: StoredFontFace): string {
  const weight = Array.isArray(face.weight)
    ? `Variable ${face.weight[0]}–${face.weight[1]}`
    : (WEIGHT_NAMES[face.weight] ?? `Weight ${face.weight}`)
  if (!face.italic) {
    return weight
  }
  return weight === 'Regular' ? 'Italic' : `${weight} Italic`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Sanitizes faces read from synced data, which may come from another version of the plugin. */
export function parseStoredFaces(value: unknown): StoredFontFace[] {
  if (!Array.isArray(value)) {
    return []
  }
  const faces: StoredFontFace[] = []
  for (const candidate of value) {
    if (typeof candidate !== 'object' || candidate === null) {
      continue
    }
    const face = candidate as Partial<StoredFontFace>
    const weight = face.weight
    const validWeight =
      typeof weight === 'number' ||
      (Array.isArray(weight) && weight.length === 2 && weight.every((part) => typeof part === 'number'))
    if (
      typeof face.id === 'string' &&
      typeof face.familyId === 'string' &&
      typeof face.family === 'string' &&
      typeof face.data === 'string' &&
      (face.encoding === 'base64' || face.encoding === 'gzip+base64') &&
      validWeight
    ) {
      faces.push({
        id: face.id,
        familyId: face.familyId,
        family: face.family,
        weight: weight as StoredFontFace['weight'],
        italic: face.italic === true,
        fileName: typeof face.fileName === 'string' ? face.fileName : face.family,
        format: face.format ?? 'truetype',
        size: typeof face.size === 'number' ? face.size : 0,
        encoding: face.encoding,
        data: face.data,
        addedAt: typeof face.addedAt === 'number' ? face.addedAt : 0,
      })
    }
  }
  return faces
}

const WEIGHT_NAMES: Record<number, string> = {
  100: 'Thin',
  200: 'Extra Light',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semibold',
  700: 'Bold',
  800: 'Extra Bold',
  900: 'Black',
}

function lowestWeight(face: StoredFontFace): number {
  return Array.isArray(face.weight) ? face.weight[0] : face.weight
}

async function encodeFont(
  bytes: Uint8Array,
  format: FontFormat,
): Promise<Pick<StoredFontFace, 'encoding' | 'data'>> {
  const alreadyCompressed = format === 'woff' || format === 'woff2'
  if (canCompress && !alreadyCompressed) {
    const compressed = await gzip(bytes)
    if (compressed.length < bytes.length * 0.9) {
      return { encoding: 'gzip+base64', data: bytesToBase64(compressed) }
    }
  }
  return { encoding: 'base64', data: bytesToBase64(bytes) }
}

async function validateWithFontFace(bytes: Uint8Array): Promise<void> {
  const face = new FontFace(`validate-${randomId(4)}`, bytes as BufferSource)
  await face.load()
}

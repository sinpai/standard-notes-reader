import { inflate } from './codec'
import type { FontFormat } from './types'

export interface FontMetadata {
  family?: string
  subfamily?: string
  /** usWeightClass of a static font. */
  weight?: number
  /** Range of the `wght` axis of a variable font. */
  weightRange?: [number, number]
  italic?: boolean
}

export interface TableRecord {
  offset: number
  length: number
  /** Position of the table's entry in the font's table directory. */
  record: number
  /** Only set for compressed WOFF tables. */
  compressedLength?: number
}

const NAME_FAMILY = 1
const NAME_SUBFAMILY = 2
const NAME_TYPOGRAPHIC_FAMILY = 16
const NAME_TYPOGRAPHIC_SUBFAMILY = 17

export function detectFontFormat(bytes: Uint8Array): FontFormat | undefined {
  if (bytes.length < 12) {
    return undefined
  }
  const tag = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!)
  switch (tag) {
    case 'wOFF':
      return 'woff'
    case 'wOF2':
      return 'woff2'
    case 'OTTO':
      return 'opentype'
    case 'ttcf':
      return 'collection'
    case 'true':
      return 'truetype'
  }
  return bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0 ? 'truetype' : undefined
}

/**
 * Reads naming and style information from TrueType/OpenType (incl. collections) and WOFF 1.0
 * files. WOFF2 tables are Brotli-compressed, which browsers cannot decompress, so callers fall
 * back to guessing from the file name.
 */
export async function readFontMetadata(bytes: Uint8Array): Promise<FontMetadata> {
  const format = detectFontFormat(bytes)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  let tables: Map<string, TableRecord>
  if (format === 'truetype' || format === 'opentype') {
    tables = readSfntDirectory(view, 0)
  } else if (format === 'collection') {
    // Use the first font of the collection.
    tables = readSfntDirectory(view, view.getUint32(12))
  } else if (format === 'woff') {
    tables = readWoffDirectory(view)
  } else {
    return {}
  }

  const loadTable = async (tag: string): Promise<DataView | undefined> => {
    const record = tables.get(tag)
    if (!record) {
      return undefined
    }
    if (record.compressedLength === undefined) {
      return new DataView(bytes.buffer, bytes.byteOffset + record.offset, record.length)
    }
    const inflated = await inflate(bytes.subarray(record.offset, record.offset + record.compressedLength))
    return new DataView(inflated.buffer, inflated.byteOffset, inflated.byteLength)
  }

  const [name, os2, fvar, head] = await Promise.all([
    loadTable('name'),
    loadTable('OS/2'),
    loadTable('fvar'),
    loadTable('head'),
  ])

  const metadata: FontMetadata = {}

  if (name) {
    const names = readNames(name)
    metadata.family = names.get(NAME_TYPOGRAPHIC_FAMILY) ?? names.get(NAME_FAMILY)
    metadata.subfamily = names.get(NAME_TYPOGRAPHIC_SUBFAMILY) ?? names.get(NAME_SUBFAMILY)
  }

  let italic = false
  if (os2 && os2.byteLength >= 64) {
    const weightClass = os2.getUint16(4)
    // A few old fonts use a 1-9 scale.
    metadata.weight = weightClass > 0 && weightClass < 10 ? weightClass * 100 : clampWeight(weightClass)
    const fsSelection = os2.getUint16(62)
    italic = (fsSelection & 0x1) !== 0 || (fsSelection & 0x200) !== 0
  } else if (head && head.byteLength >= 46) {
    const macStyle = head.getUint16(44)
    metadata.weight = macStyle & 0x1 ? 700 : 400
    italic = (macStyle & 0x2) !== 0
  }
  metadata.italic = italic || /italic|oblique/i.test(metadata.subfamily ?? '')

  if (fvar) {
    const range = readWeightAxis(fvar)
    if (range) {
      metadata.weightRange = range
    }
  }

  return metadata
}

export function readSfntDirectory(view: DataView, start: number): Map<string, TableRecord> {
  const tables = new Map<string, TableRecord>()
  const numTables = view.getUint16(start + 4)
  for (let index = 0; index < numTables; index++) {
    const record = start + 12 + index * 16
    if (record + 16 > view.byteLength) {
      break
    }
    const offset = view.getUint32(record + 8)
    const length = view.getUint32(record + 12)
    if (offset + length <= view.byteLength) {
      tables.set(readTag(view, record), { offset, length, record })
    }
  }
  return tables
}

function readWoffDirectory(view: DataView): Map<string, TableRecord> {
  const tables = new Map<string, TableRecord>()
  const numTables = view.getUint16(12)
  for (let index = 0; index < numTables; index++) {
    const record = 44 + index * 20
    if (record + 20 > view.byteLength) {
      break
    }
    const offset = view.getUint32(record + 4)
    const compressedLength = view.getUint32(record + 8)
    const length = view.getUint32(record + 12)
    if (offset + compressedLength <= view.byteLength) {
      tables.set(
        readTag(view, record),
        compressedLength < length ? { offset, length, record, compressedLength } : { offset, length, record },
      )
    }
  }
  return tables
}

/** Picks the best (preferably English) string for each name id we care about. */
function readNames(view: DataView): Map<number, string> {
  const wanted = [NAME_FAMILY, NAME_SUBFAMILY, NAME_TYPOGRAPHIC_FAMILY, NAME_TYPOGRAPHIC_SUBFAMILY]
  const best = new Map<number, { value: string; score: number }>()
  const count = view.getUint16(2)
  const storage = view.getUint16(4)

  for (let index = 0; index < count; index++) {
    const record = 6 + index * 12
    if (record + 12 > view.byteLength) {
      break
    }
    const platformId = view.getUint16(record)
    const encodingId = view.getUint16(record + 2)
    const languageId = view.getUint16(record + 4)
    const nameId = view.getUint16(record + 6)
    const length = view.getUint16(record + 8)
    const offset = storage + view.getUint16(record + 10)
    if (!wanted.includes(nameId) || offset + length > view.byteLength) {
      continue
    }

    let value: string | undefined
    let score: number
    if (platformId === 3 && (encodingId === 0 || encodingId === 1 || encodingId === 10)) {
      value = decodeUtf16Be(view, offset, length)
      score = languageId === 0x409 ? 4 : 1
    } else if (platformId === 0) {
      value = decodeUtf16Be(view, offset, length)
      score = 3
    } else if (platformId === 1 && encodingId === 0) {
      value = decodeSingleByte(view, offset, length)
      score = languageId === 0 ? 2 : 0
    } else {
      continue
    }

    value = value.replace(/\0/g, '').trim()
    const current = best.get(nameId)
    if (value && (!current || score > current.score)) {
      best.set(nameId, { value, score })
    }
  }

  return new Map(Array.from(best, ([nameId, { value }]) => [nameId, value]))
}

function readWeightAxis(view: DataView): [number, number] | undefined {
  if (view.byteLength < 16) {
    return undefined
  }
  const axesOffset = view.getUint16(4)
  const axisCount = view.getUint16(8)
  const axisSize = view.getUint16(10)
  for (let index = 0; index < axisCount; index++) {
    const record = axesOffset + index * axisSize
    if (record + 20 > view.byteLength) {
      break
    }
    if (readTag(view, record) === 'wght') {
      const min = clampWeight(Math.round(view.getInt32(record + 4) / 65536))
      const max = clampWeight(Math.round(view.getInt32(record + 12) / 65536))
      return min < max ? [min, max] : undefined
    }
  }
  return undefined
}

function readTag(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  )
}

function decodeUtf16Be(view: DataView, offset: number, length: number): string {
  let value = ''
  for (let index = 0; index + 1 < length; index += 2) {
    value += String.fromCharCode(view.getUint16(offset + index))
  }
  return value
}

/** Mac Roman matches ASCII, which covers the font names that use this platform in practice. */
function decodeSingleByte(view: DataView, offset: number, length: number): string {
  let value = ''
  for (let index = 0; index < length; index++) {
    value += String.fromCharCode(view.getUint8(offset + index))
  }
  return value
}

function clampWeight(weight: number): number {
  return Math.min(1000, Math.max(1, weight))
}

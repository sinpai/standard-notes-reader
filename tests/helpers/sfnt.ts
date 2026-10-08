import { deflateSync } from 'node:zlib'

/** Builds minimal font binaries with just the tables the metadata reader looks at. */

export interface FontSpec {
  family?: string
  subfamily?: string
  typographicFamily?: string
  typographicSubfamily?: string
  weight?: number
  italic?: boolean
  weightAxis?: [number, number]
  signature?: 'truetype' | 'opentype'
}

export function buildSfnt(spec: FontSpec): Uint8Array {
  return assembleSfnt(tablesFor(spec), spec.signature === 'opentype' ? 0x4f54544f : 0x00010000)
}

export function buildWoff(spec: FontSpec): Uint8Array {
  const tables = tablesFor(spec)
  const headerSize = 44
  const directorySize = tables.length * 20
  let offset = headerSize + directorySize
  const entries = tables.map(({ tag, data }) => {
    const compressed = new Uint8Array(deflateSync(data))
    const stored = compressed.length < data.length ? compressed : data
    const entry = { tag, offset, compLength: stored.length, origLength: data.length, stored }
    offset += pad4(stored.length)
    return entry
  })

  const bytes = new Uint8Array(offset)
  const view = new DataView(bytes.buffer)
  writeTag(view, 0, 'wOFF')
  view.setUint32(4, 0x00010000)
  view.setUint32(8, offset)
  view.setUint16(12, tables.length)
  entries.forEach((entry, index) => {
    const record = headerSize + index * 20
    writeTag(view, record, entry.tag)
    view.setUint32(record + 4, entry.offset)
    view.setUint32(record + 8, entry.compLength)
    view.setUint32(record + 12, entry.origLength)
    bytes.set(entry.stored, entry.offset)
  })
  return bytes
}

export function buildCollection(spec: FontSpec): Uint8Array {
  const font = buildSfnt(spec)
  const headerSize = 16
  // Table offsets inside a collection are relative to the start of the file.
  const shifted = font.slice()
  const view = new DataView(shifted.buffer)
  const numTables = view.getUint16(4)
  for (let index = 0; index < numTables; index++) {
    const record = 12 + index * 16
    view.setUint32(record + 8, view.getUint32(record + 8) + headerSize)
  }
  const bytes = new Uint8Array(headerSize + shifted.length)
  const header = new DataView(bytes.buffer)
  writeTag(header, 0, 'ttcf')
  header.setUint32(4, 0x00010000)
  header.setUint32(8, 1)
  header.setUint32(12, headerSize)
  bytes.set(shifted, headerSize)
  return bytes
}

function tablesFor(spec: FontSpec): Array<{ tag: string; data: Uint8Array }> {
  const tables = [{ tag: 'name', data: nameTable(spec) }]
  if (spec.weight !== undefined || spec.italic !== undefined) {
    tables.push({ tag: 'OS/2', data: os2Table(spec.weight ?? 400, spec.italic ?? false) })
  }
  if (spec.weightAxis) {
    tables.push({ tag: 'fvar', data: fvarTable(spec.weightAxis) })
  }
  return tables.sort((a, b) => a.tag.localeCompare(b.tag))
}

/**
 * An OpenType font with a CFF table holding the given Type 2 charstrings, plus a `head` table.
 * Offsets in the Top DICT use the fixed 5-byte form, as font tools commonly write them.
 */
export function buildCffFont({
  glyphs,
  localSubrs = [],
  globalSubrs = [],
}: {
  glyphs: number[][]
  localSubrs?: number[][]
  globalSubrs?: number[][]
}): Uint8Array {
  const header = [1, 0, 4, 4]
  const names = cffIndex([Array.from('Test', (char) => char.charCodeAt(0))])
  const strings = cffIndex([])
  const globals = cffIndex(globalSubrs)
  const charStrings = cffIndex(glyphs)
  const privateDict = localSubrs.length > 0 ? [...dictInt(6), 19] : []
  const locals = localSubrs.length > 0 ? cffIndex(localSubrs) : []

  const topDictSize = 17
  const topDictIndexSize = cffIndex([new Array<number>(topDictSize).fill(0)]).length
  const charStringsOffset = header.length + names.length + topDictIndexSize + strings.length + globals.length
  const privateOffset = charStringsOffset + charStrings.length
  const topDict = [...dictInt(charStringsOffset), 17, ...dictInt(privateDict.length), ...dictInt(privateOffset), 18]

  const cff = Uint8Array.from([...header, ...names, ...cffIndex([topDict]), ...strings, ...globals, ...charStrings, ...privateDict, ...locals])
  const head = new Uint8Array(54)
  const headView = new DataView(head.buffer)
  headView.setUint32(0, 0x00010000)
  headView.setUint32(12, 0x5f0f3cf5)
  return assembleSfnt(
    [
      { tag: 'CFF ', data: cff },
      { tag: 'head', data: head },
    ],
    0x4f54544f,
  )
}

function cffIndex(items: number[][]): number[] {
  if (items.length === 0) {
    return [0, 0]
  }
  const result = [items.length >> 8, items.length & 0xff, 4]
  let offset = 1
  const offsets = [offset]
  for (const item of items) {
    offset += item.length
    offsets.push(offset)
  }
  for (const value of offsets) {
    result.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff)
  }
  for (const item of items) {
    result.push(...item)
  }
  return result
}

function dictInt(value: number): number[] {
  return [29, (value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
}

function assembleSfnt(tables: Array<{ tag: string; data: Uint8Array }>, signature: number): Uint8Array {
  let offset = 12 + tables.length * 16
  const placed = tables.map((table) => {
    const entry = { ...table, offset }
    offset += pad4(table.data.length)
    return entry
  })
  const bytes = new Uint8Array(offset)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, signature)
  view.setUint16(4, tables.length)
  placed.forEach((table, index) => {
    const record = 12 + index * 16
    writeTag(view, record, table.tag)
    view.setUint32(record + 8, table.offset)
    view.setUint32(record + 12, table.data.length)
    bytes.set(table.data, table.offset)
  })
  return bytes
}

function nameTable(spec: FontSpec): Uint8Array {
  const records: Array<{ platform: number; encoding: number; language: number; nameId: number; bytes: Uint8Array }> = []
  const add = (nameId: number, value: string | undefined) => {
    if (value !== undefined) {
      // A Mac Roman record in another language should lose to the Windows English one.
      records.push({ platform: 1, encoding: 0, language: 1, nameId, bytes: latin1('Wrong ' + value) })
      records.push({ platform: 3, encoding: 1, language: 0x409, nameId, bytes: utf16be(value) })
    }
  }
  add(1, spec.family)
  add(2, spec.subfamily)
  add(16, spec.typographicFamily)
  add(17, spec.typographicSubfamily)

  const headerSize = 6 + records.length * 12
  const storageSize = records.reduce((total, record) => total + record.bytes.length, 0)
  const bytes = new Uint8Array(headerSize + storageSize)
  const view = new DataView(bytes.buffer)
  view.setUint16(2, records.length)
  view.setUint16(4, headerSize)
  let stringOffset = 0
  records.forEach((record, index) => {
    const base = 6 + index * 12
    view.setUint16(base, record.platform)
    view.setUint16(base + 2, record.encoding)
    view.setUint16(base + 4, record.language)
    view.setUint16(base + 6, record.nameId)
    view.setUint16(base + 8, record.bytes.length)
    view.setUint16(base + 10, stringOffset)
    bytes.set(record.bytes, headerSize + stringOffset)
    stringOffset += record.bytes.length
  })
  return bytes
}

function os2Table(weight: number, italic: boolean): Uint8Array {
  const bytes = new Uint8Array(96)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, 4)
  view.setUint16(4, weight)
  view.setUint16(62, italic ? 0x1 : 0x40)
  return bytes
}

function fvarTable([min, max]: [number, number]): Uint8Array {
  const axisCount = 2
  const bytes = new Uint8Array(16 + axisCount * 20)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, 1)
  view.setUint16(4, 16)
  view.setUint16(8, axisCount)
  view.setUint16(10, 20)
  // An optical size axis first, to make sure the reader looks for the weight axis by tag.
  writeTag(view, 16, 'opsz')
  view.setInt32(20, 9 * 65536)
  view.setInt32(24, 14 * 65536)
  view.setInt32(28, 144 * 65536)
  writeTag(view, 36, 'wght')
  view.setInt32(40, min * 65536)
  view.setInt32(44, 400 * 65536)
  view.setInt32(48, max * 65536)
  return bytes
}

function utf16be(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length * 2)
  const view = new DataView(bytes.buffer)
  for (let index = 0; index < value.length; index++) {
    view.setUint16(index * 2, value.charCodeAt(index))
  }
  return bytes
}

function latin1(value: string): Uint8Array {
  return Uint8Array.from(value, (char) => char.charCodeAt(0) & 0xff)
}

function writeTag(view: DataView, offset: number, tag: string): void {
  for (let index = 0; index < 4; index++) {
    view.setUint8(offset + index, tag.charCodeAt(index))
  }
}

function pad4(length: number): number {
  return (length + 3) & ~3
}

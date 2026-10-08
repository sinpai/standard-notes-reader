import { detectFontFormat, readSfntDirectory } from './fontMetadata'

/** Type 2 charstring operators (see Adobe Technical Note #5177). */
const OP = {
  hstem: 1,
  vstem: 3,
  callsubr: 10,
  return: 11,
  escape: 12,
  endchar: 14,
  hstemhm: 18,
  hintmask: 19,
  cntrmask: 20,
  vstemhm: 23,
  shortint: 28,
} as const

const STEM_OPS = new Set<number>([OP.hstem, OP.vstem, OP.hstemhm, OP.vstemhm])

/** Top/Private DICT operators; two-byte operators are stored as 1200 + second byte. */
const DICT = { charStrings: 17, private: 18, subrs: 19, charstringType: 1206, fdArray: 1236 } as const

interface Program {
  start: number
  end: number
  /** Padding must never be executed: glyphs end at `endchar`, subroutines at `return`. */
  padding: number
}

export interface RepairResult {
  bytes: Uint8Array
  /** How many instructions were removed. */
  removed: number
}

/**
 * Some OpenType (CFF) fonts were exported with their hints stripped but still contain hint-mask
 * instructions (`hintmask`/`cntrmask`); the Literaturnaya family is one example. Native
 * renderers ignore them, but the OpenType sanitizer in Chrome, Firefox and the Standard Notes
 * desktop app rejects the whole font. Without hints these instructions do nothing, so they are
 * removed.
 *
 * Every program keeps its length: the removed bytes are re-added after the program's final
 * instruction, where nothing reads them, so no offsets in the font change.
 *
 * Returns `undefined` when the font does not have this problem or cannot be parsed.
 */
export function removeStrayHintMasks(input: Uint8Array): RepairResult | undefined {
  if (detectFontFormat(input) !== 'opentype') {
    return undefined
  }
  const bytes = input.slice()
  const view = new DataView(bytes.buffer)
  try {
    const tables = readSfntDirectory(view, 0)
    const cff = tables.get('CFF ')
    if (!cff) {
      return undefined
    }
    const programs = findPrograms(new Reader(bytes, cff.offset, cff.offset + cff.length))
    if (!programs) {
      return undefined
    }

    const masksByProgram: number[][] = []
    for (const program of programs) {
      const masks = findHintMasks(bytes, program)
      if (masks === 'has-stems') {
        // The font has real hints, so its masks are meaningful.
        return undefined
      }
      masksByProgram.push(masks)
    }

    let removed = 0
    programs.forEach((program, index) => {
      const masks = masksByProgram[index]!
      if (masks.length === 0) {
        return
      }
      const kept = Array.from(bytes.subarray(program.start, program.end)).filter(
        (_, offset) => !masks.includes(program.start + offset),
      )
      bytes.set(kept, program.start)
      bytes.fill(program.padding, program.start + kept.length, program.end)
      removed += masks.length
    })
    if (removed === 0) {
      return undefined
    }

    view.setUint32(cff.record + 4, checksum(bytes, cff.offset, cff.length))
    const head = tables.get('head')
    if (head && head.length >= 12) {
      view.setUint32(head.offset + 8, 0)
      view.setUint32(head.offset + 8, (0xb1b0afba - checksum(bytes, 0, bytes.length)) >>> 0)
    }
    return { bytes, removed }
  } catch {
    return undefined
  }
}

/**
 * Finds the positions of `hintmask`/`cntrmask` instructions in a program, or reports that the
 * font declares stem hints. With no stems declared, the masks carry no data bytes.
 */
function findHintMasks(bytes: Uint8Array, program: Program): number[] | 'has-stems' {
  const masks: number[] = []
  let operands = 0
  let index = program.start
  while (index < program.end) {
    const byte = bytes[index]!
    if (byte >= 32 && byte <= 246) {
      operands++
      index += 1
    } else if (byte >= 247 && byte <= 254) {
      operands++
      index += 2
    } else if (byte === 255) {
      operands++
      index += 5
    } else if (byte === OP.shortint) {
      operands++
      index += 3
    } else if (byte === OP.escape) {
      operands = 0
      index += 2
    } else if (STEM_OPS.has(byte)) {
      return 'has-stems'
    } else if (byte === OP.hintmask || byte === OP.cntrmask) {
      // Arguments other than the glyph width would declare stems.
      if (operands > 1) {
        return 'has-stems'
      }
      masks.push(index)
      operands = 0
      index += 1
    } else if (byte === OP.endchar || byte === OP.return) {
      break
    } else {
      operands = 0
      index += 1
    }
  }
  return masks
}

/** Locates every glyph program and subroutine in a CFF table. */
function findPrograms(reader: Reader): Program[] | undefined {
  const headerSize = reader.byte(reader.start + 2)
  const names = reader.index(reader.start + headerSize)
  const topDicts = reader.index(names.end)
  const strings = reader.index(topDicts.end)
  const globalSubrs = reader.index(strings.end)

  const topRange = topDicts.items[0]
  if (!topRange) {
    return undefined
  }
  const top = reader.dict(topRange[0], topRange[1])
  const charStringsOffset = top.get(DICT.charStrings)?.[0]
  if ((top.get(DICT.charstringType)?.[0] ?? 2) !== 2 || charStringsOffset === undefined) {
    return undefined
  }

  const programs: Program[] = reader
    .index(reader.start + charStringsOffset)
    .items.map(([start, end]) => ({ start, end, padding: OP.endchar }))
  const addSubrs = (ranges: Array<[number, number]>) => {
    for (const [start, end] of ranges) {
      if (!programs.some((program) => program.start === start)) {
        programs.push({ start, end, padding: OP.return })
      }
    }
  }
  addSubrs(globalSubrs.items)

  const privates: number[][] = []
  const fdArrayOffset = top.get(DICT.fdArray)?.[0]
  if (fdArrayOffset !== undefined) {
    for (const [start, end] of reader.index(reader.start + fdArrayOffset).items) {
      const fontDict = reader.dict(start, end).get(DICT.private)
      if (fontDict) privates.push(fontDict)
    }
  } else {
    const privateEntry = top.get(DICT.private)
    if (privateEntry) privates.push(privateEntry)
  }
  for (const [size, offset] of privates) {
    if (size === undefined || offset === undefined) continue
    const privateStart = reader.start + offset
    const subrsOffset = reader.dict(privateStart, privateStart + size).get(DICT.subrs)?.[0]
    if (subrsOffset !== undefined) {
      addSubrs(reader.index(privateStart + subrsOffset).items)
    }
  }
  return programs
}

/** Bounds-checked access to a CFF table inside the font file. */
class Reader {
  constructor(
    private readonly bytes: Uint8Array,
    readonly start: number,
    private readonly end: number,
  ) {}

  byte(position: number): number {
    if (position < this.start || position >= this.end) {
      throw new RangeError('Read outside the CFF table')
    }
    return this.bytes[position]!
  }

  /** Reads a CFF INDEX; returns the absolute byte range of each entry. */
  index(position: number): { items: Array<[number, number]>; end: number } {
    const count = (this.byte(position) << 8) | this.byte(position + 1)
    if (count === 0) {
      return { items: [], end: position + 2 }
    }
    const offSize = this.byte(position + 2)
    if (offSize < 1 || offSize > 4) {
      throw new RangeError('Invalid INDEX offset size')
    }
    const offsets = position + 3
    const dataStart = offsets + (count + 1) * offSize - 1
    const offsetAt = (item: number) => {
      let value = 0
      for (let byte = 0; byte < offSize; byte++) {
        value = value * 256 + this.byte(offsets + item * offSize + byte)
      }
      return dataStart + value
    }
    const items: Array<[number, number]> = []
    for (let item = 0; item < count; item++) {
      const start = offsetAt(item)
      const end = offsetAt(item + 1)
      if (end < start || end > this.end) {
        throw new RangeError('Invalid INDEX entry')
      }
      items.push([start, end])
    }
    return { items, end: offsetAt(count) }
  }

  /** Reads a DICT into operator → operands. */
  dict(start: number, end: number): Map<number, number[]> {
    const entries = new Map<number, number[]>()
    let operands: number[] = []
    let position = start
    while (position < end) {
      const byte = this.byte(position)
      if (byte <= 21) {
        const operator = byte === OP.escape ? 1200 + this.byte(position + 1) : byte
        position += byte === OP.escape ? 2 : 1
        entries.set(operator, operands)
        operands = []
      } else if (byte === 28) {
        operands.push(((this.byte(position + 1) << 8) | this.byte(position + 2)) << 16 >> 16)
        position += 3
      } else if (byte === 29) {
        operands.push(
          (this.byte(position + 1) << 24) |
            (this.byte(position + 2) << 16) |
            (this.byte(position + 3) << 8) |
            this.byte(position + 4),
        )
        position += 5
      } else if (byte === 30) {
        // Real number: nibbles until one is 0xf. Offsets are never real numbers.
        position++
        while ((this.byte(position) & 0x0f) !== 0x0f && this.byte(position) >> 4 !== 0x0f) {
          position++
        }
        position++
        operands.push(Number.NaN)
      } else if (byte >= 32 && byte <= 246) {
        operands.push(byte - 139)
        position += 1
      } else if (byte >= 247 && byte <= 250) {
        operands.push((byte - 247) * 256 + this.byte(position + 1) + 108)
        position += 2
      } else if (byte >= 251 && byte <= 254) {
        operands.push(-(byte - 251) * 256 - this.byte(position + 1) - 108)
        position += 2
      } else {
        throw new RangeError('Invalid DICT data')
      }
    }
    return entries
  }
}

/** OpenType table checksum: the sum of the data as big-endian 32-bit words. */
function checksum(bytes: Uint8Array, offset: number, length: number): number {
  let sum = 0
  for (let position = offset; position < offset + length; position += 4) {
    let word = 0
    for (let byte = 0; byte < 4; byte++) {
      const index = position + byte
      word = word * 256 + (index < offset + length ? bytes[index]! : 0)
    }
    sum = (sum + word) % 0x100000000
  }
  return sum
}

import { describe, expect, it } from 'vitest'
import { removeStrayHintMasks } from '../src/fonts/cffRepair'
import { readSfntDirectory } from '../src/fonts/fontMetadata'
import { buildCffFont, buildSfnt } from './helpers/sfnt'

// Type 2 charstring bytes. Numbers -107..107 are encoded as value + 139.
const n = (value: number) => value + 139
const RMOVETO = 21
const RLINETO = 5
const ENDCHAR = 14
const RETURN = 11
const CALLSUBR = 10
const HSTEM = 1
const HINTMASK = 19
const CNTRMASK = 20

/** "76 cntrmask 0 0 rmoveto 10 0 rlineto endchar": a width, then a mask without any hints. */
const glyphWithStrayMask = [n(76), CNTRMASK, n(0), n(0), RMOVETO, n(10), n(0), RLINETO, ENDCHAR]
/** Calls local subroutine 0 (index 0 is passed as -107 because of the subroutine bias). */
const glyphCallingSubr = [n(0), n(0), RMOVETO, n(-107), CALLSUBR, ENDCHAR]
const subrWithStrayMask = [HINTMASK, n(10), n(10), RLINETO, RETURN]

function cffTable(font: Uint8Array): Uint8Array {
  const record = readSfntDirectory(new DataView(font.buffer, font.byteOffset, font.byteLength), 0).get('CFF ')!
  return font.subarray(record.offset, record.offset + record.length)
}

function containsSequence(haystack: Uint8Array, needle: number[]): boolean {
  return Buffer.from(haystack).includes(Buffer.from(needle))
}

function checksum(bytes: Uint8Array, offset: number, length: number): number {
  let sum = 0
  for (let position = offset; position < offset + length; position += 4) {
    let word = 0
    for (let byte = 0; byte < 4; byte++) {
      word = word * 256 + (position + byte < offset + length ? bytes[position + byte]! : 0)
    }
    sum = (sum + word) % 0x100000000
  }
  return sum
}

describe('removeStrayHintMasks', () => {
  const font = buildCffFont({
    glyphs: [[ENDCHAR], glyphWithStrayMask, glyphCallingSubr],
    localSubrs: [subrWithStrayMask],
  })

  it('removes hint masks from glyphs and subroutines when the font declares no hints', () => {
    const result = removeStrayHintMasks(font)!
    expect(result.removed).toBe(2)
    expect(result.bytes.length).toBe(font.length)

    const cff = cffTable(result.bytes)
    // The width stays in front of the first drawing instruction; the freed byte goes after the end.
    expect(containsSequence(cff, [n(76), n(0), n(0), RMOVETO, n(10), n(0), RLINETO, ENDCHAR, ENDCHAR])).toBe(true)
    expect(containsSequence(cff, [n(10), n(10), RLINETO, RETURN, RETURN])).toBe(true)
    expect(containsSequence(cff, [n(76), CNTRMASK])).toBe(false)
    expect(containsSequence(cff, [HINTMASK, n(10), n(10)])).toBe(false)
  })

  it('does not modify the input and keeps the font checksums valid', () => {
    const original = font.slice()
    const { bytes } = removeStrayHintMasks(font)!
    expect(font).toEqual(original)

    const view = new DataView(bytes.buffer)
    const record = readSfntDirectory(view, 0).get('CFF ')!
    expect(view.getUint32(record.record + 4)).toBe(checksum(bytes, record.offset, record.length))
    expect(checksum(bytes, 0, bytes.length)).toBe(0xb1b0afba)
  })

  it('leaves fonts with real hints alone', () => {
    const hinted = buildCffFont({
      glyphs: [[ENDCHAR], [n(76), n(0), n(10), HSTEM, HINTMASK, 0x80, n(0), n(0), RMOVETO, ENDCHAR]],
    })
    expect(removeStrayHintMasks(hinted)).toBeUndefined()
  })

  it('leaves fonts without hint masks alone', () => {
    expect(removeStrayHintMasks(buildCffFont({ glyphs: [[ENDCHAR], [n(0), n(0), RMOVETO, ENDCHAR]] }))).toBeUndefined()
  })

  it('ignores TrueType fonts and damaged CFF tables', () => {
    expect(removeStrayHintMasks(buildSfnt({ family: 'TrueType' }))).toBeUndefined()

    // Claim a CFF table too short to hold the glyphs it points to.
    const damaged = font.slice()
    const view = new DataView(damaged.buffer)
    view.setUint32(readSfntDirectory(view, 0).get('CFF ')!.record + 12, 40)
    expect(removeStrayHintMasks(damaged)).toBeUndefined()
  })
})

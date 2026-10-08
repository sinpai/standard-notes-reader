import { describe, expect, it } from 'vitest'
import { base64ToBytes, gunzip } from '../src/fonts/codec'
import {
  FontImportError,
  MAX_FONT_FILE_BYTES,
  MAX_LIBRARY_BYTES,
  addFaceToLibrary,
  describeFace,
  groupFamilies,
  importFontFile,
  parseStoredFaces,
} from '../src/fonts/library'
import type { StoredFontFace } from '../src/fonts/types'
import { buildSfnt } from './helpers/sfnt'

const validate = async () => {}

function fontFile(name: string, bytes: Uint8Array): File {
  return new File([bytes as BlobPart], name)
}

function face(overrides: Partial<StoredFontFace>): StoredFontFace {
  return {
    id: 'face',
    familyId: 'family',
    family: 'Family',
    weight: 400,
    italic: false,
    fileName: 'family.ttf',
    format: 'truetype',
    size: 100,
    encoding: 'base64',
    data: 'AAAA',
    addedAt: 0,
    ...overrides,
  }
}

describe('importFontFile', () => {
  it('stores TrueType fonts gzipped, and they decode back to the original bytes', async () => {
    // Repetitive padding makes the synthetic font compressible, like real fonts.
    const bytes = new Uint8Array([...buildSfnt({ family: 'Literata', weight: 400 }), ...new Uint8Array(4096)])
    const result = await importFontFile(fontFile('Literata-Regular.ttf', bytes), [], { validate })

    expect(result).toMatchObject({ family: 'Literata', weight: 400, italic: false, format: 'truetype' })
    expect(result.encoding).toBe('gzip+base64')
    expect(await gunzip(base64ToBytes(result.data))).toEqual(bytes)
  })

  it('stores already-compressed WOFF2 files as-is and guesses the style from the file name', async () => {
    const bytes = new Uint8Array(256)
    bytes.set(new TextEncoder().encode('wOF2'))
    const result = await importFontFile(fontFile('Literata-BoldItalic.woff2', bytes), [], { validate })

    expect(result).toMatchObject({ family: 'Literata', weight: 700, italic: true, encoding: 'base64' })
    expect(base64ToBytes(result.data)).toEqual(bytes)
  })

  it('joins an existing family with the same name', async () => {
    const existing = face({ familyId: 'abc', family: 'Literata' })
    const bold = buildSfnt({ family: 'literata', weight: 700 })
    const result = await importFontFile(fontFile('Literata-Bold.ttf', bold), [existing], { validate })

    expect(result.familyId).toBe('abc')
    expect(result.family).toBe('Literata')
  })

  it('keeps the weight range of variable fonts', async () => {
    const bytes = buildSfnt({ family: 'Fraunces', weight: 400, weightAxis: [100, 900] })
    const result = await importFontFile(fontFile('Fraunces[wght].ttf', bytes), [], { validate })
    expect(result.weight).toEqual([100, 900])
    expect(describeFace(result)).toBe('Variable 100–900')
  })

  it('rejects files that are not fonts', async () => {
    const file = fontFile('notes.ttf', new TextEncoder().encode('just some text, not a font'))
    await expect(importFontFile(file, [], { validate })).rejects.toThrow(FontImportError)
  })

  it('rejects fonts the browser cannot load', async () => {
    const file = fontFile('broken.ttf', buildSfnt({ family: 'Broken' }))
    const failing = async () => {
      throw new Error('OTS parsing error')
    }
    await expect(importFontFile(file, [], { validate: failing })).rejects.toThrow('could not be loaded')
  })

  it('rejects files over the size limit before reading them', async () => {
    const file = fontFile('huge.ttf', new Uint8Array(MAX_FONT_FILE_BYTES + 1))
    await expect(importFontFile(file, [], { validate })).rejects.toThrow('WOFF2')
  })
})

describe('addFaceToLibrary', () => {
  it('replaces a face with the same family, weight and style', () => {
    const regular = face({ id: 'old' })
    const italic = face({ id: 'italic', italic: true })
    const replacement = face({ id: 'new' })

    expect(addFaceToLibrary([regular, italic], replacement).map((item) => item.id)).toEqual(['italic', 'new'])
  })

  it('enforces the library size budget', () => {
    const big = face({ id: 'big', data: 'A'.repeat(MAX_LIBRARY_BYTES - 10) })
    const another = face({ id: 'another', familyId: 'other', data: 'A'.repeat(100) })
    expect(() => addFaceToLibrary([big], another)).toThrow(FontImportError)
  })
})

describe('groupFamilies', () => {
  it('groups faces by family and orders styles', () => {
    const families = groupFamilies([
      face({ id: 'b', familyId: 'lit', family: 'Literata', weight: 700 }),
      face({ id: 'i', familyId: 'lit', family: 'Literata', italic: true }),
      face({ id: 'r', familyId: 'lit', family: 'Literata' }),
      face({ id: 'a', familyId: 'atk', family: 'Atkinson' }),
    ])
    expect(families.map((family) => family.family)).toEqual(['Atkinson', 'Literata'])
    expect(families[1]!.faces.map(describeFace)).toEqual(['Regular', 'Italic', 'Bold'])
  })
})

describe('parseStoredFaces', () => {
  it('keeps valid faces and drops malformed ones', () => {
    const valid = face({ id: 'ok' })
    const parsed = parseStoredFaces([valid, { id: 'missing-data' }, null, 'nope', { ...valid, weight: 'bold' }])
    expect(parsed).toEqual([valid])
  })

  it('returns an empty library for missing data', () => {
    expect(parseStoredFaces(undefined)).toEqual([])
  })
})

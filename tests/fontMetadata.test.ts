import { describe, expect, it } from 'vitest'
import { detectFontFormat, readFontMetadata } from '../src/fonts/fontMetadata'
import { buildCollection, buildSfnt, buildWoff } from './helpers/sfnt'

describe('detectFontFormat', () => {
  it('recognizes font signatures', () => {
    expect(detectFontFormat(buildSfnt({ family: 'A' }))).toBe('truetype')
    expect(detectFontFormat(buildSfnt({ family: 'A', signature: 'opentype' }))).toBe('opentype')
    expect(detectFontFormat(buildWoff({ family: 'A' }))).toBe('woff')
    expect(detectFontFormat(buildCollection({ family: 'A' }))).toBe('collection')
    expect(detectFontFormat(new TextEncoder().encode('wOF2 plus some more bytes'))).toBe('woff2')
  })

  it('rejects files that are not fonts', () => {
    expect(detectFontFormat(new TextEncoder().encode('<!doctype html><html>'))).toBeUndefined()
    expect(detectFontFormat(new Uint8Array([0, 1]))).toBeUndefined()
  })
})

describe('readFontMetadata', () => {
  it('reads family, weight and style of a static font', async () => {
    const metadata = await readFontMetadata(
      buildSfnt({ family: 'Literata', subfamily: 'Bold Italic', weight: 700, italic: true }),
    )
    expect(metadata).toMatchObject({ family: 'Literata', subfamily: 'Bold Italic', weight: 700, italic: true })
    expect(metadata.weightRange).toBeUndefined()
  })

  it('prefers typographic names over legacy family names', async () => {
    const metadata = await readFontMetadata(
      buildSfnt({
        family: 'Inter SemiBold',
        subfamily: 'Regular',
        typographicFamily: 'Inter',
        typographicSubfamily: 'SemiBold',
        weight: 600,
      }),
    )
    expect(metadata.family).toBe('Inter')
    expect(metadata.subfamily).toBe('SemiBold')
    expect(metadata.italic).toBe(false)
  })

  it('reads the weight range of a variable font', async () => {
    const metadata = await readFontMetadata(buildSfnt({ family: 'Fraunces', weight: 400, weightAxis: [100, 900] }))
    expect(metadata.weightRange).toEqual([100, 900])
  })

  it('reads compressed WOFF tables', async () => {
    const metadata = await readFontMetadata(buildWoff({ family: 'Source Serif 4', weight: 300, italic: true }))
    expect(metadata).toMatchObject({ family: 'Source Serif 4', weight: 300, italic: true })
  })

  it('reads the first font of a collection', async () => {
    const metadata = await readFontMetadata(buildCollection({ family: 'Avenir Next', weight: 500 }))
    expect(metadata).toMatchObject({ family: 'Avenir Next', weight: 500 })
  })

  it('falls back to the subfamily name when OS/2 is missing', async () => {
    const metadata = await readFontMetadata(buildSfnt({ family: 'Old Font', subfamily: 'Oblique' }))
    expect(metadata.italic).toBe(true)
  })

  it('returns nothing for WOFF2, whose tables browsers cannot decompress', async () => {
    const bytes = new Uint8Array(64)
    bytes.set(new TextEncoder().encode('wOF2'))
    expect(await readFontMetadata(bytes)).toEqual({})
  })
})

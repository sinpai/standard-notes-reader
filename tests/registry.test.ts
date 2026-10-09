import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { findBuiltinFont } from '../src/fonts/builtin'
import { removeStrayHintMasks } from '../src/fonts/cffRepair'
import { bytesToBase64 } from '../src/fonts/codec'
import { FontRegistry, cssFamilyForImported } from '../src/fonts/registry'
import type { StoredFontFace } from '../src/fonts/types'
import { buildCffFont } from './helpers/sfnt'

/** Behaves like Chrome's FontFace: rejects fonts that still contain stray hint masks. */
class StrictFontFace {
  status = 'unloaded'

  constructor(
    readonly family: string,
    private readonly source: Uint8Array,
    readonly descriptors: FontFaceDescriptors,
  ) {}

  load(): Promise<this> {
    if (removeStrayHintMasks(new Uint8Array(this.source))) {
      return Promise.reject(new DOMException('Invalid font data in ArrayBuffer.', 'SyntaxError'))
    }
    this.status = 'loaded'
    return Promise.resolve(this)
  }
}

describe('FontRegistry', () => {
  const added: StrictFontFace[] = []
  const fontSet = {
    add: (face: StrictFontFace) => added.push(face),
    delete: () => true,
  } as unknown as FontFaceSet

  beforeEach(() => {
    added.length = 0
    vi.stubGlobal('FontFace', StrictFontFace)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads fonts that were stored without the repair, as Safari imports used to be', async () => {
    const original = buildCffFont({ glyphs: [[14], [76 + 139, 20, 139, 139, 21, 14]] })
    const stored: StoredFontFace = {
      id: 'face-1',
      familyId: 'lit20',
      family: 'Literaturnaya 20',
      weight: 700,
      italic: true,
      fileName: 'Literaturnaya20-BoldItalic.otf',
      format: 'opentype',
      size: original.length,
      encoding: 'base64',
      data: bytesToBase64(original),
      addedAt: 0,
    }

    await new FontRegistry(fontSet).ensureFamily('lit20', [stored])

    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({
      family: cssFamilyForImported('lit20'),
      status: 'loaded',
      descriptors: { weight: '700', style: 'italic' },
    })
  })
})

/** Records how a font shipped with the plugin is registered and loaded. */
class UrlFontFace {
  loads = 0

  constructor(
    readonly family: string,
    readonly source: string,
    readonly descriptors: FontFaceDescriptors,
  ) {}

  load(): Promise<this> {
    this.loads++
    return Promise.resolve(this)
  }
}

describe('FontRegistry built-in fonts', () => {
  const base = 'https://example.github.io/standard-notes-reader/index.html?load=1'
  const added: UrlFontFace[] = []
  const fontSet = { add: (face: UrlFontFace) => added.push(face), delete: () => true } as unknown as FontFaceSet

  beforeEach(() => {
    added.length = 0
    vi.stubGlobal('FontFace', UrlFontFace)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('registers every face next to index.html but downloads only the one used for text', async () => {
    const registry = new FontRegistry(fontSet)
    await registry.ensureBuiltin(findBuiltinFont('old-standard-tt-bold')!, base)

    expect(added.map((face) => [face.source, face.descriptors.weight, face.descriptors.style])).toEqual([
      ['url("https://example.github.io/standard-notes-reader/fonts/old-standard-tt/OldStandard-Regular.ttf")', '400', 'normal'],
      ['url("https://example.github.io/standard-notes-reader/fonts/old-standard-tt/OldStandard-Italic.ttf")', '400', 'italic'],
      ['url("https://example.github.io/standard-notes-reader/fonts/old-standard-tt/OldStandard-Bold.ttf")', '700', 'normal'],
    ])
    expect(added.every((face) => face.family === 'snr-builtin-old-standard-tt')).toBe(true)
    // Bold text: only the bold file is downloaded up front; the others load if a note needs them.
    expect(added.map((face) => face.loads)).toEqual([0, 0, 1])

    // The regular variant reuses the same faces.
    await registry.ensureBuiltin(findBuiltinFont('old-standard-tt')!, base)
    expect(added).toHaveLength(3)
    expect(added.map((face) => face.loads)).toEqual([1, 0, 1])
  })
})

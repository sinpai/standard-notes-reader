import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

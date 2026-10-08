import { describe, expect, it } from 'vitest'
import { cssString, decodeFontRef, encodeFontRef, fontStack } from '../src/fonts/stack'
import type { FontRef } from '../src/fonts/types'
import { makePreview } from '../src/note/preview'
import { DEFAULT_SETTINGS, parseSettings } from '../src/settings'

describe('parseSettings', () => {
  it('uses defaults for missing data', () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps valid values and repairs invalid ones', () => {
    const settings = parseSettings({
      textFont: { type: 'installed', family: '  Iosevka ' },
      codeFont: { type: 'imported' },
      fontSize: 400,
      lineHeight: 'tall',
      width: 'wide',
      defaultView: 'read',
      installedFonts: ['Iosevka', 'iosevka', ' ', 3, 'Literata'],
    })
    expect(settings).toMatchObject({
      textFont: { type: 'installed', family: 'Iosevka' },
      codeFont: DEFAULT_SETTINGS.codeFont,
      fontSize: 32,
      lineHeight: DEFAULT_SETTINGS.lineHeight,
      width: 'wide',
      defaultView: 'read',
      installedFonts: ['Iosevka', 'Literata'],
    })
  })
})

describe('font references', () => {
  const refs: FontRef[] = [
    { type: 'theme' },
    { type: 'generic', family: 'serif' },
    { type: 'installed', family: 'Atkinson Hyperlegible: Next' },
    { type: 'imported', familyId: 'a1b2c3' },
  ]

  it.each(refs)('round-trips %o through option values', (ref) => {
    expect(decodeFontRef(encodeFontRef(ref))).toEqual(ref)
  })

  it('builds font stacks with fallbacks', () => {
    expect(fontStack({ type: 'installed', family: 'Iosevka' }, 'serif')).toBe('"Iosevka", serif')
    expect(fontStack({ type: 'imported', familyId: 'a1b2c3' }, 'serif')).toBe('"snr-a1b2c3", serif')
    expect(fontStack({ type: 'theme' }, 'serif')).toBe('serif')
  })

  it('escapes font names', () => {
    expect(cssString('My "Font"\\x')).toBe('"My \\"Font\\"\\\\x"')
  })
})

describe('makePreview', () => {
  it('strips Markdown syntax', () => {
    expect(makePreview('# Title\n\n- [x] **Done** item\n> quote with [a link](https://x.y)\n```js\ncode()\n```')).toBe(
      'Title Done item quote with a link code()',
    )
  })

  it('truncates long text', () => {
    const preview = makePreview('word '.repeat(100))
    expect(preview.length).toBeLessThanOrEqual(201)
    expect(preview.endsWith('…')).toBe(true)
  })
})

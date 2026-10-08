import { describe, expect, it } from 'vitest'
import { hintsFromFileName } from '../src/fonts/fileNameHints'

describe('hintsFromFileName', () => {
  it.each([
    ['Literata-BoldItalic.woff2', { family: 'Literata', weight: 700, italic: true }],
    ['Inter_18pt-SemiBold.ttf', { family: 'Inter 18pt', weight: 600, italic: false }],
    ['IBMPlexSerif-LightItalic.otf', { family: 'IBM Plex Serif', weight: 300, italic: true }],
    ['OpenSans-Regular.ttf', { family: 'Open Sans', weight: 400, italic: false }],
    ['SourceSerif4-Italic[opsz,wght].ttf', { family: 'Source Serif 4', weight: undefined, italic: true }],
    ['Roboto-VariableFont_wdth,wght.ttf', { family: 'Roboto', weight: undefined, italic: false }],
    ['EB_Garamond-ExtraBold.woff', { family: 'EB Garamond', weight: 800, italic: false }],
    ['Iosevka-Extended.ttf', { family: 'Iosevka Extended', weight: undefined, italic: false }],
    ['Pacifico.ttf', { family: 'Pacifico', weight: undefined, italic: false }],
  ])('%s', (fileName, expected) => {
    expect(hintsFromFileName(fileName)).toEqual(expected)
  })
})

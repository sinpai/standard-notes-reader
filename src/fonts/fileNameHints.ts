export interface FileNameHints {
  family: string
  weight?: number
  italic: boolean
}

const WEIGHT_WORDS: Array<[RegExp, number]> = [
  [/^(thin|hairline)$/, 100],
  [/^(extra|ultra)light$/, 200],
  [/^light$/, 300],
  [/^(regular|normal|book|roman|text)$/, 400],
  [/^medium$/, 500],
  [/^(semi|demi)bold$/, 600],
  [/^bold$/, 700],
  [/^(extra|ultra)bold$/, 800],
  [/^(black|heavy)$/, 900],
]

/**
 * Guesses family and style from names like "Literata-BoldItalic.woff2", "Inter_18pt-SemiBold.ttf"
 * or "SourceSerif4[opsz,wght].ttf". Used when the font's own tables cannot be read (WOFF2).
 */
export function hintsFromFileName(fileName: string): FileNameHints {
  const base = fileName
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[-_]?VariableFont(_[a-z,]+)?$/i, '')
    .replace(/[-_]?Variable$/i, '')
    .trim()

  let familyPart = base
  let stylePart = ''
  const separator = Math.max(base.lastIndexOf('-'), base.lastIndexOf('_'))
  if (separator > 0) {
    const candidate = base.slice(separator + 1)
    if (parseStyle(candidate).recognized) {
      familyPart = base.slice(0, separator)
      stylePart = candidate
    }
  }

  const style = parseStyle(stylePart)
  return {
    family: humanizeFamily(familyPart) || 'Imported font',
    weight: style.weight,
    italic: style.italic,
  }
}

function parseStyle(value: string): { recognized: boolean; weight?: number; italic: boolean } {
  const words = splitWords(value).map((word) => word.toLowerCase())
  // Join compound words such as "Semi Bold" or "Extra Light" back together.
  const joined: string[] = []
  for (let index = 0; index < words.length; index++) {
    const word = words[index]!
    const next = words[index + 1]
    if (next && /^(semi|demi|extra|ultra)$/.test(word)) {
      joined.push(word + next)
      index++
    } else {
      joined.push(word)
    }
  }

  let weight: number | undefined
  let italic = false
  let recognized = joined.length > 0
  for (const word of joined) {
    if (word === 'italic' || word === 'oblique' || word === 'it') {
      italic = true
      continue
    }
    const match = WEIGHT_WORDS.find(([pattern]) => pattern.test(word))
    if (match) {
      weight = match[1]
    } else {
      recognized = false
    }
  }
  return { recognized, weight, italic }
}

function splitWords(value: string): string[] {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter(Boolean)
}

function humanizeFamily(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
}

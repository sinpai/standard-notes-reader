const PREVIEW_LENGTH = 200

/** Plain-text preview shown in Standard Notes' note list. */
export function makePreview(text: string): string {
  const plain = text
    .replace(/```[^\n]*\n?/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/gm, '')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (plain.length <= PREVIEW_LENGTH) {
    return plain
  }
  return `${plain.slice(0, PREVIEW_LENGTH).trimEnd()}…`
}

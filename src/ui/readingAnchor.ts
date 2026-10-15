import { FINGERPRINT_LENGTH, type ReadingPosition } from '../note/readingPosition'

/** Where a block of the rendered note sits, in the scroll container's content coordinates. */
export interface BlockMetrics {
  top: number
  height: number
}

/**
 * Finds the block at `scrollTop`: the first one that ends below it. Blocks are in document
 * order, so a binary search measures only a handful of them, even in book-length notes.
 */
export function findBlockAt(count: number, measure: (index: number) => BlockMetrics, scrollTop: number): number {
  let low = 0
  let high = count - 1
  let found = count - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const { top, height } = measure(middle)
    if (top + height > scrollTop) {
      found = middle
      high = middle - 1
    } else {
      low = middle + 1
    }
  }
  return found
}

/**
 * Finds a saved block again: at its index if the text there still matches, otherwise the
 * nearest block with the same text (blocks were added or removed above it).
 */
export function matchBlock(count: number, textOf: (index: number) => string, position: ReadingPosition): number | undefined {
  const fits = (index: number) => index >= 0 && index < count && (position.text === '' || textOf(index) === position.text)
  if (fits(position.block)) {
    return position.block
  }
  if (position.text === '') {
    return undefined
  }
  for (let distance = 1; distance < count; distance++) {
    if (fits(position.block - distance)) return position.block - distance
    if (fits(position.block + distance)) return position.block + distance
  }
  return undefined
}

/** The start of an element's text, with whitespace collapsed. Reads only the first text nodes. */
export function fingerprint(element: Element): string {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let text = ''
  while (text.length < FINGERPRINT_LENGTH * 4 && walker.nextNode()) {
    text += walker.currentNode.nodeValue ?? ''
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, FINGERPRINT_LENGTH)
}

/** The reading position at the top of `scroller`; `content`'s children are the note's blocks. */
export function captureReadingPosition(scroller: HTMLElement, content: HTMLElement): ReadingPosition | undefined {
  const blocks = content.children
  if (blocks.length === 0) {
    return undefined
  }
  const measure = measurer(scroller)
  const scrollTop = scroller.scrollTop
  const index = findBlockAt(blocks.length, (i) => measure(blocks[i]!), scrollTop)
  const { top, height } = measure(blocks[index]!)
  const scrollable = scroller.scrollHeight - scroller.clientHeight
  return {
    block: index,
    offset: round(height > 0 ? clamp((scrollTop - top) / height) : 0),
    text: fingerprint(blocks[index]!),
    ratio: round(scrollable > 0 ? clamp(scrollTop / scrollable) : 0),
  }
}

/** Scrolls so that `position` is at the top of `scroller`. */
export function scrollToReadingPosition(scroller: HTMLElement, content: HTMLElement, position: ReadingPosition): void {
  const blocks = content.children
  const index = matchBlock(blocks.length, (i) => fingerprint(blocks[i]!), position)
  if (index === undefined) {
    scroller.scrollTop = position.ratio * (scroller.scrollHeight - scroller.clientHeight)
  } else if (index === 0 && position.offset === 0) {
    // The very start of the note, including the space above the first block.
    scroller.scrollTop = 0
  } else {
    const { top, height } = measurer(scroller)(blocks[index]!)
    scroller.scrollTop = top + position.offset * height
  }
}

function measurer(scroller: HTMLElement): (element: Element) => BlockMetrics {
  const origin = scroller.getBoundingClientRect().top - scroller.scrollTop
  return (element) => {
    const rect = element.getBoundingClientRect()
    return { top: rect.top - origin, height: rect.height }
  }
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** Keeps stored positions short. */
function round(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

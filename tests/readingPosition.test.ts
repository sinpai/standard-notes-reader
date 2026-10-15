// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ReadingPositionTracker,
  minSaveIntervalFor,
  parseReadingPosition,
  type ReadingPosition,
} from '../src/note/readingPosition'
import { findBlockAt, fingerprint, matchBlock } from '../src/ui/readingAnchor'

const position = (block: number, text = `Block ${block}`): ReadingPosition => ({ block, offset: 0.25, text, ratio: 0.5 })

describe('parseReadingPosition', () => {
  it('accepts a stored position and repairs out-of-range values', () => {
    expect(parseReadingPosition({ block: 12.7, offset: 1.5, text: 'Chapter 3', ratio: -1 })).toEqual({
      block: 12,
      offset: 1,
      text: 'Chapter 3',
      ratio: 0,
    })
  })

  it('rejects data that is not a position', () => {
    expect(parseReadingPosition(undefined)).toBeUndefined()
    expect(parseReadingPosition({ block: '3', offset: 0, ratio: 0 })).toBeUndefined()
    expect(parseReadingPosition({ block: 3, offset: Number.NaN, ratio: 0 })).toBeUndefined()
  })
})

describe('minSaveIntervalFor', () => {
  it('saves large notes less often, between 15 seconds and 2 minutes', () => {
    expect(minSaveIntervalFor(5_000)).toBe(15_000)
    expect(minSaveIntervalFor(739_000)).toBe(73_900)
    expect(minSaveIntervalFor(5_000_000)).toBe(120_000)
  })
})

describe('ReadingPositionTracker', () => {
  let saved: Array<{ position: ReadingPosition; immediate: boolean }>
  let tracker: ReadingPositionTracker

  beforeEach(() => {
    vi.useFakeTimers()
    saved = []
    tracker = new ReadingPositionTracker({
      save: (position, immediate) => saved.push({ position, immediate }),
      settleMs: 2000,
      minIntervalMs: 15_000,
    })
    tracker.reset(0)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('saves once scrolling settles, with the last position', () => {
    tracker.update(position(3), 900, 800)
    vi.advanceTimersByTime(1000)
    tracker.update(position(5), 1500, 800)
    vi.advanceTimersByTime(1999)
    expect(saved).toEqual([])
    vi.advanceTimersByTime(1)
    expect(saved).toEqual([{ position: position(5), immediate: false }])
  })

  it('does not save small movements, nor a return to the saved position', () => {
    tracker.update(position(1), 300, 800)
    vi.advanceTimersByTime(5000)
    expect(saved).toEqual([])

    tracker.update(position(4), 1200, 800)
    tracker.update(position(0), 100, 800)
    vi.advanceTimersByTime(5000)
    expect(saved).toEqual([])
  })

  it('leaves the minimum interval between saves', () => {
    tracker.update(position(3), 900, 800)
    vi.advanceTimersByTime(2000)
    expect(saved).toHaveLength(1)

    // Scrolling settles right after the first save; the next one waits for the 15 s interval.
    tracker.update(position(6), 1800, 800)
    vi.advanceTimersByTime(14_999)
    expect(saved).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(saved.map((entry) => entry.position.block)).toEqual([3, 6])
  })

  it('measures movement from the last saved position', () => {
    tracker.update(position(3), 900, 800)
    vi.advanceTimersByTime(2000)
    // 300 px below the saved position: less than half a screen.
    tracker.update(position(4), 1200, 800)
    vi.advanceTimersByTime(30_000)
    expect(saved).toHaveLength(1)
  })

  it('saves a pending position right away when flushed, and only once', () => {
    tracker.update(position(3), 900, 800)
    tracker.flush()
    tracker.flush()
    vi.advanceTimersByTime(30_000)
    expect(saved).toEqual([{ position: position(3), immediate: true }])
  })

  it('forgets a pending position when reset', () => {
    tracker.update(position(3), 900, 800)
    tracker.reset(900)
    vi.advanceTimersByTime(30_000)
    tracker.flush()
    expect(saved).toEqual([])
  })
})

describe('findBlockAt', () => {
  // Blocks of 100 px with 20 px gaps: 0–100, 120–220, 240–340, ...
  const measure = (index: number) => ({ top: index * 120, height: 100 })

  it('finds the first block that ends below the top of the screen', () => {
    expect(findBlockAt(50, measure, 0)).toBe(0)
    expect(findBlockAt(50, measure, 99)).toBe(0)
    expect(findBlockAt(50, measure, 105)).toBe(1)
    expect(findBlockAt(50, measure, 2450)).toBe(20)
  })

  it('measures only a few blocks', () => {
    const measured: number[] = []
    findBlockAt(10_000, (index) => (measured.push(index), measure(index)), 600_000)
    expect(measured.length).toBeLessThanOrEqual(15)
  })

  it('returns the last block below the end of the text', () => {
    expect(findBlockAt(5, measure, 10_000)).toBe(4)
  })
})

describe('matchBlock', () => {
  const texts = ['Title', 'First paragraph', 'Second paragraph', 'Third paragraph']
  const textOf = (index: number) => texts[index]!

  it('uses the saved index when the text still matches', () => {
    expect(matchBlock(texts.length, textOf, position(2, 'Second paragraph'))).toBe(2)
  })

  it('follows the block when paragraphs were added or removed above it', () => {
    expect(matchBlock(texts.length, textOf, position(1, 'Second paragraph'))).toBe(2)
    expect(matchBlock(texts.length, textOf, position(3, 'First paragraph'))).toBe(1)
  })

  it('gives up when the block is gone, so the caller falls back to the ratio', () => {
    expect(matchBlock(texts.length, textOf, position(2, 'Deleted paragraph'))).toBeUndefined()
    expect(matchBlock(texts.length, textOf, position(9, ''))).toBeUndefined()
  })

  it('matches blocks without text (images, rules) by index', () => {
    expect(matchBlock(texts.length, textOf, position(3, ''))).toBe(3)
  })
})

describe('fingerprint', () => {
  it('collapses whitespace and keeps the first 60 characters', () => {
    const element = document.createElement('div')
    element.innerHTML = `<p>  Chapter\n<b>one</b>   ${'word '.repeat(40)}</p>`
    expect(fingerprint(element)).toBe(`Chapter one ${'word '.repeat(10)}`.slice(0, 60).trim())
  })
})

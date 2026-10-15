/**
 * Where the reader stopped in a note's Read view. It is anchored to a block of the rendered note
 * (paragraph, heading, list, ...) rather than to pixels, so it carries over to devices with
 * other screen sizes and fonts.
 */
export interface ReadingPosition {
  /** Index of the block at the top of the screen. */
  block: number
  /** How far into that block the screen starts, from 0 to 1. */
  offset: number
  /** The start of the block's text, to find the block again after edits above it. */
  text: string
  /** The position as a fraction of the whole note, used when the block cannot be found. */
  ratio: number
}

export const FINGERPRINT_LENGTH = 60

/** Only saves after the reader moved at least this many screens since the last save. */
const MIN_MOVE_SCREENS = 0.5

/** Validates a position read from a note's plugin data, which other versions may have written. */
export function parseReadingPosition(value: unknown): ReadingPosition | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const raw = value as Record<string, unknown>
  if (!isFiniteNumber(raw.block) || !isFiniteNumber(raw.offset) || !isFiniteNumber(raw.ratio)) {
    return undefined
  }
  return {
    block: Math.max(0, Math.floor(raw.block)),
    offset: clamp(raw.offset, 0, 1),
    text: typeof raw.text === 'string' ? raw.text.slice(0, FINGERPRINT_LENGTH) : '',
    ratio: clamp(raw.ratio, 0, 1),
  }
}

/**
 * Every save uploads the whole note again, so large notes are saved less often: on average at
 * most about 10 KB per second, and at least every two minutes.
 */
export function minSaveIntervalFor(textLength: number): number {
  return Math.min(120_000, Math.max(15_000, textLength / 10))
}

export interface ReadingPositionTrackerOptions {
  /** Stores a position. `immediate` asks to send it right away, e.g. because the page is hidden. */
  save: (position: ReadingPosition, immediate: boolean) => void
  /** Waits this long after scrolling stops before saving. */
  settleMs?: number
  /** Leaves at least this much time between saves. */
  minIntervalMs?: number
  now?: () => number
}

/**
 * Decides when a reading position is worth saving: once scrolling has settled, only after the
 * reader moved at least half a screen, and not more often than `minIntervalMs`.
 */
export class ReadingPositionTracker {
  private baseline = 0
  private pending?: { position: ReadingPosition; scrollTop: number }
  private timer?: ReturnType<typeof setTimeout>
  private lastSave = Number.NEGATIVE_INFINITY
  private readonly settleMs: number
  private readonly minIntervalMs: number
  private readonly now: () => number

  constructor(private readonly options: ReadingPositionTrackerOptions) {
    this.settleMs = options.settleMs ?? 2000
    this.minIntervalMs = options.minIntervalMs ?? 15_000
    this.now = options.now ?? Date.now
  }

  /** Starts over at this scroll position, which counts as already saved. */
  reset(scrollTop: number): void {
    this.cancel()
    this.baseline = scrollTop
  }

  /** Reports the position after a scroll. */
  update(position: ReadingPosition, scrollTop: number, viewportHeight: number): void {
    clearTimeout(this.timer)
    this.timer = undefined
    if (Math.abs(scrollTop - this.baseline) < viewportHeight * MIN_MOVE_SCREENS) {
      // Back near the saved position: nothing to save.
      this.pending = undefined
      return
    }
    this.pending = { position, scrollTop }
    const delay = Math.max(this.settleMs, this.lastSave + this.minIntervalMs - this.now())
    this.timer = setTimeout(() => this.save(false), delay)
  }

  /** Saves a pending position right away. */
  flush(): void {
    this.save(true)
  }

  /** Drops a pending position without saving it. */
  cancel(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    this.pending = undefined
  }

  private save(immediate: boolean): void {
    const pending = this.pending
    this.cancel()
    if (!pending) {
      return
    }
    this.baseline = pending.scrollTop
    this.lastSave = this.now()
    this.options.save(pending.position, immediate)
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

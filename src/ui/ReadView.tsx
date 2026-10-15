import { useLayoutEffect, useMemo, useRef } from 'preact/hooks'
import { renderMarkdown } from '../note/markdown'
import { ReadingPositionTracker, type ReadingPosition } from '../note/readingPosition'
import { captureReadingPosition, scrollToReadingPosition } from './readingAnchor'

/** Longest a restored position is held in place while fonts and images finish loading. */
const HOLD_MS = 10_000
/** Any of these means the reader has taken over scrolling. */
const READER_INPUT_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
const EMPTY_HTML = '<p>This note is empty.</p>'

interface Props {
  text: string
  /** Where to open, as a fraction of the note, when no reading position is restored. */
  initialRatio: number
  /** Where the reader stopped last time. Only read when the view opens. */
  restorePosition?: ReadingPosition
  /** Called once the view has scrolled to where it opens. */
  onOpen?: () => void
  /** Receives reading positions worth saving. Without it, positions are not tracked. */
  onSavePosition?: (position: ReadingPosition, immediate: boolean) => void
  /** Least time between two saves. */
  saveIntervalMs?: number
}

export function ReadView({ text, initialRatio, restorePosition, onOpen, onSavePosition, saveIntervalMs }: Props) {
  const empty = !text.trim()
  const html = useMemo(() => (empty ? EMPTY_HTML : renderMarkdown(text)), [text, empty])
  const articleRef = useRef<HTMLElement>(null)
  // The latest callback, without restarting the effect below.
  const saveRef = useRef(onSavePosition)
  saveRef.current = onSavePosition

  useLayoutEffect(() => {
    const article = articleRef.current
    const scroller = article?.parentElement
    if (!article || !scroller) {
      return
    }
    const doc = article.ownerDocument
    const win = doc.defaultView ?? window
    const tracker = new ReadingPositionTracker({
      save: (position, immediate) => saveRef.current?.(position, immediate),
      minIntervalMs: saveIntervalMs,
    })

    /** Where the view was placed: the position the reader starts from. */
    let placedAt = 0
    const place = () => {
      if (restorePosition) {
        scrollToReadingPosition(scroller, article, restorePosition)
      } else {
        scroller.scrollTop = initialRatio * (scroller.scrollHeight - scroller.clientHeight)
      }
      placedAt = scroller.scrollTop
    }
    place()
    tracker.reset(placedAt)
    onOpen?.()

    let holding = restorePosition !== undefined
    let frame = 0
    const report = () => {
      frame = 0
      if (holding || !saveRef.current) {
        return
      }
      const position = captureReadingPosition(scroller, article)
      if (position) {
        tracker.update(position, scroller.scrollTop, scroller.clientHeight)
      }
    }
    const onScroll = () => {
      frame ||= win.requestAnimationFrame(report)
    }

    // Text moves while fonts and images load: keep the restored position at the top until the
    // reader scrolls, clicks or types.
    const hold = () => {
      if (holding) place()
    }
    const release = () => {
      if (holding) {
        holding = false
        clearTimeout(holdTimer)
        // Browsers may scroll before running passive listeners, so the reader can already have
        // moved: measure from where the view was placed, and check where they are now.
        tracker.reset(placedAt)
        onScroll()
      }
    }
    const holdTimer = holding ? setTimeout(release, HOLD_MS) : undefined
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(hold) : undefined
    resizeObserver?.observe(article)
    doc.fonts?.addEventListener('loadingdone', hold)
    article.addEventListener('load', hold, true)
    // The page is being hidden or loses focus: save now, it may not get another chance.
    const saveNow = () => {
      if (frame) {
        win.cancelAnimationFrame(frame)
        report()
      }
      tracker.flush()
    }
    const onVisibilityChange = () => {
      if (doc.visibilityState === 'hidden') saveNow()
    }

    scroller.addEventListener('scroll', onScroll, { passive: true })
    for (const type of READER_INPUT_EVENTS) win.addEventListener(type, release, { capture: true, passive: true })
    win.addEventListener('blur', saveNow)
    win.addEventListener('pagehide', saveNow)
    doc.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      // Switching to Edit view: the layout is already changing, so save the last position measured.
      win.cancelAnimationFrame(frame)
      tracker.flush()
      clearTimeout(holdTimer)
      resizeObserver?.disconnect()
      doc.fonts?.removeEventListener('loadingdone', hold)
      article.removeEventListener('load', hold, true)
      scroller.removeEventListener('scroll', onScroll)
      for (const type of READER_INPUT_EVENTS) win.removeEventListener(type, release, { capture: true })
      win.removeEventListener('blur', saveNow)
      win.removeEventListener('pagehide', saveNow)
      doc.removeEventListener('visibilitychange', onVisibilityChange)
    }
    // Runs once: the view is remounted for another note.
  }, [])

  return (
    <article
      ref={articleRef}
      class={empty ? 'reader reader-empty' : 'reader'}
      dir="auto"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

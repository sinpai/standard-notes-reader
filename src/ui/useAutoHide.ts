import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

/** Scrolling this soon after the reader's last input counts as theirs; later scrolls are the editor's own. */
const USER_SCROLL_WINDOW_MS = 1500
/** Distance to scroll in one direction before the toolbar hides or comes back. */
const SCROLL_THRESHOLD = 24
/** Mouse travel that brings the toolbar back, so that a slight nudge does not. */
const MOUSE_THRESHOLD = 6
/** A touch that moves less than this, and ends within TAP_MS, is a tap rather than a swipe. */
const TAP_SLOP = 10
const TAP_MS = 500
/** Near the start and the end of the note the toolbar is always shown. */
const EDGE = 8
/** The views' scroll containers. */
const SCROLLERS = '.editor, .content-read'
const USER_INPUT_EVENTS = ['wheel', 'touchstart', 'touchmove', 'keydown', 'pointerdown'] as const

/**
 * Hides the floating toolbar while the reader reads on (scrolls down) or types, and brings it
 * back when they scroll up, move the mouse, click or tap, or reach either end of the note.
 */
export function useAutoHide(): { hidden: boolean; reveal: () => void } {
  const [hidden, setHidden] = useState(false)
  const hiddenRef = useRef(false)

  const update = useCallback((next: boolean) => {
    if (hiddenRef.current !== next) {
      hiddenRef.current = next
      setHidden(next)
    }
  }, [])
  const reveal = useCallback(() => update(false), [update])

  useEffect(() => {
    let lastInput = Number.NEGATIVE_INFINITY
    /** Distance scrolled in the current direction: positive down, negative up. */
    let travel = 0
    /** Mouse travel since the toolbar hid, and where the pointer was last seen. */
    let mouse = 0
    let pointer: { x: number; y: number } | undefined
    let touch: { x: number; y: number; time: number } | undefined
    const lastTop = new WeakMap<Element, number>()

    const hide = () => {
      mouse = 0
      update(true)
    }

    const onUserInput = () => {
      lastInput = performance.now()
      // Where scrolling starts from. Without it, a jump made in a single scroll event (Safari,
      // Page Down) would be measured from itself.
      for (const element of document.querySelectorAll(SCROLLERS)) {
        if (!lastTop.has(element)) lastTop.set(element, element.scrollTop)
      }
    }
    const onTyping = (event: Event) => {
      if (event.target instanceof Element && event.target.matches('.editor')) hide()
    }
    const onScroll = (event: Event) => {
      const element = event.target
      if (!(element instanceof HTMLElement) || !element.matches(SCROLLERS)) {
        return
      }
      const top = element.scrollTop
      const delta = top - (lastTop.get(element) ?? top)
      lastTop.set(element, top)
      // Restoring the reading position, switching views and the like are not reading.
      if (performance.now() - lastInput > USER_SCROLL_WINDOW_MS || delta === 0) {
        return
      }
      if (top <= EDGE || top >= element.scrollHeight - element.clientHeight - EDGE) {
        travel = 0
        reveal()
        return
      }
      travel = Math.sign(delta) === Math.sign(travel) ? travel + delta : delta
      if (travel > SCROLL_THRESHOLD) {
        hide()
      } else if (travel < -SCROLL_THRESHOLD) {
        reveal()
      }
    }
    // Viewport coordinates: they stay put when the note scrolls under a still pointer, and browsers
    // send mouse moves then too.
    const trackPointer = (event: MouseEvent) => {
      if (pointer) {
        mouse += Math.abs(event.clientX - pointer.x) + Math.abs(event.clientY - pointer.y)
      }
      pointer = { x: event.clientX, y: event.clientY }
    }
    const onMouseMove = (event: MouseEvent) => {
      trackPointer(event)
      if (mouse > MOUSE_THRESHOLD) reveal()
    }
    const onWheel = (event: WheelEvent) => trackPointer(event)
    // Taps are told apart from swipes by hand: iOS sends no click for taps on plain text, and
    // revealing at the start of every swipe would make the toolbar flicker.
    const onTouchStart = (event: TouchEvent) => {
      const first = event.touches[0]
      touch = event.touches.length === 1 && first ? { x: first.clientX, y: first.clientY, time: performance.now() } : undefined
    }
    const onTouchEnd = (event: TouchEvent) => {
      const last = event.changedTouches[0]
      if (
        touch &&
        last &&
        Math.hypot(last.clientX - touch.x, last.clientY - touch.y) < TAP_SLOP &&
        performance.now() - touch.time < TAP_MS
      ) {
        reveal()
      }
      touch = undefined
    }
    const onClick = () => reveal()

    const options = { capture: true, passive: true }
    for (const type of USER_INPUT_EVENTS) window.addEventListener(type, onUserInput, options)
    document.addEventListener('input', onTyping, true)
    document.addEventListener('scroll', onScroll, options)
    window.addEventListener('mousemove', onMouseMove, options)
    window.addEventListener('wheel', onWheel, options)
    window.addEventListener('touchstart', onTouchStart, options)
    window.addEventListener('touchend', onTouchEnd, options)
    window.addEventListener('click', onClick, true)
    return () => {
      for (const type of USER_INPUT_EVENTS) window.removeEventListener(type, onUserInput, true)
      document.removeEventListener('input', onTyping, true)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('mousemove', onMouseMove, true)
      window.removeEventListener('wheel', onWheel, true)
      window.removeEventListener('touchstart', onTouchStart, true)
      window.removeEventListener('touchend', onTouchEnd, true)
      window.removeEventListener('click', onClick, true)
    }
  }, [update, reveal])

  return { hidden, reveal }
}

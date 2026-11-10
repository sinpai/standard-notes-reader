import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { AppController } from '../app/AppController'
import { focusModeAvailable, focusModeShortcutLabel } from '../app/focusMode'
import { THEME_MONO_STACK, fontStack, fontWeight } from '../fonts/stack'
import { minSaveIntervalFor } from '../note/readingPosition'
import { CONTENT_WIDTHS, type View } from '../settings'
import { EditView } from './EditView'
import { ReadView } from './ReadView'
import { SettingsPanel } from './SettingsPanel'
import { Toolbar } from './Toolbar'
import { useAppState } from './useAppState'
import { useAutoHide } from './useAutoHide'

export function App({ controller }: { controller: AppController }) {
  const state = useAppState(controller)
  const { settings, note, view } = state
  const [panelOpen, setPanelOpen] = useState(false)
  const fontsButtonRef = useRef<HTMLButtonElement>(null)
  /** Set when the panel closes, to give focus back to the "Aa" button. */
  const restoreFocus = useRef(false)
  const mainRef = useRef<HTMLElement>(null)
  /** Relative scroll position, carried over when switching between Edit and Read. */
  const scrollRatio = useRef<{ uuid?: string; value: number }>({ value: 0 })
  /** The note whose Read view has opened, so its saved reading position was already used. */
  const openedUuid = useRef<string | undefined>(undefined)

  const scroller = (): HTMLElement | null => mainRef.current?.querySelector('textarea') ?? mainRef.current
  const ratioFor = (uuid: string | undefined) => (scrollRatio.current.uuid === uuid ? scrollRatio.current.value : 0)

  const switchView = (next: View) => {
    const element = scroller()
    if (element) {
      const max = element.scrollHeight - element.clientHeight
      scrollRatio.current = { uuid: controller.getState().note?.uuid, value: max > 0 ? element.scrollTop / max : 0 }
    }
    controller.setView(next)
  }

  useLayoutEffect(() => {
    // The Read view positions itself.
    const element = view === 'edit' ? scroller() : null
    if (element) {
      element.scrollTop = ratioFor(note?.uuid) * (element.scrollHeight - element.clientHeight)
    }
  }, [view])

  const closePanel = () => {
    restoreFocus.current = true
    setPanelOpen(false)
  }

  useEffect(() => {
    // Only once the panel is gone: on small screens the toolbar is hidden while it is open.
    if (!panelOpen && restoreFocus.current) {
      restoreFocus.current = false
      fontsButtonRef.current?.focus()
    }
  }, [panelOpen])

  const autoHide = useAutoHide()
  // Switching views, e.g. with the keyboard shortcut, shows where you are.
  useEffect(() => autoHide.reveal(), [view])
  // Problems stay in sight, and so does the toolbar while the panel it opens is shown.
  const toolbarPinned = panelOpen || state.saveStatus === 'error' || state.fontErrors.length > 0
  // Only once Standard Notes has said which platform this is: phones get no button.
  const focusMode =
    state.platform !== undefined && focusModeAvailable(state.platform, window.screen)
      ? { shortcut: focusModeShortcutLabel(state.platform), onToggle: () => controller.toggleFocusMode() }
      : undefined

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'e') {
        event.preventDefault()
        switchView(controller.getState().view === 'edit' ? 'read' : 'edit')
      } else if (event.key === 'Escape' && panelOpen) {
        closePanel()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [controller, panelOpen])

  const textRef = note?.textFont ?? settings.textFont
  const textFont = fontStack(textRef)
  const codeFont = fontStack(settings.codeFont, THEME_MONO_STACK)
  const textWeight = fontWeight(textRef)
  const codeWeight = fontWeight(settings.codeFont)
  const style = {
    '--reader-text-font': textFont,
    '--reader-code-font': codeFont,
    '--reader-edit-font': settings.monospaceEditing ? codeFont : textFont,
    '--reader-text-weight': String(textWeight),
    '--reader-code-weight': String(codeWeight),
    '--reader-edit-weight': String(settings.monospaceEditing ? codeWeight : textWeight),
    '--reader-font-size': `${settings.fontSize}px`,
    '--reader-line-height': String(settings.lineHeight),
    '--reader-width': CONTENT_WIDTHS[settings.width],
  }
  const classes = ['app', state.ready && 'is-ready', textWeight >= 600 && 'is-bold-text', panelOpen && 'is-panel-open']
    .filter(Boolean)
    .join(' ')

  // The first time a note's Read view opens, go back to where the reader stopped, unless they
  // already scrolled somewhere else in Edit view.
  const remember = settings.rememberReadingPosition
  const readRatio = ratioFor(note?.uuid)
  const restorePosition =
    remember && note && openedUuid.current !== note.uuid && readRatio === 0 ? note.readingPosition : undefined

  return (
    <div class={classes} style={style}>
      {/* First in the document so it comes first when tabbing: Tab inside the editor inserts a tab. */}
      <Toolbar
        view={view}
        onViewChange={switchView}
        panelOpen={panelOpen}
        onTogglePanel={() => (panelOpen ? closePanel() : setPanelOpen(true))}
        saveStatus={state.saveStatus}
        locked={note?.locked ?? false}
        fontErrors={state.fontErrors}
        hidden={autoHide.hidden && !toolbarPinned}
        fontsButtonRef={fontsButtonRef}
        focusMode={focusMode}
      />
      <main ref={mainRef} class={`content content-${view}`}>
        {note &&
          (view === 'edit' ? (
            <EditView controller={controller} revision={note.revision} locked={note.locked} spellcheck={note.spellcheck} />
          ) : (
            <ReadView
              key={note.uuid}
              text={controller.noteText}
              initialRatio={readRatio}
              restorePosition={restorePosition}
              onOpen={() => (openedUuid.current = note.uuid)}
              onSavePosition={
                remember ? (position, immediate) => controller.saveReadingPosition(note.uuid, position, immediate) : undefined
              }
              saveIntervalMs={minSaveIntervalFor(controller.noteText.length)}
            />
          ))}
      </main>
      {panelOpen && <SettingsPanel controller={controller} state={state} onClose={closePanel} />}
    </div>
  )
}

import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { AppController } from '../app/AppController'
import { THEME_MONO_STACK, fontStack } from '../fonts/stack'
import { CONTENT_WIDTHS, type View } from '../settings'
import { EditView } from './EditView'
import { ReadView } from './ReadView'
import { SettingsPanel } from './SettingsPanel'
import { Toolbar } from './Toolbar'
import { useAppState } from './useAppState'

export function App({ controller }: { controller: AppController }) {
  const state = useAppState(controller)
  const { settings, note, view } = state
  const [panelOpen, setPanelOpen] = useState(false)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  /** Relative scroll position, carried over when switching between Edit and Read. */
  const scrollRatio = useRef(0)

  const scroller = (): HTMLElement | null => mainRef.current?.querySelector('textarea') ?? mainRef.current

  const switchView = (next: View) => {
    const element = scroller()
    if (element) {
      const max = element.scrollHeight - element.clientHeight
      scrollRatio.current = max > 0 ? element.scrollTop / max : 0
    }
    controller.setView(next)
  }

  useLayoutEffect(() => {
    const element = scroller()
    if (element) {
      element.scrollTop = scrollRatio.current * (element.scrollHeight - element.clientHeight)
    }
  }, [view])

  const closePanel = () => {
    setPanelOpen(false)
    toolbarRef.current?.querySelector<HTMLButtonElement>('.toolbar-fonts')?.focus()
  }

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

  const textFont = fontStack(note?.textFont ?? settings.textFont)
  const codeFont = fontStack(settings.codeFont, THEME_MONO_STACK)
  const style = {
    '--reader-text-font': textFont,
    '--reader-code-font': codeFont,
    '--reader-edit-font': settings.monospaceEditing ? codeFont : textFont,
    '--reader-font-size': `${settings.fontSize}px`,
    '--reader-line-height': String(settings.lineHeight),
    '--reader-width': CONTENT_WIDTHS[settings.width],
  }

  return (
    <div class={`app${state.ready ? ' is-ready' : ''}`} style={style}>
      <div ref={toolbarRef} class="toolbar-host">
        <Toolbar
          view={view}
          onViewChange={switchView}
          panelOpen={panelOpen}
          onTogglePanel={() => (panelOpen ? closePanel() : setPanelOpen(true))}
          saveStatus={state.saveStatus}
          locked={note?.locked ?? false}
          fontErrors={state.fontErrors}
        />
      </div>
      <main ref={mainRef} class={`content content-${view}`}>
        {note &&
          (view === 'edit' ? (
            <EditView controller={controller} revision={note.revision} locked={note.locked} spellcheck={note.spellcheck} />
          ) : (
            <ReadView text={controller.noteText} />
          ))}
      </main>
      {panelOpen && <SettingsPanel controller={controller} state={state} onClose={closePanel} />}
    </div>
  )
}

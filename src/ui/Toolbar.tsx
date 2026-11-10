import type { Ref } from 'preact'
import type { SaveStatus } from '../bridge/types'
import type { View } from '../settings'
import { Segmented } from './Segmented'

const IS_APPLE = /Mac|iPhone|iPad/.test(navigator.platform) || /Mac OS X/.test(navigator.userAgent)
export const TOGGLE_VIEW_SHORTCUT = IS_APPLE ? '⌘E' : 'Ctrl+E'

interface Props {
  view: View
  onViewChange: (view: View) => void
  panelOpen: boolean
  onTogglePanel: () => void
  saveStatus: SaveStatus
  locked: boolean
  fontErrors: string[]
  /** Hidden while the reader reads or types. Comes back when it gets keyboard focus. */
  hidden: boolean
  /** The "Aa" button, so focus can return to it when the panel closes. */
  fontsButtonRef: Ref<HTMLButtonElement>
  /** Turns Standard Notes' focus mode on or off; left out where it has no effect. */
  focusMode?: { shortcut: string; onToggle: () => void }
}

const VIEW_OPTIONS: Array<{ value: View; label: string }> = [
  { value: 'edit', label: 'Edit' },
  { value: 'read', label: 'Read' },
]

/** Controls that float over the bottom of the note, so the text can use the whole height. */
export function Toolbar({
  view,
  onViewChange,
  panelOpen,
  onTogglePanel,
  saveStatus,
  locked,
  fontErrors,
  hidden,
  fontsButtonRef,
  focusMode,
}: Props) {
  let status: { text: string; tone: 'error' | 'warning' | 'neutral' } | undefined
  if (saveStatus === 'error') {
    status = { text: 'Changes not saved yet — Standard Notes is not responding', tone: 'error' }
  } else if (fontErrors[0]) {
    status = { text: fontErrors[0], tone: 'warning' }
  } else if (locked) {
    status = { text: 'Editing disabled', tone: 'neutral' }
  }

  return (
    <div class={hidden ? 'toolbar is-hidden' : 'toolbar'}>
      <div class="toolbar-status" role="status" aria-live="polite">
        {status && <span class={`status status-${status.tone}`}>{status.text}</span>}
      </div>
      <div class="toolbar-bar">
        <div title={`Switch between editing and reading (${TOGGLE_VIEW_SHORTCUT})`}>
          <Segmented label="View" options={VIEW_OPTIONS} value={view} onChange={onViewChange} />
        </div>
        {focusMode && (
          <button
            type="button"
            class="icon-button toolbar-focus"
            aria-label="Focus mode"
            title={`Focus mode: hide Standard Notes' sidebars (${focusMode.shortcut})`}
            onClick={focusMode.onToggle}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" />
            </svg>
          </button>
        )}
        <button
          ref={fontsButtonRef}
          type="button"
          class="icon-button toolbar-fonts"
          aria-label="Fonts and layout"
          aria-expanded={panelOpen}
          title="Fonts and layout"
          onClick={onTogglePanel}
        >
          Aa
        </button>
      </div>
    </div>
  )
}

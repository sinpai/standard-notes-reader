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
}

const VIEW_OPTIONS: Array<{ value: View; label: string }> = [
  { value: 'edit', label: 'Edit' },
  { value: 'read', label: 'Read' },
]

export function Toolbar({ view, onViewChange, panelOpen, onTogglePanel, saveStatus, locked, fontErrors }: Props) {
  let status: { text: string; tone: 'error' | 'warning' | 'neutral' } | undefined
  if (saveStatus === 'error') {
    status = { text: 'Changes not saved yet — Standard Notes is not responding', tone: 'error' }
  } else if (fontErrors[0]) {
    status = { text: fontErrors[0], tone: 'warning' }
  } else if (locked) {
    status = { text: 'Editing disabled', tone: 'neutral' }
  }

  return (
    <header class="toolbar">
      <div title={`Switch between editing and reading (${TOGGLE_VIEW_SHORTCUT})`}>
        <Segmented label="View" options={VIEW_OPTIONS} value={view} onChange={onViewChange} />
      </div>
      <div class="toolbar-status" role="status" aria-live="polite">
        {status && <span class={`status status-${status.tone}`}>{status.text}</span>}
      </div>
      <button
        type="button"
        class="icon-button toolbar-fonts"
        aria-label="Fonts and layout"
        aria-expanded={panelOpen}
        title="Fonts and layout"
        onClick={onTogglePanel}
      >
        Aa
      </button>
    </header>
  )
}

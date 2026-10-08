import { useEffect, useMemo, useRef } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import type { AppController, AppState } from '../app/AppController'
import { groupFamilies } from '../fonts/library'
import { FONT_SIZE_RANGE, LINE_HEIGHT_RANGE, type ContentWidth, type View } from '../settings'
import { FontPicker } from './FontPicker'
import { ImportedFonts } from './ImportedFonts'
import { InstalledFonts } from './InstalledFonts'
import { Segmented } from './Segmented'

interface Props {
  controller: AppController
  state: AppState
  onClose: () => void
}

const WIDTH_OPTIONS: Array<{ value: ContentWidth; label: string }> = [
  { value: 'narrow', label: 'Narrow' },
  { value: 'medium', label: 'Medium' },
  { value: 'wide', label: 'Wide' },
  { value: 'full', label: 'Full' },
]

const VIEW_OPTIONS: Array<{ value: View; label: string }> = [
  { value: 'edit', label: 'Edit' },
  { value: 'read', label: 'Read' },
]

export function SettingsPanel({ controller, state, onClose }: Props) {
  const { settings, note, library, environment } = state
  const families = useMemo(() => groupFamilies(library), [library])
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  useEffect(() => {
    // Previews in the pickers and the library need every imported font.
    void controller.loadAllImportedFonts()
  }, [controller, library])

  const pickerProps = { families, installedFonts: settings.installedFonts }

  return (
    <aside class="panel" aria-labelledby="panel-title">
      <header class="panel-header">
        <h2 id="panel-title">Fonts &amp; layout</h2>
        <button ref={closeRef} type="button" class="icon-button" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </header>

      <div class="panel-body">
        <section class="panel-section" aria-labelledby="note-settings-title">
          <h3 id="note-settings-title">This note</h3>
          <Field label="Font" htmlFor="note-font">
            <FontPicker
              id="note-font"
              value={note?.textFont}
              inheritLabel="Same as all notes"
              disabled={!note || note.locked}
              onChange={(ref) => controller.setNoteFont(ref)}
              {...pickerProps}
            />
          </Field>
        </section>

        <section class="panel-section" aria-labelledby="default-settings-title">
          <h3 id="default-settings-title">All notes</h3>
          <Field label="Text font" htmlFor="text-font">
            <FontPicker
              id="text-font"
              value={settings.textFont}
              onChange={(ref) => ref && controller.updateSettings({ textFont: ref })}
              {...pickerProps}
            />
          </Field>
          <Field label="Code font" htmlFor="code-font">
            <FontPicker
              id="code-font"
              value={settings.codeFont}
              onChange={(ref) => ref && controller.updateSettings({ codeFont: ref })}
              {...pickerProps}
            />
          </Field>
          <label class="checkbox">
            <input
              type="checkbox"
              checked={settings.monospaceEditing}
              onChange={(event) => controller.updateSettings({ monospaceEditing: event.currentTarget.checked })}
            />
            Use the code font while editing
          </label>
          <Field label={`Size · ${settings.fontSize}px`} htmlFor="font-size">
            <input
              id="font-size"
              type="range"
              min={FONT_SIZE_RANGE.min}
              max={FONT_SIZE_RANGE.max}
              step={1}
              value={settings.fontSize}
              onInput={(event) => controller.updateSettings({ fontSize: event.currentTarget.valueAsNumber })}
            />
          </Field>
          <Field label={`Line spacing · ${settings.lineHeight.toFixed(2)}`} htmlFor="line-height">
            <input
              id="line-height"
              type="range"
              min={LINE_HEIGHT_RANGE.min}
              max={LINE_HEIGHT_RANGE.max}
              step={0.05}
              value={settings.lineHeight}
              onInput={(event) => controller.updateSettings({ lineHeight: event.currentTarget.valueAsNumber })}
            />
          </Field>
          <Field label="Width">
            <Segmented
              label="Width"
              options={WIDTH_OPTIONS}
              value={settings.width}
              onChange={(width) => controller.updateSettings({ width })}
            />
          </Field>
          <Field label="Open notes in">
            <Segmented
              label="Open notes in"
              options={VIEW_OPTIONS}
              value={settings.defaultView}
              onChange={(defaultView) => controller.updateSettings({ defaultView })}
            />
          </Field>
        </section>

        <ImportedFonts controller={controller} library={library} isMobile={environment === 'mobile'} />
        <InstalledFonts controller={controller} installedFonts={settings.installedFonts} />
      </div>
    </aside>
  )
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ComponentChildren }) {
  return (
    <div class="field">
      {htmlFor ? <label for={htmlFor}>{label}</label> : <span class="field-label">{label}</span>}
      {children}
    </div>
  )
}

import { useMemo, useState } from 'preact/hooks'
import type { AppController } from '../app/AppController'
import { detectSuggestedFonts, isFontInstalled } from '../fonts/installed'
import { cssString } from '../fonts/stack'

interface Props {
  controller: AppController
  installedFonts: string[]
}

export function InstalledFonts({ controller, installedFonts }: Props) {
  const [name, setName] = useState('')
  const detected = useMemo(() => detectSuggestedFonts(), [])
  const added = new Set(installedFonts.map((font) => font.toLowerCase()))
  const suggestions = detected.filter((font) => !added.has(font.toLowerCase()))
  const trimmed = name.trim()
  const alreadyAdded = added.has(trimmed.toLowerCase())

  const add = (font: string) => {
    controller.addInstalledFont(font)
    setName('')
  }

  return (
    <section class="panel-section" aria-labelledby="installed-fonts-title">
      <h3 id="installed-fonts-title">Installed fonts</h3>
      <p class="hint">
        Fonts installed on your device, used by name. Devices without the font fall back to the default. Safari
        and iOS only allow fonts that come with the system — import the font file instead.
      </p>

      <div class="row">
        <input
          type="text"
          list="detected-fonts"
          aria-label="Installed font name"
          placeholder="Font name, e.g. Iosevka"
          autocomplete="off"
          spellcheck={false}
          value={name}
          onInput={(event) => setName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && trimmed && !alreadyAdded) add(trimmed)
          }}
        />
        <button type="button" class="button-primary" disabled={!trimmed || alreadyAdded} onClick={() => add(trimmed)}>
          Add
        </button>
      </div>
      <datalist id="detected-fonts">
        {suggestions.map((font) => (
          <option key={font} value={font} />
        ))}
      </datalist>
      {trimmed && !alreadyAdded && (
        <p class={isFontInstalled(trimmed) ? 'message-success' : 'message-warning'} role="status">
          {isFontInstalled(trimmed)
            ? `“${trimmed}” is installed on this device.`
            : `“${trimmed}” was not found on this device. You can still add it for devices that have it.`}
        </p>
      )}

      {installedFonts.length > 0 && (
        <ul class="installed-list">
          {installedFonts.map((font) => {
            const available = isFontInstalled(font)
            return (
              <li key={font}>
                <span class="installed-name" style={{ fontFamily: `${cssString(font)}, var(--reader-ui-font)` }}>
                  {font}
                </span>
                <span class={available ? 'badge badge-ok' : 'badge badge-missing'}>
                  {available ? 'Available' : 'Not on this device'}
                </span>
                <button type="button" aria-label={`Remove ${font}`} onClick={() => controller.removeInstalledFont(font)}>
                  Remove
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {suggestions.length > 0 && (
        <div class="suggestions">
          <p class="hint">Found on this device:</p>
          <div class="chips">
            {suggestions.map((font) => (
              <button
                key={font}
                type="button"
                class="chip"
                style={{ fontFamily: `${cssString(font)}, var(--reader-ui-font)` }}
                onClick={() => add(font)}
              >
                {font}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

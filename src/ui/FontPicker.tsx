import { isFontInstalled } from '../fonts/installed'
import { decodeFontRef, encodeFontRef } from '../fonts/stack'
import type { FontRef, ImportedFamily } from '../fonts/types'

interface Props {
  id: string
  value: FontRef | undefined
  onChange: (value: FontRef | undefined) => void
  families: ImportedFamily[]
  installedFonts: string[]
  /** Adds an empty option with this label, which maps to `undefined`. */
  inheritLabel?: string
  disabled?: boolean
}

export function FontPicker({ id, value, onChange, families, installedFonts, inheritLabel, disabled }: Props) {
  const selected = encodeFontRef(value)
  const known = new Set([
    'theme',
    'generic:sans-serif',
    'generic:serif',
    'generic:monospace',
    ...families.map((family) => `imported:${family.familyId}`),
    ...installedFonts.map((name) => `installed:${name}`),
  ])
  const missing = selected && !known.has(selected) ? value : undefined

  return (
    <select
      id={id}
      value={selected}
      disabled={disabled}
      onChange={(event) => {
        const raw = event.currentTarget.value
        onChange(raw ? decodeFontRef(raw) : undefined)
      }}
    >
      {inheritLabel && <option value="">{inheritLabel}</option>}
      <optgroup label="Standard Notes">
        <option value="theme">App default</option>
      </optgroup>
      <optgroup label="System">
        <option value="generic:sans-serif">Sans-serif</option>
        <option value="generic:serif">Serif</option>
        <option value="generic:monospace">Monospace</option>
      </optgroup>
      {families.length > 0 && (
        <optgroup label="Imported">
          {families.map((family) => (
            <option key={family.familyId} value={`imported:${family.familyId}`}>
              {family.family}
            </option>
          ))}
        </optgroup>
      )}
      {installedFonts.length > 0 && (
        <optgroup label="Installed">
          {installedFonts.map((name) => (
            <option key={name} value={`installed:${name}`}>
              {isFontInstalled(name) ? name : `${name} (not on this device)`}
            </option>
          ))}
        </optgroup>
      )}
      {missing && <option value={selected}>{missingLabel(missing)}</option>}
    </select>
  )
}

function missingLabel(ref: FontRef): string {
  return ref.type === 'installed' ? `${ref.family} (removed)` : 'A deleted imported font'
}

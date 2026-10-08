import { useMemo, useState } from 'preact/hooks'
import type { AppController, ImportResult } from '../app/AppController'
import {
  FONT_FILE_EXTENSIONS,
  MAX_LIBRARY_BYTES,
  describeFace,
  formatBytes,
  groupFamilies,
  libraryBytes,
} from '../fonts/library'
import { fontStack } from '../fonts/stack'
import type { FontRef, ImportedFamily, StoredFontFace } from '../fonts/types'

const SAMPLE_TEXT = 'The quick brown fox jumps over the lazy dog'

interface Props {
  controller: AppController
  library: StoredFontFace[]
  /** The text font for all notes. */
  textFont: FontRef
  /** Mobile file pickers grey out font files when filtered by extension, so they get no filter. */
  isMobile: boolean
}

export function ImportedFonts({ controller, library, textFont, isMobile }: Props) {
  const families = useMemo(() => groupFamilies(library), [library])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult>()
  const [dragging, setDragging] = useState(false)
  const used = libraryBytes(library)

  const importFiles = async (files: File[]) => {
    if (files.length === 0 || busy) {
      return
    }
    setBusy(true)
    setResult(undefined)
    try {
      setResult(await controller.importFontFiles(files))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      class={`panel-section${dragging ? ' is-dragging' : ''}`}
      aria-labelledby="imported-fonts-title"
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        void importFiles(Array.from(event.dataTransfer?.files ?? []))
      }}
    >
      <h3 id="imported-fonts-title">Imported fonts</h3>
      <p class="hint">
        Font files from this device (TTF, OTF, WOFF, WOFF2). They are stored end-to-end encrypted with your
        Standard Notes preferences, so they work on all your devices — including phones.
      </p>

      <label class={`button${busy ? ' is-disabled' : ''}`}>
        {busy ? 'Importing…' : 'Import font files…'}
        <input
          type="file"
          class="visually-hidden"
          multiple
          disabled={busy}
          accept={isMobile ? undefined : FONT_FILE_EXTENSIONS.join(',')}
          onChange={(event) => {
            const input = event.currentTarget
            const files = Array.from(input.files ?? [])
            input.value = ''
            void importFiles(files)
          }}
        />
      </label>

      {result && (
        <div class="import-result" role="status">
          {result.imported.length > 0 && (
            <p class="message-success">
              Imported {Array.from(new Set(result.imported)).join(', ')}.
              {result.defaultFamily && ` ${result.defaultFamily} is now used for all notes.`}
            </p>
          )}
          {result.repaired.length > 0 && (
            <p class="message-warning">
              Repaired {result.repaired.join(', ')}: removed leftover hinting data that some browsers reject. The font
              looks the same.
            </p>
          )}
          {result.errors.map((error) => (
            <p key={error} class="message-error">
              {error}
            </p>
          ))}
        </div>
      )}

      {families.length > 0 && (
        <ul class="family-list">
          {families.map((family) => (
            <FamilyRow
              key={family.familyId}
              controller={controller}
              family={family}
              usedForAllNotes={textFont.type === 'imported' && textFont.familyId === family.familyId}
            />
          ))}
        </ul>
      )}

      <div class="usage">
        <meter min={0} max={MAX_LIBRARY_BYTES} value={used} aria-label="Space used by imported fonts" />
        <span>
          {formatBytes(used)} of {formatBytes(MAX_LIBRARY_BYTES)} used
        </span>
      </div>
    </section>
  )
}

interface FamilyRowProps {
  controller: AppController
  family: ImportedFamily
  usedForAllNotes: boolean
}

function FamilyRow({ controller, family, usedForAllNotes }: FamilyRowProps) {
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(family.family)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const size = family.faces.reduce((total, face) => total + face.size, 0)

  const saveName = () => {
    controller.renameFamily(family.familyId, name)
    setRenaming(false)
  }

  return (
    <li class="family">
      <div class="family-sample" style={{ fontFamily: fontStack({ type: 'imported', familyId: family.familyId }) }}>
        <span class="family-name">{family.family}</span>
        <span class="family-pangram">{SAMPLE_TEXT}</span>
      </div>
      <p class="family-meta">
        {family.faces.map(describeFace).join(' · ')} · {formatBytes(size)}
      </p>

      {renaming ? (
        <div class="row">
          <input
            type="text"
            aria-label="Family name"
            value={name}
            onInput={(event) => setName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') saveName()
              if (event.key === 'Escape') setRenaming(false)
            }}
          />
          <button type="button" class="button-primary" onClick={saveName} disabled={!name.trim()}>
            Save
          </button>
          <button type="button" onClick={() => setRenaming(false)}>
            Cancel
          </button>
        </div>
      ) : confirmingDelete ? (
        <div class="row">
          <span class="confirm-text">Delete {family.family} from all devices?</span>
          <button type="button" class="button-danger" onClick={() => controller.removeFamily(family.familyId)}>
            Delete
          </button>
          <button type="button" onClick={() => setConfirmingDelete(false)}>
            Keep
          </button>
        </div>
      ) : (
        <div class="row">
          {usedForAllNotes ? (
            <span class="badge badge-ok">Used for all notes</span>
          ) : (
            <button type="button" class="button-primary" onClick={() => controller.useForAllNotes(family.familyId)}>
              Use for all notes
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setName(family.family)
              setRenaming(true)
            }}
          >
            Rename
          </button>
          <button type="button" onClick={() => setConfirmingDelete(true)}>
            Delete
          </button>
        </div>
      )}
    </li>
  )
}

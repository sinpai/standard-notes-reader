import { beforeEach, describe, expect, it } from 'vitest'
import type { ContextItem } from '../src/bridge/types'
import { NoteSession, type SaveScheduler } from '../src/note/NoteSession'

class FakeScheduler implements SaveScheduler {
  build?: () => ContextItem | undefined
  flushes = 0

  scheduleSave(build: () => ContextItem | undefined): void {
    this.build = build
  }

  flush(): void {
    this.flushes++
  }

  /** Runs the pending save the way the bridge would. */
  runSave(): ContextItem | undefined {
    const build = this.build
    this.build = undefined
    return build?.()
  }
}

function note(text: string, extra: Partial<ContextItem> = {}, locked = false): ContextItem {
  return {
    uuid: 'note-1',
    content_type: 'Note',
    content: {
      title: 'Title',
      text,
      references: [{ uuid: 'tag-1' }],
      appData: { 'org.standardnotes.sn': { locked, pinned: true } },
    },
    ...extra,
  }
}

describe('NoteSession', () => {
  let scheduler: FakeScheduler
  let session: NoteSession

  beforeEach(() => {
    scheduler = new FakeScheduler()
    session = new NoteSession(scheduler)
  })

  it('loads a note and saves edits with a preview, keeping everything else intact', () => {
    expect(session.receive(note('Hello'))).toBe('loaded')
    session.editText('# Hello **world**')

    const saved = scheduler.runSave()
    expect(saved?.content).toMatchObject({
      title: 'Title',
      text: '# Hello **world**',
      preview_plain: 'Hello world',
      preview_html: null,
      references: [{ uuid: 'tag-1' }],
      appData: { 'org.standardnotes.sn': { locked: false, pinned: true } },
    })
  })

  it('does not save when nothing changed', () => {
    session.receive(note('Same'))
    session.editText('Same')
    expect(scheduler.build).toBeUndefined()
  })

  it('applies changes made elsewhere when there are no unsaved edits', () => {
    session.receive(note('Old'))
    expect(session.receive(note('New from another device'))).toBe('text-changed')
    expect(session.text).toBe('New from another device')
  })

  it('keeps unsaved edits when an older version of the note arrives', () => {
    session.receive(note('Old'))
    session.editText('Old and newer')
    expect(session.receive(note('Old', { content: { ...note('Old').content, title: 'Renamed' } }))).toBe(
      'metadata-changed',
    )
    expect(session.text).toBe('Old and newer')
    // The pending save carries the new title along with the local text.
    expect(scheduler.runSave()?.content).toMatchObject({ title: 'Renamed', text: 'Old and newer' })
  })

  it('ignores sync round-trips of its own saves', () => {
    session.receive(note('A'))
    session.editText('AB')
    scheduler.runSave()
    session.editText('ABC')
    expect(session.receive(note('AB', { isMetadataUpdate: true }))).toBe('metadata-changed')
    expect(session.text).toBe('ABC')
  })

  it('never saves a locked note', () => {
    session.receive(note('Locked', {}, true))
    expect(session.locked).toBe(true)
    session.editText('Changed')
    expect(scheduler.runSave()).toBeUndefined()
  })

  it('treats a different note as a fresh load', () => {
    session.receive(note('First'))
    session.editText('First, edited')
    expect(session.receive({ ...note('Second'), uuid: 'note-2' })).toBe('loaded')
    expect(session.text).toBe('Second')
  })

  it('stores a per-note font in the plugin data of the note and saves it right away', () => {
    session.receive(note('Text', { clientData: { other: 1 } }))
    session.setTextFont({ type: 'installed', family: 'Iosevka' })

    expect(scheduler.flushes).toBe(1)
    expect(session.textFont).toEqual({ type: 'installed', family: 'Iosevka' })
    expect(scheduler.runSave()?.clientData).toEqual({ other: 1, textFont: { type: 'installed', family: 'Iosevka' } })

    session.setTextFont(undefined)
    expect(session.textFont).toBeUndefined()
  })

  it('reads spellcheck from the note', () => {
    session.receive(note('x', { content: { ...note('x').content, spellcheck: false } }))
    expect(session.spellcheck).toBe(false)
  })
})

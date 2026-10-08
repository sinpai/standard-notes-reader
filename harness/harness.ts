/**
 * A stand-in for the Standard Notes app, for developing the editor without an account.
 * It follows the host side of the component protocol as implemented by the app's ComponentViewer.
 */
import { addFaceToLibrary, formatBytes, importFontFile, libraryBytes, parseStoredFaces } from '../src/fonts/library'

type Environment = 'web' | 'desktop' | 'mobile'

interface HarnessNote {
  uuid: string
  content_type: 'Note'
  created_at: string
  updated_at: string
  content: {
    title: string
    text: string
    appData: Record<string, Record<string, unknown>>
    [key: string]: unknown
  }
}

interface HarnessState {
  notes: HarnessNote[]
  componentData: Record<string, unknown>
  selectedUuid: string
  theme: string
  environment: Environment
}

interface Message {
  action: string
  data?: Record<string, unknown> & { items?: Array<Record<string, unknown>> }
  messageId?: string
  sessionKey?: string
}

const COMPONENT_UUID = 'harness-component'
const COMPONENTS_DOMAIN = 'org.standardnotes.sn.components'
const APP_DOMAIN = 'org.standardnotes.sn'
const STORAGE_KEY = 'standard-notes-reader-harness'

const THEMES: Record<string, string[]> = {
  'Default (light)': [],
  'Sepia (local example)': [new URL('/harness/themes/sepia.css', location.href).href],
  'Midnight (app.standardnotes.com)': [
    'https://app.standardnotes.com/components/assets/org.standardnotes.theme-midnight/index.css',
  ],
}

const WELCOME_TEXT = `# Reading in your own fonts

This note is rendered by **Custom Font Reader**, a Standard Notes editor that uses fonts from your device.

- Choose any font *installed* on your computer by name.
- Or import font files — they sync, encrypted, to your phone too.
- Switch between **Edit** and **Read** with ⌘E / Ctrl+E.

> Typography is what language looks like. — Ellen Lupton

\`\`\`js
const font = await importFontFile(file, library)
\`\`\`

| Style | Example |
| --- | --- |
| Bold | **The quick brown fox** |
| Italic | *jumps over the lazy dog* |

- [x] Import a font
- [ ] Pick it for this note
`

const SAMPLE_NOTES: HarnessNote[] = [
  sampleNote('note-welcome', 'Welcome', WELCOME_TEXT),
  sampleNote('note-plain', 'Plain text', 'Shopping list\napples\noat milk\ncoffee beans\n\nCall the bike shop before Friday.'),
  sampleNote('note-locked', 'Locked note', 'Editing is disabled for this note.', true),
]

const editorUrl = new URLSearchParams(location.search).get('editor') ?? '/index.html'
const iframe = document.getElementById('editor') as HTMLIFrameElement
const logList = document.getElementById('log') as HTMLOListElement

let state = loadState()
let sessionKey: string | undefined
let streamMessage: Message | undefined
let pendingLoad = false

function sampleNote(uuid: string, title: string, text: string, locked = false): HarnessNote {
  const now = new Date().toISOString()
  return {
    uuid,
    content_type: 'Note',
    created_at: now,
    updated_at: now,
    content: { title, text, references: [], appData: { [APP_DOMAIN]: { locked } } },
  }
}

function loadState(): HarnessState {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as HarnessState | null
    if (saved?.notes?.length) {
      return saved
    }
  } catch {
    // Start fresh.
  }
  return {
    notes: structuredClone(SAMPLE_NOTES),
    componentData: {},
    selectedUuid: SAMPLE_NOTES[0]!.uuid,
    theme: 'Default (light)',
    environment: 'web',
  }
}

function persist(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  renderSidebar()
}

function currentNote(): HarnessNote {
  return state.notes.find((note) => note.uuid === state.selectedUuid) ?? state.notes[0]!
}

function log(text: string): void {
  const item = document.createElement('li')
  item.textContent = `${new Date().toLocaleTimeString()} ${text}`
  logList.prepend(item)
  while (logList.children.length > 200) {
    logList.lastElementChild?.remove()
  }
}

function send(message: Record<string, unknown>): void {
  log(`→ ${String(message.action)}`)
  iframe.contentWindow?.postMessage(state.environment === 'mobile' ? JSON.stringify(message) : message, '*')
}

function reply(original: Message, data: Record<string, unknown>): void {
  send({ action: 'reply', original, data })
}

function itemForEditor(note: HarnessNote, isMetadataUpdate: boolean): Record<string, unknown> {
  const content = structuredClone(note.content)
  return {
    uuid: note.uuid,
    content_type: note.content_type,
    created_at: note.created_at,
    updated_at: note.updated_at,
    isMetadataUpdate,
    content: { ...content, spellcheck: content.spellcheck ?? true },
    clientData: content.appData[COMPONENTS_DOMAIN]?.[COMPONENT_UUID] ?? {},
  }
}

function sendContextItem(isMetadataUpdate: boolean): void {
  if (streamMessage) {
    reply(streamMessage, { item: itemForEditor(currentNote(), isMetadataUpdate) })
  }
}

function themeUrls(): string[] {
  return THEMES[state.theme] ?? []
}

function loadEditor(): void {
  sessionKey = undefined
  streamMessage = undefined
  pendingLoad = true
  const separator = editorUrl.includes('?') ? '&' : '?'
  iframe.src = `${editorUrl}${separator}load=${Date.now()}`
}

iframe.addEventListener('load', () => {
  if (!pendingLoad) {
    return
  }
  pendingLoad = false
  sessionKey = crypto.randomUUID()
  send({
    action: 'component-registered',
    sessionKey,
    componentData: structuredClone(state.componentData),
    data: {
      uuid: COMPONENT_UUID,
      environment: state.environment,
      platform: state.environment === 'mobile' ? 'ios' : 'macos',
      activeThemeUrls: themeUrls(),
    },
  })
  send({ action: 'themes', data: { themes: themeUrls() } })
})

window.addEventListener('message', (event) => {
  if (event.source !== iframe.contentWindow) {
    return
  }
  const message = (typeof event.data === 'string' ? JSON.parse(event.data) : event.data) as Message
  if (!message || message.sessionKey !== sessionKey) {
    return
  }

  switch (message.action) {
    case 'stream-context-item':
      log('← stream-context-item')
      streamMessage = message
      sendContextItem(false)
      break
    case 'save-items':
      handleSave(message)
      break
    case 'set-component-data': {
      state.componentData = (message.data?.componentData as Record<string, unknown>) ?? {}
      log(`← set-component-data (${formatBytes(JSON.stringify(state.componentData).length)})`)
      persist()
      break
    }
    case 'key-down':
    case 'key-up': {
      const data = message.data ?? {}
      const modifiers = ['metaKey', 'ctrlKey', 'altKey', 'shiftKey'].filter((key) => data[key]).map((key) => key.replace('Key', ''))
      log(`← ${message.action} ${[...modifiers, String(data.key)].join('+')}`)
      break
    }
    default:
      log(`← ${message.action}`)
  }
})

function handleSave(message: Message): void {
  const items = message.data?.items ?? []
  for (const item of items) {
    const note = state.notes.find((candidate) => candidate.uuid === item.uuid)
    if (!note) {
      continue
    }
    if (note.content.appData[APP_DOMAIN]?.locked) {
      // The app shows an alert and never replies.
      log('← save-items REJECTED: note is locked')
      return
    }
    note.content = structuredClone(item.content) as HarnessNote['content']
    if (item.clientData) {
      note.content.appData[COMPONENTS_DOMAIN] = {
        ...note.content.appData[COMPONENTS_DOMAIN],
        [COMPONENT_UUID]: item.clientData,
      }
    }
    note.updated_at = new Date().toISOString()
    log(`← save-items "${note.content.title}" (${note.content.text.length} chars)`)
  }
  persist()
  reply(message, {})
  // The sync round-trip comes back as a metadata update.
  setTimeout(() => sendContextItem(true), 300)
}

async function seedFonts(files: File[]): Promise<void> {
  let library = parseStoredFaces(state.componentData.fonts)
  for (const file of files) {
    try {
      library = addFaceToLibrary(library, await importFontFile(file, library))
      log(`seeded font ${file.name}`)
    } catch (error) {
      log(`could not seed ${file.name}: ${String(error)}`)
    }
  }
  state.componentData = { ...state.componentData, fonts: library }
  persist()
  loadEditor()
}

function renderSidebar(): void {
  const list = document.getElementById('notes') as HTMLUListElement
  list.replaceChildren(
    ...state.notes.map((note) => {
      const item = document.createElement('li')
      const button = document.createElement('button')
      button.type = 'button'
      const locked = note.content.appData[APP_DOMAIN]?.locked ? ' 🔒' : ''
      button.textContent = `${note.content.title}${locked}`
      button.setAttribute('aria-current', String(note.uuid === state.selectedUuid))
      button.addEventListener('click', () => {
        state.selectedUuid = note.uuid
        persist()
        loadEditor()
      })
      item.append(button)
      return item
    }),
  )

  const fonts = parseStoredFaces(state.componentData.fonts)
  const summary = document.getElementById('data-summary') as HTMLParagraphElement
  summary.textContent = `Settings ${state.componentData.settings ? 'saved' : 'not set'} · ${fonts.length} imported font file(s), ${formatBytes(libraryBytes(fonts))}`
}

function setupControls(): void {
  const theme = document.getElementById('theme') as HTMLSelectElement
  theme.replaceChildren(...Object.keys(THEMES).map((name) => new Option(name, name, false, name === state.theme)))
  theme.addEventListener('change', () => {
    state.theme = theme.value
    persist()
    send({ action: 'themes', data: { themes: themeUrls() } })
  })

  const environment = document.getElementById('environment') as HTMLSelectElement
  environment.value = state.environment
  environment.addEventListener('change', () => {
    state.environment = environment.value as Environment
    persist()
    loadEditor()
  })

  document.getElementById('remote-edit')!.addEventListener('click', () => {
    const note = currentNote()
    note.content.text += `\n\nEdited on another device at ${new Date().toLocaleTimeString()}.`
    note.updated_at = new Date().toISOString()
    persist()
    sendContextItem(false)
  })

  document.getElementById('toggle-lock')!.addEventListener('click', () => {
    const note = currentNote()
    const appData = note.content.appData[APP_DOMAIN] ?? {}
    note.content.appData[APP_DOMAIN] = { ...appData, locked: !appData.locked }
    persist()
    sendContextItem(false)
  })

  document.getElementById('reload')!.addEventListener('click', loadEditor)

  document.getElementById('reset')!.addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEY)
    state = loadState()
    theme.value = state.theme
    environment.value = state.environment
    persist()
    loadEditor()
  })

  const seed = document.getElementById('seed-font') as HTMLInputElement
  seed.onchange = () => {
    void seedFonts(Array.from(seed.files ?? []))
    seed.value = ''
  }
}

// Hooks for scripted checks, e.g. from a browser automation session.
Object.assign(window, {
  harness: {
    getState: () => state,
    reload: loadEditor,
    async seedFontFromUrl(url: string) {
      const response = await fetch(url)
      const name = decodeURIComponent(url.split('/').pop() ?? 'font.ttf')
      await seedFonts([new File([await response.arrayBuffer()], name)])
    },
    selectNote(uuid: string) {
      state.selectedUuid = uuid
      persist()
      loadEditor()
    },
  },
})

setupControls()
renderSidebar()
loadEditor()

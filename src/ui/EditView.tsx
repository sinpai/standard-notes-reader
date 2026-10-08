import { useLayoutEffect, useRef } from 'preact/hooks'
import type { AppController } from '../app/AppController'

interface Props {
  controller: AppController
  /** Changes when the text must be re-applied from the note. */
  revision: number
  locked: boolean
  spellcheck: boolean
}

export function EditView({ controller, revision, locked, spellcheck }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    const text = controller.noteText
    if (!textarea || textarea.value === text) {
      return
    }
    const { selectionStart, selectionEnd } = textarea
    textarea.value = text
    if (document.activeElement === textarea) {
      textarea.setSelectionRange(Math.min(selectionStart, text.length), Math.min(selectionEnd, text.length))
    }
  }, [controller, revision])

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Tab' || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey || locked) {
      return
    }
    event.preventDefault()
    // execCommand keeps the browser's undo history intact.
    if (!document.execCommand('insertText', false, '\t')) {
      const textarea = event.currentTarget as HTMLTextAreaElement
      textarea.setRangeText('\t', textarea.selectionStart, textarea.selectionEnd, 'end')
      controller.editText(textarea.value)
    }
  }

  return (
    <textarea
      ref={textareaRef}
      class="editor"
      dir="auto"
      aria-label="Note text"
      placeholder="Start writing…"
      spellcheck={spellcheck}
      readOnly={locked}
      onInput={(event) => controller.editText(event.currentTarget.value)}
      onKeyDown={onKeyDown}
    />
  )
}

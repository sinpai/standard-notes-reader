import { useMemo } from 'preact/hooks'
import { renderMarkdown } from '../note/markdown'

export function ReadView({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text])

  if (!text.trim()) {
    return <p class="reader-empty">This note is empty.</p>
  }
  return <article class="reader" dir="auto" dangerouslySetInnerHTML={{ __html: html }} />
}

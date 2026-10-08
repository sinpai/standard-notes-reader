import DOMPurify from 'dompurify'
import { Marked } from 'marked'

// `breaks` keeps single line breaks, so plain-text notes read the way they were written.
const markdown = new Marked({ gfm: true, breaks: true })

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && /^(https?:|mailto:)/i.test(node.getAttribute('href') ?? '')) {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

/** Renders a note's Markdown to sanitized HTML. */
export function renderMarkdown(text: string): string {
  const html = markdown.parse(text, { async: false })
  // Inline styles in a note would override the chosen font, so they are dropped.
  return DOMPurify.sanitize(html, { FORBID_ATTR: ['style'], FORBID_TAGS: ['style'] })
}

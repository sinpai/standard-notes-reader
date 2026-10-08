// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../src/note/markdown'

describe('renderMarkdown', () => {
  it('renders GitHub-flavored Markdown with line breaks kept', () => {
    const html = renderMarkdown('**bold**\nnext line\n\n- [x] done')
    expect(html).toContain('<strong>bold</strong><br>next line')
    expect(html).toContain('type="checkbox"')
  })

  it('removes scripts, event handlers, inline styles and script links', () => {
    const html = renderMarkdown(
      '<script>alert(1)</script><img src="x" onerror="alert(2)"><p style="font-family: Comic Sans">x</p>\n\n[js](javascript:alert(3))',
    )
    expect(html).toContain('<p>x</p>')
    expect(html).toContain('>js</a>')
    expect(html).not.toMatch(/script|onerror|style=|javascript:/)
  })

  it('opens web links outside the editor but keeps in-page links', () => {
    const html = renderMarkdown('[site](https://example.com) [section](#notes)')
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">site</a>')
    expect(html).toContain('<a href="#notes">section</a>')
  })
})

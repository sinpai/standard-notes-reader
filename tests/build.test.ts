import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'

describe('production build', () => {
  it('produces a single-file editor whose CSP allows exactly its own script, plus a manifest and zip', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'standard-notes-reader-'))
    process.env.SN_PLUGIN_URL = 'https://example.github.io/standard-notes-reader'
    try {
      await build({
        configFile: resolve(__dirname, '../vite.config.ts'),
        logLevel: 'silent',
        build: { outDir, emptyOutDir: true },
      })

      const html = readFileSync(join(outDir, 'index.html'), 'utf8')
      const scripts = Array.from(html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g))
      expect(scripts).toHaveLength(1)
      expect(html).not.toMatch(/<script[^>]+src=/)
      expect(html).not.toMatch(/<link[^>]+stylesheet/)

      const hash = createHash('sha256').update(scripts[0]![1]!, 'utf8').digest('base64')
      expect(html).toContain(`script-src 'sha256-${hash}'`)
      expect(html).toContain("connect-src 'none'")

      const manifest = JSON.parse(readFileSync(join(outDir, 'ext.json'), 'utf8'))
      expect(manifest).toMatchObject({
        content_type: 'SN|Component',
        area: 'editor-editor',
        note_type: 'markdown',
        file_type: 'md',
        url: 'https://example.github.io/standard-notes-reader/index.html',
        download_url: 'https://example.github.io/standard-notes-reader/standard-notes-reader.zip',
        latest_url: 'https://example.github.io/standard-notes-reader/ext.json',
      })

      const fontFiles = [
        'fonts/old-standard-tt/OFL.txt',
        'fonts/old-standard-tt/OldStandard-Bold.ttf',
        'fonts/old-standard-tt/OldStandard-Italic.ttf',
        'fonts/old-standard-tt/OldStandard-Regular.ttf',
      ]
      const zip = unzipSync(readFileSync(join(outDir, 'standard-notes-reader.zip')))
      expect(Object.keys(zip).sort()).toEqual([...fontFiles, 'index.html', 'package.json'])
      expect(strFromU8(zip['index.html']!)).toBe(html)
      // The desktop app reads the installed version from here to decide whether to update.
      expect(JSON.parse(strFromU8(zip['package.json']!))).toMatchObject({
        version: manifest.version,
        sn: { main: 'index.html' },
      })
      for (const file of fontFiles) {
        const original = readFileSync(resolve(__dirname, '../public', file))
        expect(Buffer.from(zip[file]!).equals(original)).toBe(true)
        expect(readFileSync(join(outDir, file)).equals(original)).toBe(true)
      }
    } finally {
      delete process.env.SN_PLUGIN_URL
      rmSync(outDir, { recursive: true, force: true })
    }
  }, 60_000)
})

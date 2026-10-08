import { createHash } from 'node:crypto'
import { strToU8, zipSync } from 'fflate'
import type { Plugin } from 'vite'

export interface StandardNotesPluginOptions {
  /** Absolute URL of the folder that will host the contents of `dist/`. */
  baseUrl: string
  identifier: string
  name: string
  description: string
  version: string
  zipName: string
}

/**
 * Turns the Vite build into a Standard Notes plugin:
 *
 * 1. Inlines the JS/CSS bundle into a single self-contained `index.html`. Standard Notes runs
 *    third-party editors in a sandboxed iframe without `allow-same-origin`, so the page has an
 *    opaque origin and every sub-resource would be a cross-origin (CORS) request. A single file
 *    behaves the same on every host (GitHub Pages, the desktop app's local server, mobile).
 * 2. Adds a strict Content-Security-Policy: only our own inline script may run and the editor
 *    cannot make network requests.
 * 3. Emits `ext.json` (the plugin manifest) and a zip that the desktop app downloads for offline use.
 */
export function standardNotesPlugin(options: StandardNotesPluginOptions): Plugin {
  return {
    name: 'standard-notes-plugin',
    apply: 'build',
    enforce: 'post',
    generateBundle(_outputOptions, bundle) {
      const htmlAsset = bundle['index.html']
      if (!htmlAsset || htmlAsset.type !== 'asset') {
        this.error('index.html was not emitted')
      }

      let html = String(htmlAsset.source)
      const scriptHashes: string[] = []

      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type === 'asset' && fileName.endsWith('.css')) {
          const link = new RegExp(`<link[^>]*href="[^"]*${escapeRegExp(fileName)}"[^>]*>`)
          html = replaceOnce(html, link, `<style>${String(output.source)}</style>`, fileName)
          delete bundle[fileName]
        }
      }

      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type === 'chunk') {
          if (!output.isEntry) {
            this.error(`Unexpected extra chunk ${fileName}; the editor must build to a single chunk`)
          }
          const code = output.code.replace(/<\/script/gi, '<\\/script')
          const script = new RegExp(`<script[^>]*src="[^"]*${escapeRegExp(fileName)}"[^>]*></script>`)
          html = replaceOnce(html, script, `<script type="module">${code}</script>`, fileName)
          scriptHashes.push(`'sha256-${createHash('sha256').update(code, 'utf8').digest('base64')}'`)
          delete bundle[fileName]
        }
      }

      const csp = [
        "default-src 'none'",
        `script-src ${scriptHashes.join(' ')}`,
        // Standard Notes themes are injected as stylesheets: https/http URLs, or data: URLs on mobile.
        "style-src 'unsafe-inline' * data:",
        'font-src * data:',
        'img-src * data: blob:',
        "connect-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ].join('; ')
      html = replaceOnce(
        html,
        /<meta charset="UTF-8" \/>/,
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
        'charset meta',
      )
      htmlAsset.source = html

      const manifest = {
        identifier: options.identifier,
        name: options.name,
        description: options.description,
        content_type: 'SN|Component',
        area: 'editor-editor',
        version: options.version,
        url: new URL('index.html', options.baseUrl).href,
        download_url: new URL(options.zipName, options.baseUrl).href,
        latest_url: new URL('ext.json', options.baseUrl).href,
        note_type: 'markdown',
        file_type: 'md',
        interchangeable: true,
        spellcheckControl: true,
      }

      this.emitFile({ type: 'asset', fileName: 'ext.json', source: `${JSON.stringify(manifest, null, 2)}\n` })
      this.emitFile({
        type: 'asset',
        fileName: options.zipName,
        source: zipSync({ 'index.html': [strToU8(html), { level: 9 }] }),
      })
    },
  }
}

/** Normalizes the hosting URL and fails early with a helpful message if it is unusable. */
export function resolveBaseUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`SN_PLUGIN_URL must be an absolute URL (got "${value}")`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`SN_PLUGIN_URL must use http or https (got "${value}")`)
  }
  return url.href.endsWith('/') ? url.href : `${url.href}/`
}

function replaceOnce(source: string, pattern: RegExp, replacement: string, label: string): string {
  if (!pattern.test(source)) {
    throw new Error(`standard-notes-plugin: could not find ${label} in index.html`)
  }
  return source.replace(pattern, () => replacement)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

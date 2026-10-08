import { readFileSync } from 'node:fs'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import { resolveBaseUrl, standardNotesPlugin } from './build/standardNotesPlugin.ts'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  name: string
  version: string
}

export default defineConfig(({ mode }) => {
  // Configure via environment variables or a `.env.production` file, e.g.
  //   SN_PLUGIN_URL=https://<you>.github.io/standard-notes-reader/
  const env = { ...loadEnv(mode, process.cwd(), 'SN_'), ...process.env }

  return {
    base: './',
    oxc: {
      jsx: { runtime: 'automatic', importSource: 'preact' },
    },
    build: {
      target: 'es2020',
      modulePreload: false,
      cssCodeSplit: false,
      rolldownOptions: {
        output: { codeSplitting: false },
      },
    },
    server: {
      // The editor runs in a sandboxed iframe with an opaque ("null") origin, so the dev server's
      // module scripts are cross-origin requests.
      cors: { origin: '*' },
    },
    preview: {
      // Standard Notes fetches ext.json from the app's origin when installing the plugin.
      cors: { origin: '*' },
    },
    plugins: [
      standardNotesPlugin({
        baseUrl: resolveBaseUrl(env.SN_PLUGIN_URL ?? 'http://localhost:4173/'),
        identifier: env.SN_PLUGIN_IDENTIFIER ?? 'io.github.standard-notes-reader',
        name: env.SN_PLUGIN_NAME ?? 'Custom Font Reader',
        description: 'Read and write notes in fonts from your device: installed fonts or imported font files.',
        version: pkg.version,
        zipName: `${pkg.name}.zip`,
      }),
    ],
    test: {
      include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    },
  }
})

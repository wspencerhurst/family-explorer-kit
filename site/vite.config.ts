import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// family.config.json lives at the repo root (one level above site/).
const cfg = JSON.parse(readFileSync(new URL('../family.config.json', import.meta.url), 'utf-8'))
const FAMILY = {
  familyName: cfg.familyName || 'Our',
  siteTitle: cfg.siteTitle || 'Family Explorer',
  searchHint: cfg.searchHint || 'Smith 1800',
  overviewLede: cfg.overviewLede || '',
  originsNote: cfg.originsNote || '',
}

export default defineConfig({
  plugins: [react(), { name: 'family-title', transformIndexHtml: (html: string) => html.replace('%FAMILY_TITLE%', FAMILY.siteTitle) }],
  define: { __FAMILY__: JSON.stringify(FAMILY) },
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  server: { port: 5173 },
})

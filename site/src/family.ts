// Site settings from family.config.json (repo root), injected at build time by vite.config.ts.
declare const __FAMILY__: { familyName: string; siteTitle: string; searchHint: string; overviewLede: string; originsNote: string }
export const FAMILY = __FAMILY__

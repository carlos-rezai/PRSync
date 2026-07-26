/// <reference types="vite/client" />

// Vite's own `ImportMetaEnv` is an index signature of `any`, so reading a
// variable off `import.meta.env` produces an untyped value. Declaring the
// panel's variables here merges with it and gives them real types — the
// build fails on a typo rather than the panel booting against
// `undefined`. Keep this in step with the `packages/extension` block of
// CLAUDE.md's Environment Variables section.

interface ImportMetaEnv {
  /** Base URL of the deployed Function App the panel calls. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

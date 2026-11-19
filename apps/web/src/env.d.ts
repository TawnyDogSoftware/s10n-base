/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The API's origin; the page's own origin when unset. See src/config.ts. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

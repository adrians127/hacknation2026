/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend base URL without the /v1 prefix, e.g. http://localhost:3001. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

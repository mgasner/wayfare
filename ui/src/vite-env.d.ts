/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" serves every entrypoint from ui/src/data/fixtures in the browser. */
  readonly VITE_FIXTURES?: string;
}

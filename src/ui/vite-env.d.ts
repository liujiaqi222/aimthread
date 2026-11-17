/**
 * Minimal typing for the two `import.meta.env` members the UI uses. Vite
 * replaces them statically; the dev HTTP client branch is dead code in
 * production builds (`DEV` becomes `false`), keeping the transport out of
 * the bundle (see src/ui/client/create.ts).
 */

interface ImportMetaEnv {
  readonly DEV: boolean
  readonly VITE_SERVICE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

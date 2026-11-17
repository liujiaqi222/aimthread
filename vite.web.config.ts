/**
 * Browser dev mode (#64 D4): the same renderer served by plain Vite — no
 * Electron — talking to the dev service over loopback HTTP. Reuses the
 * renderer section of electron.vite.config.ts verbatim, so the browser and
 * Electron dev modes render the exact same app.
 */

import { defineConfig, type UserConfig } from 'vite'
import electronConfig from './electron.vite.config'

const renderer = electronConfig.renderer
if (!renderer) {
  throw new Error('vite.web.config.ts: no renderer section in electron.vite.config.ts')
}

export default defineConfig(renderer as UserConfig)

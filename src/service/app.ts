/**
 * The app module: protocol-level queries/commands that exist independent of
 * any domain feature. `app.info` is the sample query for #67; `debug.emitChange`
 * is the push-demonstration test hook.
 */

import { APP_NAME } from '@shared/app'
import type { ServiceModule } from './index'

export const appModule: ServiceModule = {
  queries: {
    'app.info': async (_input, ctx) => ({
      name: APP_NAME,
      version: ctx.info.version,
      schemaVersion: ctx.info.schemaVersion,
      nodeVersion: process.versions.node,
      platform: process.platform,
      pid: process.pid,
      startedAt: ctx.info.startedAt
    })
  },
  commands: {
    'debug.emitChange': async (input, ctx) => {
      ctx.hub.emitChanged(input.topics)
      return { topics: input.topics }
    }
  }
}

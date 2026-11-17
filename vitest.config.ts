import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

const r = (p: string): string => resolve(__dirname, p)

export default defineConfig({
  resolve: {
    alias: {
      '@shared': r('src/shared'),
      '@service': r('src/service'),
      '@main': r('src/main'),
      '@ui': r('src/ui')
    }
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node'
  }
})

import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

const r = (p: string): string => resolve(__dirname, p)

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: r('src/main/index.ts'),
          // 服务作为 main 的另一个入口，经 ?modulePath 交给 utilityProcess.fork（#64 D1）
          service: r('src/service/entry-utility.ts')
        }
      }
    },
    resolve: {
      alias: {
        '@shared': r('src/shared'),
        '@main': r('src/main'),
        '@service': r('src/service')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': r('src/shared')
      }
    }
  },
  renderer: {
    root: 'src/ui',
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          index: r('src/ui/index.html'),
          repair: r('src/ui/repair.html')
        }
      }
    },
    resolve: {
      alias: {
        '@shared': r('src/shared'),
        '@ui': r('src/ui')
      }
    }
  }
})

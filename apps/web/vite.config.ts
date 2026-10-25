import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { findAvailablePort } from '../../scripts/dev-tools.js'

async function developmentPort() {
  // Vite reloads its config on edits. Reuse our chosen port during that process
  // instead of treating the existing listener as another app and changing URLs.
  const assigned = process.env.ONYKA_VITE_ASSIGNED_PORT
  if (assigned) return Number(assigned)
  const port = await findAvailablePort(process.env.DEV_WEB_PORT ?? 5173)
  process.env.ONYKA_VITE_ASSIGNED_PORT = String(port)
  return port
}

export default defineConfig(async ({ command, mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: command === 'serve' && mode !== 'test'
      ? await developmentPort()
      : 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.DEV_API_TARGET || 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/socket.io': {
        target: process.env.DEV_API_TARGET || 'http://127.0.0.1:3001',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    sourcemap: process.env.NODE_ENV !== 'production',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-dom') || id.includes('react-router-dom')) {
              return 'vendor'
            }
            if (id.includes('@tiptap/') || id.includes('prosemirror')) {
              return 'tiptap'
            }
            if (id.includes('framer-motion') || id.includes('motion-dom') || id.includes('motion-utils')) {
              return 'framer-motion'
            }
            if (id.includes('@dnd-kit/')) {
              return 'dnd-kit'
            }
            if (id.includes('socket.io')) {
              return 'socket-io'
            }
          }
        },
      },
    },
  },
}))

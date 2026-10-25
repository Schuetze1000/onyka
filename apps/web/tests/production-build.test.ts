import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'vite'
import { describe, expect, it, vi } from 'vitest'
import { vendorChunk } from '../bundling/chunks'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

describe('Production vendor bundles', () => {
  it.each([
    ['/srv/node_modules/react/index.js', 'vendor'],
    ['/srv/node_modules/react/jsx-runtime.js', 'vendor'],
    ['/srv/node_modules/react-dom/client.js', 'vendor'],
    ['/srv/node_modules/scheduler/index.js', 'vendor'],
    ['/srv/node_modules/react-router/dist/index.js', 'vendor'],
    ['/srv/node_modules/react-router-dom/dist/index.js', 'vendor'],
    ['/srv/node_modules/.pnpm/@dnd-kit+core@6_react-dom@19/node_modules/@dnd-kit/core/dist/core.esm.js', 'dnd-kit'],
    ['C:\\app\\node_modules\\.pnpm\\@tiptap+react@3_react-dom@19\\node_modules\\@tiptap\\react\\dist\\index.js', 'tiptap'],
    ['/srv/node_modules/.pnpm/framer-motion@12_react-dom@19/node_modules/framer-motion/dist/es/index.mjs', 'framer-motion'],
    ['/srv/node_modules/socket.io-client/build/esm/index.js', 'socket-io'],
    ['/srv/node_modules/.pnpm/socket.io-client@4/node_modules/debug/src/browser.js', undefined],
    ['/srv/react-dom-app/src/main.tsx', undefined],
  ])('assigns the real package in %s to %s', (id, expected) => {
    expect(vendorChunk(id)).toBe(expected)
  })

  it('keeps React initialized before drag-and-drop, animation, and editor bundles execute', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'onyka-production-build-'))
    vi.stubEnv('NODE_ENV', 'production')
    try {
      const result = await build({
        root: webRoot,
        logLevel: 'silent',
        build: { write: false, sourcemap: false },
      })
      if (Array.isArray(result) || !('output' in result)) throw new Error('Expected a single production build')
      const chunks = result.output.filter(item => item.type === 'chunk')
      const vendor = chunks.find(chunk => chunk.name === 'vendor')!
      expect(vendor).toBeDefined()
      // A vendor-to-consumer import can run dnd-kit before React has initialized.
      expect(vendor.imports).toEqual([])
      const reactChunks = chunks.filter(chunk => Object.keys(chunk.modules).some(id =>
        /\/node_modules\/(?:react|react-dom|scheduler)\//.test(id.replaceAll('\\', '/')),
      ))
      expect(reactChunks.map(chunk => chunk.fileName)).toEqual([vendor.fileName])
      expect(Object.keys(vendor.modules).some(id => id.endsWith('/react.production.js'))).toBe(true)

      // Run emitted ESM directly in a fresh process, without Vitest/Vite rewriting
      // imports or substituting the development version of React.
      await writeFile(join(directory, 'package.json'), '{"type":"module"}')
      for (const chunk of chunks) {
        const target = join(directory, chunk.fileName)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, chunk.code)
      }
      const libraries = ['dnd-kit', 'framer-motion', 'tiptap'].map(name => {
        const chunk = chunks.find(item => item.name === name)
        expect(chunk, `Missing ${name} bundle`).toBeDefined()
        return pathToFileURL(join(directory, chunk!.fileName)).href
      })
      const { stdout, stderr } = await promisify(execFile)(process.execPath, [
        '--input-type=module', '--eval', `
          const { JSDOM } = await import(process.argv[1])
          const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://onyka.test/' })
          for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'MutationObserver']) {
            Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
          }
          try {
            for (const url of process.argv.slice(2)) await import(url)
            console.log('Production libraries loaded successfully')
          } finally { dom.window.close() }
        `,
        pathToFileURL(require.resolve('jsdom')).href, ...libraries,
      ], { cwd: webRoot, timeout: 30_000, windowsHide: true })
      expect(stdout.trim()).toBe('Production libraries loaded successfully')
      expect(stderr).toBe('')
    } finally {
      vi.unstubAllEnvs()
      expect(dirname(directory)).toBe(resolve(tmpdir()))
      await rm(directory, { recursive: true, force: true })
    }
  }, 60_000)
})

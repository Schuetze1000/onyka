// Match the actual package, not a pnpm store directory containing peer dependency
// names (e.g. @dnd-kit+core@..._react-dom@.../node_modules/@dnd-kit/core/...).
export function vendorChunk(id: string): string | undefined {
  const path = id.replaceAll('\\', '/')
  const marker = '/node_modules/'
  const offset = path.lastIndexOf(marker)
  if (offset === -1) return

  const parts = path.slice(offset + marker.length).split('/')
  const name = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]

  // Keep React, its JSX runtime, and the renderer together. Letting another
  // manual chunk claim React implicitly can introduce initialization cycles.
  if (['react', 'react-dom', 'scheduler', 'react-router', 'react-router-dom'].includes(name)) {
    return 'vendor'
  }
  if (name.startsWith('@tiptap/') || name.startsWith('prosemirror-')) {
    return 'tiptap'
  }
  if (['framer-motion', 'motion-dom', 'motion-utils'].includes(name)) {
    return 'framer-motion'
  }
  if (name.startsWith('@dnd-kit/')) return 'dnd-kit'
  if (name === 'socket.io-client' || name === 'socket.io-parser') return 'socket-io'
}

import { createServer } from 'node:net'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { stripVTControlCharacters } from 'node:util'

/** Probe the actual bind, including Windows exclusions that are not occupied sockets. */
export async function findAvailablePort(preferredPort = 5173, host = '127.0.0.1') {
  const port = Number(preferredPort)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('DEV_WEB_PORT must be an integer between 0 and 65535')
  }

  const probe = (candidate) => new Promise((accept, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(candidate, host, () => {
      const address = server.address()
      server.close((error) => {
        if (error) reject(error)
        else accept(address.port)
      })
    })
  })

  try {
    return await probe(port)
  } catch (error) {
    if (port === 0 || !['EACCES', 'EADDRINUSE'].includes(error.code)) throw error
    // Let the OS choose outside its reserved ranges instead of walking into
    // another blocked port immediately above the preferred one.
    return probe(0)
  }
}

/** Execute a package's JavaScript CLI through Node, without a .cmd shell wrapper. */
export function resolvePackageCli(packageName, cwd) {
  const require = createRequire(resolve(cwd, 'package.json'))
  const manifestPath = require.resolve(`${packageName}/package.json`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[packageName]
  if (!entry) throw new Error(`Cannot find the ${packageName} CLI. Run pnpm install first.`)
  return resolve(dirname(manifestPath), entry)
}

export function frontendUrlFromOutput(output) {
  return stripVTControlCharacters(output).match(/Local:\s+(https?:\/\/[^\s]+)(?=\s)/)?.[1] ?? null
}

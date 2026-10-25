#!/usr/bin/env node

/**
 * Onyka Development Server
 * Auto-setup + clean startup with single URL output
 */
import { spawn, spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { parseEnv } from 'node:util'
import { resolvePackageCli, frontendUrlFromOutput } from './dev-tools.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = join(__dirname, '..')
const SERVER_DIR = join(ROOT_DIR, 'apps', 'server')
const WEB_DIR = join(ROOT_DIR, 'apps', 'web')
const ENV_FILE = join(SERVER_DIR, '.env')
const DATA_DIR = join(SERVER_DIR, 'data')

const isWindows = process.platform === 'win32'

// ANSI
const green = (t) => `\x1b[32m${t}\x1b[0m`
const blue = (t) => `\x1b[34m${t}\x1b[0m`
const dim = (t) => `\x1b[2m${t}\x1b[0m`
const clear = '\x1b[2J\x1b[H'

// Shared environment
const devEnv = {
  ...process.env,
  NODE_ENV: 'development',
}

// Run installed CLIs directly: Windows .cmd shims otherwise require shell=true.
function run(command, args, options = {}) {
  return spawn(process.execPath, [resolvePackageCli(command, options.cwd), ...args], {
    ...options,
    env: devEnv,
    shell: false,
    windowsHide: true,
  })
}

function runSync(command, args, options = {}) {
  return spawnSync(process.execPath, [resolvePackageCli(command, options.cwd), ...args], {
    ...options,
    env: devEnv,
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
  })
}

// Auto-setup
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true })
}

if (!existsSync(ENV_FILE)) {
  console.log('')
  console.log(dim('  First run - setting up...'))

  const jwtSecret = randomBytes(48).toString('base64url')

  const envContent = `# Onyka Configuration
# Generated automatically - do not commit this file

NODE_ENV=development
PORT=3001
DATABASE_URL=./data/onyka.db
JWT_SECRET=${jwtSecret}
CORS_ORIGIN=http://localhost:5173
`

  writeFileSync(ENV_FILE, envContent)
  console.log(green('  + Environment configured'))
}

// Database migrations
const serverConfig = parseEnv(readFileSync(ENV_FILE, 'utf8'))
const backendPort = Number(devEnv.PORT ?? serverConfig.PORT ?? 3001)
if (!Number.isInteger(backendPort) || backendPort < 1 || backendPort > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535')
}
devEnv.DEV_API_TARGET = `http://127.0.0.1:${backendPort}`

console.log(dim('  Running database migrations...'))

const migrate = runSync(
  'tsx',
  ['src/db/migrate.ts'],
  {
    cwd: SERVER_DIR,
    stdio: 'pipe',
  }
)

if (migrate.error || migrate.status !== 0) {
  console.error('\n  Database migration failed')

  if (migrate.error) {
    console.error(migrate.error)
  }

  if (migrate.stderr) {
    console.error(migrate.stderr.trim())
  }

  if (migrate.stdout) {
    console.log(migrate.stdout.trim())
  }

  process.exit(1)
}

console.log(green('  + Database ready'))

let serverReady = false
let webReady = false
let statusShown = false
let shuttingDown = false
let webUrl = null
let frontendOutput = ''

const children = []

function showStatus() {
  if (!serverReady || !webReady || statusShown) return

  statusShown = true

  if (process.stdout.isTTY) {
    console.log(clear)
  }

  console.log('')
  console.log(green('  Onyka is running'))
  console.log(dim('  ──────────────────'))
  console.log('')
  console.log('  Open in browser:')
  console.log(blue(`  ${webUrl}`))
  console.log('')
  console.log(dim('  Press Ctrl+C to stop'))
  console.log('')
}

// Child process management
function startProcess(name, command, args, cwd, onOutput) {
  const child = run(command, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  children.push(child)

  child.stdout.on('data', (data) => {
    const output = data.toString()
    onOutput(output)
  })

  child.stderr.on('data', (data) => {
    const output = data.toString()

    // Some tools log normal status messages to stderr
    onOutput(output)

    if (/\berror\b|failed|exception|ENOENT/i.test(output)) {
      console.error(`[${name}] ${output.trim()}`)
    }
  })

  child.on('error', (error) => {
    console.error(`\n  Failed to start ${name}:`)
    console.error(error.message)
    cleanup(1)
  })

  child.on('exit', (code, signal) => {
    if (shuttingDown) return

    console.error(
      `\n  ${name} stopped unexpectedly ` +
      `(code: ${code}, signal: ${signal})`
    )

    cleanup(code && code !== 0 ? code : 1)
  })

  return child
}

// Start the frontend first so the backend receives the actual browser origin,
// including an OS-selected fallback port, for CORS, WebSockets and email links.
startProcess(
  'Frontend',
  'vite',
  [],
  WEB_DIR,
  (output) => {
    if (webReady) return
    frontendOutput = (frontendOutput + output).slice(-8192)
    webUrl = frontendUrlFromOutput(frontendOutput)
    if (!webUrl) return
    webReady = true
    const origin = new URL(webUrl).origin
    devEnv.CORS_ORIGIN = origin
    devEnv.FRONTEND_URL = origin
    let backendOutputBuffer = ''
    startProcess('Backend', 'tsx', ['watch', 'src/index.ts'], SERVER_DIR, (backendOutput) => {
      backendOutputBuffer = (backendOutputBuffer + backendOutput).slice(-8192)
      if (/Server running|listening|running on/i.test(backendOutputBuffer)) {
        serverReady = true
        showStatus()
      }
    })
  }
)

// Graceful cleanup
function cleanup(exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true

  for (const child of children) {
    if (!child.pid || child.exitCode !== null) continue

    try {
      if (isWindows) {
        // Stop the entire process tree on Windows
        spawnSync(
          'taskkill',
          ['/PID', String(child.pid), '/T', '/F'],
          {
            stdio: 'ignore',
            windowsHide: true,
          }
        )
      } else {
        child.kill('SIGTERM')
      }
    } catch {
      // Process may already have exited
    }
  }

  process.exit(exitCode)
}

process.on('SIGINT', () => cleanup(0))
process.on('SIGTERM', () => cleanup(0))

console.log('')
console.log(dim('  Starting Onyka...'))

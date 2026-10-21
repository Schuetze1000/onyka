#!/usr/bin/env node

/**
 * Onyka Development Server
 * Auto-setup + clean startup with single URL output
 */
import { spawn, spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

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

// Start pnpm commands safely on Windows
function run(command, args, options = {}) {
  return spawn(command, args, {
    ...options,
    env: devEnv,
    shell: isWindows,
    windowsHide: true,
  })
}

function runSync(command, args, options = {}) {
  return spawnSync(command, args, {
    ...options,
    env: devEnv,
    shell: isWindows,
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
console.log(dim('  Running database migrations...'))

const migrate = runSync(
  'pnpm',
  ['exec', 'drizzle-kit', 'migrate'],
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
  console.log(blue('  http://localhost:5173'))
  console.log('')
  console.log(dim('  Press Ctrl+C to stop'))
  console.log('')
}

// Child process management
function startProcess(name, args, cwd, onOutput) {
  const child = run('pnpm', ['exec', ...args], {
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

// Start backend
startProcess(
  'Backend',
  ['tsx', 'watch', 'src/index.ts'],
  SERVER_DIR,
  (output) => {
    if (
      /Server running|listening|running on/i.test(output)
    ) {
      serverReady = true
      showStatus()
    }
  }
)

// Start frontend
startProcess(
  'Frontend',
  ['vite'],
  WEB_DIR,
  (output) => {
    if (/Local:|ready in|VITE/i.test(output)) {
      webReady = true
      showStatus()
    }
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

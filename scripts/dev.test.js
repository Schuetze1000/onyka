import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { findAvailablePort, frontendUrlFromOutput, resolvePackageCli } from './dev-tools.js'

test('selects an OS-assigned port when the preferred port is already occupied', async () => {
  const occupied = createServer()
  await new Promise((accept, reject) => {
    occupied.once('error', reject)
    occupied.listen(0, '127.0.0.1', accept)
  })
  try {
    const port = occupied.address().port
    const fallback = await findAvailablePort(port)
    assert.notEqual(fallback, port)
    assert.ok(fallback > 0 && fallback <= 65535)
    const available = createServer()
    await new Promise((accept, reject) => {
      available.once('error', reject)
      available.listen(fallback, '127.0.0.1', accept)
    })
    await new Promise((accept) => available.close(accept))
  } finally {
    await new Promise((accept) => occupied.close(accept))
  }
})

test('keeps a usable preferred port instead of always changing the URL', async () => {
  const port = await findAvailablePort(0)
  assert.equal(await findAvailablePort(port), port)
})

test('rejects invalid port settings', async () => {
  for (const port of [-1, 65536, 'not-a-port', 1.5]) {
    await assert.rejects(findAvailablePort(port), /DEV_WEB_PORT/)
  }
})

test('reads the actual Vite URL, including ANSI colors and a fallback port', () => {
  assert.equal(frontendUrlFromOutput('\u001b[32mVITE ready\u001b[0m\n  ➜  Local:   \u001b[36mhttp://127.0.0.1:60417/\u001b[0m\n'), 'http://127.0.0.1:60417/')
  assert.equal(frontendUrlFromOutput('VITE ready in 240 ms\n'), null)
  assert.equal(frontendUrlFromOutput('Local: http://127.0.0.'), null)
})

test('resolves installed JavaScript CLIs without Windows shell shims', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  assert.match(resolvePackageCli('vite', join(root, 'apps/web')), /[\\/]bin[\\/]vite\.js$/)
  assert.match(resolvePackageCli('tsx', join(root, 'apps/server')), /[\\/]dist[\\/]cli\.mjs$/)
})

test('preserves paths with spaces and shell characters as literal arguments', () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'onyka-dev-test-'))
  const project = join(temporaryRoot, 'project with spaces')
  const pkg = join(project, 'node_modules', 'fixture-cli')
  mkdirSync(pkg, { recursive: true })
  writeFileSync(join(project, 'package.json'), '{}')
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'fixture-cli', bin: 'cli.cjs' }))
  writeFileSync(join(pkg, 'cli.cjs'), 'console.log(JSON.stringify(process.argv.slice(2)))')
  try {
    const cli = resolvePackageCli('fixture-cli', project)
    const args = ['argument with spaces', 'literal & echo unexpected']
    const result = spawnSync(process.execPath, [cli, ...args], { shell: false, encoding: 'utf8', windowsHide: true })
    assert.equal(result.status, 0)
    assert.deepEqual(JSON.parse(result.stdout), args)
    assert.equal(result.stderr, '')
  } finally {
    assert.equal(dirname(temporaryRoot), resolve(tmpdir()))
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

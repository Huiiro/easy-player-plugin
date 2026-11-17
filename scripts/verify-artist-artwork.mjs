import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const require = createRequire(import.meta.url)
const catalog = JSON.parse(readFileSync(path.join(root, 'dist/catalog.json'), 'utf8'))
const name = process.argv[2] || 'Aimer'
const normalize = (value) => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
const results = await Promise.all(
  ['netease', 'kugou', 'qqmusic'].map(async (id) => {
    let timer
    try {
      const run = async () => {
        const entry = catalog.plugins.find((plugin) => plugin.id === 'builtin.' + id)
        const filename = new URL(entry.url).pathname.split('/').at(-1)
        const zip = new AdmZip(readFileSync(path.join(root, 'dist', filename)))
        const module = { exports: {} }
        new Function('module', 'exports', 'require', zip.readAsText('index.cjs'))(
          module,
          module.exports,
          require
        )
        let source
        const controller = new AbortController()
        const host = {
          signal: controller.signal,
          registerSource: (value) => {
            source = value
            return () => {}
          },
          own: (cleanup) => cleanup,
          settings: { get: () => null, set() {} },
          log() {},
          network: { fetch: (url, init) => fetch(url, init) }
        }
        const plugin = module.exports.createPlugin()
        plugin.activate(host)
        try {
          const candidates = await source.artistArtwork.search(name, {
            host,
            signal: AbortSignal.timeout(20000),
            deadline: Date.now() + 20000,
            operation: 'artistArtwork.search',
            sourceId: id
          })
          const match = candidates.find(
            (candidate) => normalize(candidate.name) === normalize(name)
          )
          assert(match, `No exact portrait match among ${candidates.length} candidates`)
          assert.equal(match.resource.resourceType, 'artist')
          const response = await fetch(match.imageUrl, { signal: AbortSignal.timeout(12000) })
          assert(response.ok, `Portrait HTTP ${response.status}`)
          assert(
            response.headers.get('content-type')?.startsWith('image/'),
            'Portrait is not an image'
          )
          const bytes = await response.arrayBuffer()
          assert(bytes.byteLength > 100, 'Portrait is empty')
          console.log(`${id}: PASS ${match.name}, ${bytes.byteLength} image bytes`)
        } finally {
          controller.abort()
          plugin.deactivate?.()
        }
      }
      await Promise.race([
        run(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Live verification timed out')), 35000)
        })
      ])
      return true
    } catch (error) {
      console.log(`${id}: FAIL ${String(error.message || error).slice(0, 200)}`)
      return false
    } finally {
      clearTimeout(timer)
    }
  })
)
process.exit(results.every(Boolean) ? 0 : 1)

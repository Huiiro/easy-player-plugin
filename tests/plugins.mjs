/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import vm from 'node:vm'
import { createHash } from 'node:crypto'
import AdmZip from 'adm-zip'
import ts from 'typescript'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const require = createRequire(import.meta.url)
const catalog = JSON.parse(readFileSync(path.join(root, 'dist/catalog.json'), 'utf8'))
const sources = new Map()
const calls = []
const host = {
  signal: new AbortController().signal,
  registerSource(source) {
    sources.set(source.id, source)
    return () => sources.delete(source.id)
  },
  own(cleanup) {
    return cleanup
  },
  settings: {
    get() {
      return null
    },
    set() {}
  },
  log() {},
  network: {
    async fetch(url, init) {
      calls.push({ url, init })
      if (url.includes('bilibili'))
        return new Response(
          JSON.stringify({
            code: 0,
            data: { result: [{ bvid: 'BVfixture', title: '<em>Title</em>', author: 'Artist' }] }
          })
        )
      const rpc = JSON.parse(init.body).req_1
      assert.equal(rpc.method, 'DoSearchForQQMusicDesktop')
      return new Response(
        JSON.stringify({
          code: 0,
          req_1: {
            code: 0,
            data: {
              body: {
                song: {
                  list: [
                    {
                      mid: '000StudioSong1',
                      title: 'Title (Live)',
                      singer: [{ name: 'Singer' }],
                      interval: 120,
                      album: { name: 'Album' }
                    }
                  ]
                }
              }
            }
          }
        })
      )
    }
  },
  media: {
    async extractInfo(request, context) {
      assert(context.signal instanceof AbortSignal)
      calls.push({ request })
      return {
        entries: [
          { id: 'video', title: 'Title', webpage_url: 'https://youtu.be/video', duration: 120 }
        ]
      }
    }
  }
}
const context = (operation) => ({
  host,
  operation,
  deadline: Date.now() + 10000,
  signal: new AbortController().signal
})
test('all five independently bundled archives activate against only the public SDK', () => {
  assert.equal(catalog.plugins.filter((entry) => entry.kind !== 'theme').length, 5)
  for (const entry of catalog.plugins.filter((entry) => entry.kind !== 'theme')) {
    const filename = new URL(entry.url).pathname.split('/').at(-1)
    const bytes = readFileSync(path.join(root, 'dist', filename))
    assert.equal(bytes.length, entry.size)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256)
    const zip = new AdmZip(bytes)
    assert.deepEqual(
      JSON.parse(zip.readAsText('manifest.json')),
      Object.fromEntries(
        ['id', 'displayName', 'author', 'version', 'apiVersion', 'sources'].map((key) => [
          key,
          entry[key]
        ])
      )
    )
    const module = { exports: {} }
    new Function('module', 'exports', 'require', zip.readAsText('index.cjs'))(
      module,
      module.exports,
      require
    )
    const plugin = module.exports.createPlugin()
    assert.equal(plugin.manifest.apiVersion, 2)
    assert.deepEqual(entry.author, {
      name: 'Easy Player',
      url: 'https://github.com/Huiiro/easy-player-plugin'
    })
    assert.deepEqual(plugin.manifest.author, entry.author, 'runtime and archive authors must match')
    plugin.activate(host)
  }
  assert.equal(sources.size, 5)
  assert.equal(calls.length, 0, 'activation must not perform network requests')
})
test('QQ metadata and Bilibili search use public network capability', async () => {
  const tracks = await sources.get('qqmusic').metadata.search('Title', context('metadata.search'))
  assert.equal(tracks[0].resource.resourceId, '000StudioSong1')
  assert.equal(tracks[0].title, 'Title (Live)')
  assert.equal(tracks[0].durationMs, 120000)
  const videos = await sources.get('bili').download.search('Title', context('download.search'))
  assert.equal(videos[0].title, 'Title')
  assert.equal(videos[0].resource.resourceId, 'BVfixture')
})
test('YouTube uses structured extraction and returns a host-owned download plan', async () => {
  const youtube = sources.get('youtube')
  const items = await youtube.download.search('Title', context('download.search'))
  assert.equal(items[0].resource.resourceId, 'video')
  assert.deepEqual(calls.at(-1).request, { type: 'search', query: 'Title', limit: 12 })
  const plan = await youtube.download.resolve({
    url: items[0].url,
    resourceId: 'video',
    downloadType: 'audio',
    quality: 'best'
  })
  assert.equal(plan.transport, 'yt-dlp')
  assert.equal(plan.directory, undefined)
  assert.equal(plan.command, undefined)
  await assert.rejects(
    youtube.download.search('Title'),
    (error) => error.code === 'UNSUPPORTED_CAPABILITY'
  )
})
test('Bilibili keeps HTTP, provider rejection and malformed response failures distinct', async () => {
  const fetch = host.network.fetch
  try {
    host.network.fetch = async () => new Response('denied', { status: 403 })
    await assert.rejects(
      sources.get('bili').download.search('Title', context('download.search')),
      (error) => error.status === 403
    )
    host.network.fetch = async () => new Response('{"code":-412,"message":"verification required"}')
    await assert.rejects(
      sources.get('bili').download.search('Title', context('download.search')),
      (error) => error.code === 'PROVIDER_ERROR'
    )
    host.network.fetch = async () => new Response('{}')
    await assert.rejects(
      sources.get('bili').download.search('Title', context('download.search')),
      (error) => error.code === 'INVALID_RESPONSE'
    )
  } finally {
    host.network.fetch = fetch
  }
})
test('host cancellation reaches adapters before any provider request', async () => {
  const controller = new AbortController()
  controller.abort(new Error('cancelled by host'))
  const before = calls.length
  for (const source of sources.values()) {
    const call = { ...context('search'), signal: controller.signal }
    const request = source.metadata
      ? source.metadata.search('Title', call)
      : source.download.search('Title', call)
    await assert.rejects(request, /cancelled by host/)
  }
  assert.equal(calls.length, before)
})

// Test the unbundled provider SDK facades with fixtures, without an application checkout.
function loader(mocks) {
  const cache = new Map()
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename)
    const exports = {}
    cache.set(filename, exports)
    const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true
      }
    }).outputText
    vm.runInNewContext(
      code,
      {
        exports,
        Error,
        Buffer,
        URL,
        URLSearchParams,
        AbortController,
        AbortSignal,
        fetch,
        require(name) {
          if (mocks[name]) return mocks[name]
          if (!name.startsWith('.')) return createRequire(filename)(name)
          const target = path.resolve(path.dirname(filename), name)
          return load(existsSync(target + '.ts') ? target + '.ts' : path.join(target, 'index.ts'))
        }
      },
      { filename }
    )
    return exports
  }
  return (filename) => load(path.join(root, filename))
}
test('NetEase and Kugou preserve track identities and field normalization', async () => {
  const load = loader({
    '@neteasecloudmusicapienhanced/api': {
      search: async () => ({
        status: 200,
        body: {
          result: {
            songs: [{ id: 123, name: 'Title', artists: [{ name: 'Singer' }], duration: 123000 }]
          }
        }
      })
    },
    kugoumusicapi: {
      search: async () => ({
        status: 200,
        body: {
          status: 1,
          data: {
            lists: [
              {
                MixSongID: 456,
                SongName: 'Title',
                Suffix: '(Live)',
                SingerName: 'Singer',
                Duration: 123
              }
            ]
          }
        }
      })
    }
  })
  const netease = await load('official/netease/metadata.ts').searchNeteaseTracks('Title')
  assert.equal(netease[0].resource.resourceId, '123')
  assert.equal(netease[0].artist, 'Singer')
  const kugou = await load('official/kugou/metadata.ts').searchKugouTracks('Title')
  assert.equal(kugou[0].resource.resourceId, '456')
  assert.equal(kugou[0].title, 'Title (Live)')
  assert.equal(kugou[0].durationMs, 123000)
})

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
        setTimeout,
        clearTimeout,
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

test('Kugou lyrics match original titles without catalog translations, retaining recording versions', async () => {
  let rows = []
  const load = loader({
    kugoumusicapi: {
      search: async () => ({ status: 200, body: { status: 1, data: { lists: rows } } }),
      search_lyric: async () => ({
        status: 200,
        body: { status: 200, candidates: [{ id: 'fixture', accesskey: 'key' }] }
      }),
      lyric: async () => ({
        status: 200,
        body: { status: 200, decodeContent: '[1000,500]<0,500,0>Fixture' }
      })
    }
  })
  const lyrics = load('official/kugou/lyrics.ts')
  const metadata = load('official/kugou/metadata.ts')
  for (const suffix of ['(花之塔)', '(Tower of Flower)']) {
    rows = [
      {
        MixSongID: '423788044',
        FileHash: 'A'.repeat(32),
        OriSongName: '花の塔',
        Suffix: suffix,
        SingerName: '酸欠少女さユり'
      }
    ]
    const candidates = await lyrics.searchKugouLyrics(
      { title: '花の塔', artist: '酸欠少女さユり' },
      true
    )
    assert.equal(candidates[0].title, '花の塔')
    assert.equal(candidates[0].artist, '酸欠少女さユり')
    assert.equal(candidates[0].format, 'krc')
    assert.equal(
      (await metadata.searchKugouTracks('花の塔'))[0].title,
      '花の塔 ' + suffix,
      'metadata retains the display suffix'
    )
  }
  rows = [
    { MixSongID: '1', FileHash: 'A'.repeat(32), SongName: '花の塔 (花之塔)', OriSongName: '花の塔' }
  ]
  assert.equal((await lyrics.searchKugouLyrics({ title: '花の塔' }, true))[0].title, '花の塔')
  for (const suffix of [
    'Live',
    'Instrumental',
    'Acoustic',
    'Remix',
    'Cover',
    'Piano',
    '女声',
    '男声',
    '加速',
    'Slowed',
    'TV Size',
    'TVサイズ',
    'Demo',
    'ライブ'
  ]) {
    rows = [
      { MixSongID: '1', FileHash: 'A'.repeat(32), OriSongName: 'Song', Suffix: '(' + suffix + ')' }
    ]
    assert.equal(
      (await lyrics.searchKugouLyrics({ title: 'Song' }, true))[0].title,
      'Song (' + suffix + ')',
      'do not turn a recording version into the studio song'
    )
  }
  rows = [
    {
      MixSongID: '2',
      FileHash: 'B'.repeat(32),
      OriSongName: 'ミカヅキ',
      Suffix: '(新月)',
      SingerName: '酸欠少女さユり'
    }
  ]
  assert.equal(
    (await lyrics.searchKugouLyrics({ title: '花の塔' }, true))[0].title,
    'ミカヅキ',
    'never substitute the requested title for an unrelated result'
  )
})

test('NetEase resolves declared title and artist aliases and retrieves LRC when YRC exists alone', async () => {
  let row = {
    id: 1,
    name: 'Original song',
    transNames: ['Translated song'],
    artists: [{ id: 771, name: 'Original singer', alias: [] }]
  }
  let legacyCalls = 0,
    artistCalls = 0,
    code = 200
  const load = loader({
    '@neteasecloudmusicapienhanced/api': {
      search: async () => ({ status: 200, body: { code, result: { songs: [row] } } }),
      artist_detail: async ({ id }) => {
        artistCalls++
        return {
          status: 200,
          body: {
            code: 200,
            data: {
              artist: { id: Number(id), name: 'Original singer', alias: ['Translated singer'] }
            }
          }
        }
      },
      lyric_new: async () => ({
        status: 200,
        body: { code: 200, yrc: { lyric: '[1000,500](1000,500,0)Fixture' } }
      }),
      lyric: async () => {
        legacyCalls++
        return { status: 200, body: { code: 200, lrc: { lyric: '[00:01.00]Fixture' } } }
      }
    }
  })
  const lyrics = load('official/netease/lyrics.ts')
  const query = { title: 'Translated song', artist: 'Translated singer' }
  const result = await lyrics.searchNeteaseLyrics(query, false)
  assert.equal(result[0].title, query.title)
  assert.equal(result[0].artist, query.artist)
  assert.equal(result[0].format, 'lrc')
  assert.equal(legacyCalls, 1, 'YRC availability must not prevent the requested LRC fallback')
  assert.equal(artistCalls, 1)
  assert.equal((await lyrics.searchNeteaseLyrics(query, true))[0].format, 'yrc')
  assert.equal(artistCalls, 1, 'public artist identity is cached')
  assert.equal(
    (await lyrics.searchNeteaseLyrics({ ...query, title: 'Unknown song' }, false)).length,
    0
  )
  row = { ...row, name: 'Original song (Live)' }
  assert.equal(
    (await lyrics.searchNeteaseLyrics(query, false))[0].title,
    'Translated song (Live)',
    'an alias cannot hide the recording version'
  )
  code = 403
  for (const search of [
    () => lyrics.searchNeteaseLyrics(query, false),
    () => load('official/netease/metadata.ts').searchNeteaseTracks(query.title),
    () => load('official/netease/artwork.ts').searchNeteaseArtwork(query)
  ])
    await assert.rejects(
      search,
      (error) => error.status === 403,
      'a provider rejection is not an empty search'
    )
})

test('QQ lyric identity separates display names, declared aliases and recording subtitles', async () => {
  let row = {
    mid: '000StudioSong1',
    id: 1,
    title: 'Original song (Display translation)',
    name: 'Original song',
    alias: ['Translated song'],
    subtitle: '',
    singer: [{ name: 'Original singer', alias: ['Translated singer'] }]
  }
  const transport = async (_url, init) => ({
    ok: true,
    text: async () =>
      JSON.stringify(
        init.body
          ? { code: 0, req_1: { code: 0, data: { body: { song: { list: [row] } } } } }
          : { code: 0, lyric: '[00:01.00]Fixture' }
      )
  })
  const load = loader({})
  const lyrics = load('official/qqmusic/lyrics.ts')
  const context = {
    signal: new AbortController().signal,
    deadline: Date.now() + 10000,
    operation: 'lyrics.search',
    host: { network: { fetch: transport } }
  }
  const query = { title: 'Original song', artist: 'Translated singer' }
  let result = await lyrics.searchQQMusicLyrics(query, false, context)
  assert.equal(result[0].title, query.title)
  assert.equal(result[0].artist, query.artist)
  result = await lyrics.searchQQMusicLyrics({ ...query, title: 'Translated song' }, false, context)
  assert.equal(result[0].title, 'Translated song')
  row = { ...row, subtitle: 'Live' }
  assert.equal(
    (await lyrics.searchQQMusicLyrics({ ...query, title: 'Translated song' }, false, context))[0]
      .title,
    'Translated song (Live)'
  )
  row = { ...row, subtitle: '', singer: [] }
  assert.equal(
    (await lyrics.searchQQMusicLyrics(query, false, context))[0].artist,
    '',
    'missing singers must not be filled with the requested singer'
  )
  assert.equal(
    (await lyrics.searchQQMusicLyrics({ ...query, title: 'Unrelated title' }, false, context))
      .length,
    0
  )
})

test('optional artist enrichment verifies IDs and never replaces a canonical name on failure', async () => {
  const load = loader({}),
    artists = load('official/netease/artists.ts')
  const row = [{ id: 772, name: 'Original singer', aliases: [] }]
  const result = await artists.resolveNeteaseArtists(
    row,
    'Translated singer',
    async () => ({
      status: 200,
      body: { code: 200, data: { artist: { id: 999, alias: ['Translated singer'] } } }
    }),
    new Set()
  )
  assert.deepEqual(
    JSON.parse(JSON.stringify(result)),
    row,
    'a different artist ID cannot supply aliases'
  )
  const failure = await artists.resolveNeteaseArtists(
    row,
    'Translated singer',
    async () => {
      throw new Error('optional lookup failed')
    },
    new Set()
  )
  assert.deepEqual(JSON.parse(JSON.stringify(failure)), row)
})

test('NetEase lyric denials do not become empty results or retry a denied endpoint', async () => {
  let legacy = 0
  const load = loader({
    '@neteasecloudmusicapienhanced/api': {
      search: async () => ({
        status: 200,
        body: { code: 200, result: { songs: [{ id: 1, name: 'Song' }] } }
      }),
      lyric_new: async () => ({ status: 200, body: { code: 403 } }),
      lyric: async () => {
        legacy++
        return { status: 200, body: { lrc: { lyric: '[00:01.00]Fixture' } } }
      }
    }
  })
  await assert.rejects(
    load('official/netease/lyrics.ts').searchNeteaseLyrics({ title: 'Song' }, false),
    (error) => error.status === 403
  )
  assert.equal(legacy, 0)
})

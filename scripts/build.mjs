import { buildThemes } from './build-themes.mjs'
/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { build } from 'esbuild'
import AdmZip from 'adm-zip'
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  unlinkSync
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire, isBuiltin } from 'node:module'
import { createHash } from 'node:crypto'

const require = createRequire(import.meta.url)
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const output = path.join(root, 'dist')
const distribution = JSON.parse(readFileSync(path.join(root, 'distribution.json'), 'utf8'))
if (
  !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(distribution.repository) ||
  !/^[A-Za-z0-9_.-]+$/.test(distribution.releaseTag)
)
  throw new Error('Invalid distribution settings')
mkdirSync(output, { recursive: true })
const targets = [
  ['netease', 'netease/index.ts', 'neteasePlugin'],
  ['kugou', 'kugou/index.ts', 'kugouPlugin'],
  ['qqmusic', 'qqmusic/index.ts', 'qqmusicPlugin'],
  ['bili', 'media.ts', 'biliPlugin'],
  ['youtube', 'media.ts', 'youtubePlugin']
]
// Both SDK entrypoints scan module directories at runtime. Build a static facade of
// the APIs actually used, preserving their cookie conversion/request semantics.
const sdkMethods = {
  '@neteasecloudmusicapienhanced/api': [
    'search',
    'song_detail',
    'artist_detail',
    'album',
    'song_wiki_summary',
    'lyric',
    'lyric_new'
  ],
  kugoumusicapi: ['search', 'krm_audio', 'album_detail', 'search_lyric', 'lyric']
}
const escapePath = (value) => JSON.stringify(value.replaceAll('\\', '/'))
const catalog = { schemaVersion: 1, plugins: [] }
const generated = new Set()
for (const [id, entry, exported] of targets) {
  const result = await build({
    absWorkingDir: root,
    stdin: {
      contents: `import { ${exported} as plugin } from './official/${entry}';
export function createPlugin() { return plugin }`,
      resolveDir: root,
      loader: 'ts'
    },
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    bundle: true,
    write: false,
    metafile: true,
    legalComments: 'inline',
    plugins: [
      {
        name: 'official-host-and-sdk',
        setup(builder) {
          builder.onResolve(
            { filter: /^(@neteasecloudmusicapienhanced\/api|kugoumusicapi)$/ },
            (args) => ({ path: args.path, namespace: 'sdk' })
          )
          builder.onLoad({ filter: /.*/, namespace: 'sdk' }, (args) => {
            const dir = path.dirname(require.resolve(args.path))
            const netease = args.path.startsWith('@netease')
            const request = escapePath(path.join(dir, 'util/request.js'))
            const contents = `const { cookieToJson } = require(${escapePath(path.join(dir, 'util/index.js'))});
${
  netease
    ? `const fs = require('node:fs'); const token = require('node:path').join(require('node:os').tmpdir(), 'anonymous_token');
if (!fs.existsSync(token)) fs.writeFileSync(token, '', { flag: 'a' });`
    : ''
}
${sdkMethods[args.path]
  .map(
    (
      method
    ) => `const ${method}Module = require(${escapePath(path.join(dir, 'module', method + '.js'))});
exports.${method} = (data = {}) => ${method}Module({ ...data, cookie: typeof data.cookie === 'string' ? cookieToJson(data.cookie) : data.cookie || {} }, (...args) => ${netease ? `require(${request})(...args)` : `require(${request}).createRequest(...args)`});`
  )
  .join('\n')}`
            return { contents, loader: 'js', resolveDir: dir }
          })
        }
      }
    ]
  })
  for (const input of Object.keys(result.metafile.inputs)) {
    if (input.startsWith('sdk:') || input === '<stdin>') continue
    const filename = path.resolve(root, input)
    if (filename !== root && !filename.startsWith(root + path.sep))
      throw new Error('Plugin build escaped its project: ' + input)
  }
  const code = result.outputFiles[0].text
  for (const output of Object.values(result.metafile.outputs)) {
    if (output.imports.some((dependency) => dependency.external && !isBuiltin(dependency.path)))
      throw new Error('A plugin still depends on application node_modules')
  }
  const module = { exports: {} }
  // Build-time inspection only. No activation or provider request is performed.
  new Function('module', 'exports', 'require', code)(module, module.exports, require)
  const definition = module.exports.createPlugin({})
  const manifest = definition.manifest
  if (manifest.id !== 'builtin.' + id) throw new Error('Unexpected plugin identity')
  const zip = new AdmZip()
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'))
  zip.addFile('index.cjs', Buffer.from(code))
  const licenses = [
    ...new Set(
      Object.keys(result.metafile.inputs)
        .filter((file) => file.includes('node_modules/'))
        .map((file) => {
          let dir = path.dirname(path.resolve(root, file))
          while (dir !== root && !existsSync(path.join(dir, 'package.json')))
            dir = path.dirname(dir)
          return dir
        })
    )
  ]
  const notices = []
  for (const dir of licenses) {
    const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
    notices.push({
      name: pkg.name,
      version: pkg.version,
      license: pkg.license,
      repository: pkg.repository
    })
    const licenseFiles = readdirSync(dir, { withFileTypes: true })
      .filter(
        (file) => file.isFile() && /^(licen[cs]e|copying|copyright)(?:[.-].*)?$/i.test(file.name)
      )
      .map((file) => file.name)
      .sort()
    for (const filename of licenseFiles) {
      zip.addFile(
        `licenses/${pkg.name.replaceAll('/', '_')}@${pkg.version}/${filename.toUpperCase()}`,
        Buffer.from(readFileSync(path.join(dir, filename), 'utf8').replace(/\r\n/g, '\n'))
      )
    }
  }
  zip.addFile('licenses/NOTICE.json', Buffer.from(JSON.stringify(notices, null, 2)))
  for (const entry of zip.getEntries()) {
    // ZIP's creator OS otherwise changes the hash between Windows and Linux.
    entry.header.made = 0x0314
    entry.header.attr = (0o100644 << 16) >>> 0
    entry.header.time = new Date(2020, 0, 1, 0, 0, 0)
  }
  const bytes = zip.toBuffer()
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const filename = `${manifest.id}-${manifest.version}-${sha256.slice(0, 12)}.epp`
  writeFileSync(path.join(output, filename), bytes)
  generated.add(filename)
  catalog.plugins.push({
    ...manifest,
    size: bytes.length,
    sha256,
    url: `https://github.com/${distribution.repository}/releases/download/${distribution.releaseTag}/${filename}`
  })
  console.log(`${manifest.displayName}: ${filename} (${Math.round(bytes.length / 1024)} KiB)`)
}
for (const { filename, ...entry } of await buildThemes(root, output)) {
  generated.add(filename)
  catalog.plugins.push({
    ...entry,
    url: `https://github.com/${distribution.repository}/releases/download/${distribution.releaseTag}/${filename}`
  })
  console.log(entry.displayName + ': ' + filename)
}
writeFileSync(path.join(output, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n')
writeFileSync(path.join(root, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n')
for (const file of readdirSync(output, { withFileTypes: true })) {
  if (
    !file.isFile() ||
    generated.has(file.name) ||
    !/^builtin\.(netease|kugou|qqmusic|bili|youtube|theme\.(?:blackhole|rainy|aurora|ocean|sunset|forest|matrix|starfield|startrails|dna))-[a-zA-Z0-9.-]+\.epp$/.test(
      file.name
    )
  )
    continue
  const target = path.resolve(output, file.name)
  if (path.dirname(target) !== output) throw new Error('Invalid plugin artifact path')
  unlinkSync(target)
}

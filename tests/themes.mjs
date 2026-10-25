import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, cpSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'
import { createHash } from 'node:crypto'
import { packTheme } from '../scripts/pack-theme.mjs'
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const catalog = JSON.parse(readFileSync(path.join(root, 'dist/catalog.json'), 'utf8'))
test('Black Hole is a data-only theme with finite precomputed orbit textures', () => {
  const theme = catalog.plugins.find((entry) => entry.id === 'builtin.theme.blackhole')
  assert.equal(theme.kind, 'theme')
  assert.deepEqual(theme.sources, [])
  const zip = new AdmZip(
    readFileSync(path.join(root, 'dist', new URL(theme.url).pathname.split('/').at(-1)))
  )
  assert(!zip.getEntries().some((entry) => /\.(?:js|cjs|mjs|html|vue)$/.test(entry.entryName)))
  const data = JSON.parse(zip.readAsText('theme.json'))
  assert(zip.readAsText(data.shader.fragment).startsWith('#version 300 es'))
  for (const texture of data.shader.textures) {
    const bytes = zip.readFile(texture.path)
    assert.equal(bytes.length, texture.width * texture.height * 8)
    for (let index = 0; index < bytes.length; index += 4)
      assert(Number.isFinite(bytes.readFloatLE(index)))
  }
})
test('Third-party example packs independently without runtime JavaScript or application modules', () => {
  const output = mkdtempSync(path.join(tmpdir(), 'ep-theme-example-'))
  const entry = packTheme(path.join(root, 'examples/midnight'), output)
  const zip = new AdmZip(readFileSync(path.join(output, entry.filename)))
  assert.equal(entry.id, 'example.midnight')
  assert.deepEqual(
    zip
      .getEntries()
      .map((entry) => entry.entryName)
      .sort(),
    ['manifest.json', 'theme.json']
  )
  assert.equal(JSON.parse(zip.readAsText('theme.json')).tokens['--color-text'], '#edf0ff')
})

test('Nyan Cat retains declared fonts, image slots, component styles, text and font license', () => {
  const output = mkdtempSync(path.join(tmpdir(), 'ep-nyan-example-'))
  const directory = path.join(root, 'examples/nyan-cat')
  const entry = packTheme(directory, output)
  const zip = new AdmZip(readFileSync(path.join(output, entry.filename)))
  const data = JSON.parse(zip.readAsText('theme.json'))
  assert.equal(data.assets.slots.playbackThumb.image, 'cat')
  assert.equal(data.assets.slots.global.font, 'cute')
  assert.equal(data.assets.text.appTitle, 'Nyan Player')
  assert.equal(data.tokens['--ep-range-thumb-width'], '60px')
  assert.equal(data.rules['.ep-playback-progress'].height, '36px')
  for (const file of [
    ...Object.values(data.assets.resources).map((resource) => resource.path),
    ...data.assets.licenses
  ])
    assert.deepEqual(zip.readFile(file), readFileSync(path.join(directory, file)))
  assert(!zip.getEntries().some((entry) => /\.(?:js|cjs|mjs|html|vue|svg)$/.test(entry.entryName)))
})

test('Authoring schemas are a versioned SDK snapshot and packing rejects malformed declarations', () => {
  const contract = JSON.parse(readFileSync(path.join(root, 'schemas/contract.json')))
  assert.equal(contract.sdkVersion, '2.1.0')
  for (const [name, hash] of Object.entries(contract.sha256))
    assert.equal(
      createHash('sha256')
        .update(readFileSync(path.join(root, 'schemas', name)))
        .digest('hex'),
      hash
    )
  const temporary = mkdtempSync(path.join(tmpdir(), 'ep-theme-invalid-'))
  const directory = path.join(temporary, 'theme')
  cpSync(path.join(root, 'examples/midnight'), directory, { recursive: true })
  const filename = path.join(directory, 'theme.json')
  const theme = JSON.parse(readFileSync(filename))
  for (const invalid of [
    { ...theme, version: 2 },
    { ...theme, tokens: { '--color-bg': 'url(https://example.test)' } },
    { ...theme, rules: { body: { display: 'none' } } },
    { ...theme, assets: { resources: {}, slots: { global: { font: 'missing' } } } }
  ]) {
    writeFileSync(filename, JSON.stringify(invalid))
    assert.throws(() => packTheme(directory, path.join(temporary, 'output')))
  }
})

test('Theme archives reproduce across LF/CRLF checkouts with binary resources unchanged', () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'ep-theme-eol-'))
  const source = path.join(root, 'examples/nyan-cat')
  const copy = path.join(temporary, 'theme')
  cpSync(source, copy, { recursive: true })
  const first = packTheme(source, path.join(temporary, 'first'))
  for (const filename of ['manifest.json', 'theme.json', 'fonts/OFL.txt']) {
    const file = path.join(copy, filename)
    writeFileSync(file, readFileSync(file, 'utf8').replace(/\r?\n/g, '\r\n'))
  }
  const second = packTheme(copy, path.join(temporary, 'second'))
  assert.equal(first.sha256, second.sha256)
})

test('Theme packing rejects resource links outside its project directory', () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'ep-theme-path-'))
  const directory = path.join(temporary, 'theme')
  cpSync(path.join(root, 'examples/midnight'), directory, { recursive: true })
  const outside = path.join(temporary, 'outside')
  mkdirSync(outside)
  writeFileSync(path.join(outside, 'wall.png'), 'not a project resource')
  symlinkSync(
    outside,
    path.join(directory, 'images'),
    process.platform === 'win32' ? 'junction' : 'dir'
  )
  const filename = path.join(directory, 'theme.json')
  const theme = JSON.parse(readFileSync(filename))
  theme.assets = {
    resources: { wall: { type: 'image', path: 'images/wall.png' } },
    slots: { appBackground: { image: 'wall' } }
  }
  writeFileSync(filename, JSON.stringify(theme))
  assert.throws(() => packTheme(directory, path.join(temporary, 'output')), /escaped its project/)
})

test('Rainy Evening ships its image, shader and attribution with no application runtime dependency', () => {
  const entry = catalog.plugins.find((entry) => entry.id === 'builtin.theme.rainy')
  assert.equal(entry.kind, 'theme')
  assert.deepEqual(entry.sources, [])
  const zip = new AdmZip(
    readFileSync(path.join(root, 'dist', new URL(entry.url).pathname.split('/').at(-1)))
  )
  const theme = JSON.parse(zip.readAsText('theme.json'))
  assert.equal(theme.shader.fps, 24)
  assert.equal(theme.shader.textures[0].format, 'image')
  assert.deepEqual([theme.shader.textures[0].width, theme.shader.textures[0].height], [1672, 941])
  assert.equal(theme.assets.slots.appBackground.image, 'street')
  assert(zip.readAsText(theme.shader.fragment).includes('textureSize(u_image, 0)'))
  assert(zip.readAsText('licenses/NOTICE.txt').includes('CC BY-NC-SA 3.0'))
  assert.deepEqual(
    zip.readFile('images/rainy-night-cool.webp'),
    readFileSync(path.join(root, 'themes/rainy/images/rainy-night-cool.webp'))
  )
  assert(!zip.getEntries().some((entry) => /\.(?:js|cjs|mjs|vue|ts|html)$/.test(entry.entryName)))
})

test('Eight official backgrounds bundle their original renderer, scoped styles and Vue license', () => {
  const entries = catalog.plugins.filter(
    (entry) =>
      entry.kind === 'theme' &&
      !['builtin.theme.blackhole', 'builtin.theme.rainy'].includes(entry.id)
  )
  assert.equal(entries.length, 8)
  for (const entry of entries) {
    const zip = new AdmZip(
      readFileSync(path.join(root, 'dist', new URL(entry.url).pathname.split('/').at(-1)))
    )
    const theme = JSON.parse(zip.readAsText('theme.json'))
    assert.equal(theme.renderer.entry, 'background.js')
    assert(!theme.shader)
    const code = zip.readAsText('background.js')
    assert(code.includes('easy-player-theme'))
    assert(!code.includes('src/renderer/'))
    assert(!code.includes('../../../assets/'))
    assert(zip.readAsText('licenses/renderer-dependencies.txt').includes('The MIT License'))
    assert(!zip.getEntries().some((entry) => /\.(?:html|vue|ts|cjs)$/.test(entry.entryName)))
    if (entry.id === 'builtin.theme.startrails') assert(code.includes('data:image/svg+xml;base64,'))
  }
})

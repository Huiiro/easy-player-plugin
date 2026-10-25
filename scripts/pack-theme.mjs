import Ajv from 'ajv'
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  realpathSync,
  statSync
} from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import AdmZip from 'adm-zip'

const ajv = new Ajv({ allErrors: true, strict: true })
const validators = ['theme-plugin-manifest.schema.json', 'theme.schema.json'].map((name) =>
  ajv.compile(JSON.parse(readFileSync(new URL('../schemas/' + name, import.meta.url), 'utf8')))
)

export function packTheme(directory, output) {
  const root = realpathSync(path.resolve(directory))
  const read = (name) => {
    if (name.length > 160 || !/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(name))
      throw new Error('Invalid theme path')
    const filename = realpathSync(path.join(root, name))
    const relative = path.relative(root, filename)
    if (
      !relative ||
      relative.startsWith('..') ||
      path.isAbsolute(relative) ||
      !statSync(filename).isFile()
    )
      throw new Error('Theme input escaped its project: ' + name)
    if (statSync(filename).size > 16 * 1024 * 1024)
      throw new Error('Theme file exceeds 16 MiB: ' + name)
    const bytes = readFileSync(filename)
    return /\.(json|glsl|txt|js)$/.test(name)
      ? Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'))
      : bytes
  }
  const manifest = JSON.parse(read('manifest.json'))
  const theme = JSON.parse(read('theme.json'))
  for (const [index, value] of [manifest, theme].entries()) {
    if (!validators[index](value))
      throw new Error(
        (index ? 'theme.json: ' : 'manifest.json: ') + ajv.errorsText(validators[index].errors)
      )
  }
  if (theme.renderer && !manifest.id.startsWith('builtin.'))
    throw new Error('Renderer entry is reserved for official themes')
  for (const [slot, assignment] of Object.entries(theme.assets?.slots ?? {})) {
    for (const [kind, resource] of Object.entries(assignment)) {
      if (theme.assets.resources[resource]?.type !== kind)
        throw new Error('Invalid resource assignment: ' + slot + '.' + kind)
    }
  }
  const files = [
    'manifest.json',
    'theme.json',
    ...(theme.renderer ? [theme.renderer.entry] : []),
    ...Object.values(theme.assets?.resources ?? {}).map((resource) => resource.path),
    ...(theme.assets?.licenses ?? []),
    ...(theme.shader
      ? [theme.shader.fragment, ...theme.shader.textures.map((texture) => texture.path)]
      : [])
  ]
  if (existsSync(path.join(root, 'licenses'))) {
    for (const name of readdirSync(path.join(root, 'licenses')).sort()) {
      if (!/^[a-zA-Z0-9_-]+\.txt$/.test(name)) throw new Error('Invalid theme license path')
      files.push('licenses/' + name)
    }
  }
  const zip = new AdmZip()
  if (new Set(files.map((file) => file.toLowerCase())).size !== new Set(files).size)
    throw new Error('Case-conflicting theme paths')
  if (new Set(files).size > 128) throw new Error('Too many theme files')
  let total = 0
  for (const file of new Set(files)) {
    const bytes = read(file)
    const limit =
      file === 'manifest.json' || file === 'theme.json'
        ? 128 * 1024
        : file.endsWith('.js')
          ? 2 * 1024 * 1024
          : file.endsWith('.glsl')
            ? 256 * 1024
            : file.endsWith('.txt')
              ? 64 * 1024
              : 16 * 1024 * 1024
    total += bytes.length
    if (bytes.length > limit || total > 32 * 1024 * 1024)
      throw new Error('Theme resource size limit exceeded: ' + file)
    zip.addFile(file, bytes)
  }
  for (const entry of zip.getEntries()) {
    entry.header.made = 0x0314
    entry.header.attr = (0o100644 << 16) >>> 0
    entry.header.time = new Date(2020, 0, 1, 0, 0, 0)
  }
  const bytes = zip.toBuffer()
  if (bytes.length > 16 * 1024 * 1024) throw new Error('Theme archive exceeds 16 MiB')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const filename = manifest.id + '-' + manifest.version + '-' + sha256.slice(0, 12) + '.epp'
  mkdirSync(output, { recursive: true })
  writeFileSync(path.join(output, filename), bytes)
  return { ...manifest, sha256, size: bytes.length, filename }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.argv[2])
    throw new Error('Usage: node scripts/pack-theme.mjs <theme-directory> [output-directory]')
  console.log(packTheme(process.argv[2], path.resolve(process.argv[3] || 'dist')))
}

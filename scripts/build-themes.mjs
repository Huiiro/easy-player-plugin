import { buildRendererThemes } from './build-renderer-themes.mjs'
import { build } from 'esbuild'
import { writeFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { packTheme } from './pack-theme.mjs'

async function buildTheme(root, output, name) {
  const directory = path.join(root, 'themes', name)
  const checkInputs = (result) => {
    for (const input of Object.keys(result.metafile.inputs)) {
      if (!realpathSync(path.resolve(root, input)).startsWith(realpathSync(directory) + path.sep))
        throw new Error('Theme source escaped its project')
    }
  }
  const result = await build({
    entryPoints: [path.join(directory, 'shader.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    metafile: true,
    absWorkingDir: root
  })
  checkInputs(result)
  const module = { exports: {} }
  new Function('module', 'exports', result.outputFiles[0].text)(module, module.exports)
  writeFileSync(path.join(directory, 'fragment.glsl'), module.exports.fragmentShader)
  if (name === 'blackhole') {
    const tablesBuild = await build({
      entryPoints: [path.join(directory, 'geodesics.ts')],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      write: false,
      metafile: true,
      absWorkingDir: root
    })
    checkInputs(tablesBuild)
    const orbit = { exports: {} }
    new Function('module', 'exports', tablesBuild.outputFiles[0].text)(orbit, orbit.exports)
    const tables = orbit.exports.createOrbitTables()
    for (const [name, values] of [
      ['paths.bin', tables.paths],
      ['ends.bin', tables.ends]
    ]) {
      const bytes = Buffer.alloc(values.length * 4)
      for (let index = 0; index < values.length; index++)
        bytes.writeFloatLE(values[index], index * 4)
      writeFileSync(path.join(directory, name), bytes)
    }
  }
  return packTheme(directory, output)
}

export async function buildThemes(root, output) {
  const themes = []
  for (const name of ['blackhole', 'rainy']) themes.push(await buildTheme(root, output, name))
  return [...themes, ...(await buildRendererThemes(root, output))]
}

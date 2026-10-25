import { build } from 'esbuild'
import { parse, compileScript, compileStyle } from '@vue/compiler-sfc'
import { readFileSync, writeFileSync, realpathSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { packTheme } from './pack-theme.mjs'

const require = createRequire(import.meta.url)
export const rendererThemes = [
  'aurora',
  'ocean',
  'sunset',
  'forest',
  'matrix',
  'starfield',
  'startrails',
  'dna'
]

export async function buildRendererThemes(root, output) {
  const entries = []
  for (const name of rendererThemes) {
    const directory = path.join(root, 'themes', name)
    const filename = path.join(directory, 'Background.vue')
    const scope = 'theme-' + name
    const { descriptor } = parse(readFileSync(filename, 'utf8').replace(/\r\n/g, '\n'), {
      filename
    })
    const css = descriptor.styles
      .map((style) => {
        const result = compileStyle({
          source: style.content.replace(/url\((['"])([^'"]+)\1\)/g, (original, _quote, value) => {
            if (value.startsWith('#')) return original
            const file = realpathSync(path.resolve(directory, value))
            if (!file.startsWith(realpathSync(directory) + path.sep) || !file.endsWith('.svg'))
              throw new Error('Invalid theme CSS asset')
            return (
              'url("data:image/svg+xml;base64,' +
              Buffer.from(readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).toString('base64') +
              '")'
            )
          }),
          filename,
          id: 'data-v-' + scope,
          scoped: style.scoped,
          isProd: true
        })
        if (result.errors.length) throw new Error(result.errors.join('\n'))
        return result.code
      })
      .join('\n')
    const result = await build({
      absWorkingDir: root,
      stdin: {
        contents: `import Background from './themes/${name}/Background.vue'; import {mountTheme} from './themes/runtime'; mountTheme(Background,${JSON.stringify(css)});`,
        resolveDir: root,
        loader: 'ts'
      },
      bundle: true,
      platform: 'browser',
      format: 'iife',
      target: 'chrome130',
      minify: true,
      write: false,
      metafile: true,
      define: {
        'process.env.NODE_ENV': '"production"',
        __VUE_OPTIONS_API__: 'true',
        __VUE_PROD_DEVTOOLS__: 'false',
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false'
      },
      plugins: [
        {
          name: 'official-background',
          setup(builder) {
            builder.onResolve({ filter: /^vue$/ }, () => ({
              path: require.resolve('vue/dist/vue.runtime.esm-bundler.js')
            }))
            builder.onLoad({ filter: /\.vue$/ }, (args) => {
              if (realpathSync(args.path) !== realpathSync(filename))
                throw new Error('Unexpected theme component')
              const script = compileScript(descriptor, {
                id: scope,
                inlineTemplate: true,
                isProd: true
              })
              return {
                contents:
                  script.content.replace('export default', 'const component =') +
                  `\ncomponent.__scopeId=${JSON.stringify('data-v-' + scope)};export default component;`,
                loader: 'ts',
                resolveDir: directory
              }
            })
          }
        }
      ]
    })
    const allowed = [realpathSync(directory), realpathSync(path.join(root, 'node_modules'))]
    const runtime = realpathSync(path.join(root, 'themes/runtime.ts'))
    for (const input of Object.keys(result.metafile.inputs)) {
      if (input === '<stdin>') continue
      const file = realpathSync(path.resolve(root, input))
      if (file !== runtime && !allowed.some((parent) => file.startsWith(parent + path.sep)))
        throw new Error('Theme build input escaped its project: ' + input)
    }
    if (Object.values(result.metafile.outputs).some((output) => output.imports.length))
      throw new Error('Theme has an external runtime dependency')
    const dependencies = new Map()
    for (const input of Object.keys(result.metafile.inputs)) {
      if (!input.includes('node_modules')) continue
      let folder = path.dirname(path.resolve(root, input))
      while (folder.startsWith(path.join(root, 'node_modules') + path.sep)) {
        try {
          const pkg = JSON.parse(readFileSync(path.join(folder, 'package.json'), 'utf8'))
          const license = readFileSync(path.join(folder, 'LICENSE'), 'utf8').replace(/\r\n/g, '\n')
          dependencies.set(pkg.name, pkg.name + '@' + pkg.version + '\n' + license)
          break
        } catch {
          folder = path.dirname(folder)
        }
      }
    }
    mkdirSync(path.join(directory, 'licenses'), { recursive: true })
    writeFileSync(
      path.join(directory, 'licenses/renderer-dependencies.txt'),
      [...dependencies]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, text]) => text)
        .join('\n\n')
    )
    writeFileSync(path.join(directory, 'background.js'), result.outputFiles[0].contents)
    entries.push(packTheme(directory, output))
  }
  return entries
}

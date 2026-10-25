import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { packTheme } from './pack-theme.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
for (const name of ['midnight', 'nyan-cat'])
  console.log(packTheme(path.join(root, 'examples', name), path.join(root, 'dist/examples')))

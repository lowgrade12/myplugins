// Cherry Pick's part of the build: what goes into the CherryPick plugin
// folder. The source is ES modules and JSX under src/js, bundled by esbuild
// into one classic script for Stash to load. JSX compiles against
// window.PluginApi.React (src/js/react-shim.js), so the plugin ships no React
// of its own and always runs on the React that Stash runs.
import { build as esbuild } from 'esbuild'
import { cp, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, 'src')

export const id = 'CherryPick'
export const title = 'Cherry Pick'
// The line about the plugin in the repo's README (scripts/readme.mjs).
export const summary =
  'Learns what you like from your ratings and plays: a For you row, Your score on unrated scenes, More like this, and performer and scene brackets.'
// Paths in this folder whose changes alter the plugin zip. Tests and docs are
// left out so changing them offers users no update.
export const inputs = ['src', 'plugin.mjs', 'LICENSE']

export async function build(out) {
  await esbuild({
    entryPoints: [join(src, 'js', 'main.jsx')],
    outfile: join(out, 'cherrypick.js'),
    bundle: true,
    format: 'iife',
    target: 'es2020',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    inject: [join(src, 'js', 'react-shim.js')],
    charset: 'utf8',
    legalComments: 'none',
    logLevel: 'warning',
    // Load once per page. Stash's plugin loader drops and re-adds plugin
    // script tags when its Apollo store resets (every finished scan), and
    // the browser runs a re-added script again; the first run's patches
    // are still registered, so a second run would add every piece twice
    // (two navbar icons, two front-page rows) and boot a second library
    // and model.
    banner: {
      js: `if (!window.__${id}Loaded__) { window.__${id}Loaded__ = true;`,
    },
    footer: { js: '}' },
  })

  // CSS: concatenate the numbered partials in order, one file for Stash to serve.
  const cssDir = join(src, 'css')
  const partials = (await readdir(cssDir))
    .filter((f) => f.endsWith('.css'))
    .sort()
  const css = await Promise.all(
    partials.map(
      async (f) => `/* ${f} */\n${await readFile(join(cssDir, f), 'utf8')}`,
    ),
  )
  await writeFile(join(out, 'cherrypick.css'), css.join('\n'))

  await cp(join(src, `${id}.yml`), join(out, `${id}.yml`))
}

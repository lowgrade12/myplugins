// Builds the plugin into ../plugins/CherryPick, the folder build_site.sh
// zips. The source stays here, outside plugins/, so only the built files
// ship.
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, id } from './plugin.mjs'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'plugins', id)
await mkdir(out, { recursive: true })
await build(out)
console.log(`built ${out}`)

// What a host has to copy to serve the dashboard, and what it can leave behind. A static host has no
// service, so the notifications page does nothing there, and filtering the list by hand means
// forgetting a file the next time one is added. This writes the list instead.
//
// Usage: node scripts/dist-manifest.js [--out dist/manifest.json]
//
// tests/dist-manifest.test.js fails if the written file and the folder disagree, so the file cannot
// drift once it is committed.
import {readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs'
import {join, relative, resolve, sep} from 'node:path'
import {pathToFileURL} from 'node:url'

export const DEFAULT_OUT = 'dist/manifest.json'
// The notifications page talks to the service and only to the service.
export const SERVICE_ONLY = ['integrations.css', 'integrations.html', 'integrations.js']
// Written or optional, so they are nobody's to copy: the slimmed directory is regenerated daily, the
// site config is whatever the host wrote, and this file is this file.
export const GENERATED = ['manifest.json', 'players.json', 'site.json']

const USAGE = `Usage: node scripts/dist-manifest.js [--out ${DEFAULT_OUT}]`
export function options(argv) {
  const chosen = {out: DEFAULT_OUT}
  for (let i = 0; i < argv.length; i++) {
    const split = argv[i].indexOf('=')
    const name = split === -1 ? argv[i] : argv[i].slice(0, split)
    if (name !== '--out') throw Error(`Unknown option ${name}. ${USAGE}`)
    const value = split === -1 ? argv[++i] : argv[i].slice(split + 1)
    if (!value) throw Error(`${name} needs a path. ${USAGE}`)
    chosen.out = value
  }
  return chosen
}

const walk = folder => readdirSync(folder).flatMap(name => {
  const path = join(folder, name)
  return statSync(path).isDirectory() ? walk(path) : [path]
})

// Paths are written with forward slashes whatever generated them, since they are URLs on the host.
export function distManifest(folder = 'dist') {
  const names = walk(folder).map(path => relative(folder, path).split(sep).join('/')).filter(name => !GENERATED.includes(name)).sort()
  if (!names.includes('index.html')) throw Error(`${folder} holds no index.html, so it is not the app folder.`)
  return {
    shared: names.filter(name => !SERVICE_ONLY.includes(name)),
    service: names.filter(name => SERVICE_ONLY.includes(name))
  }
}

export function manifestText(folder = 'dist') {
  return JSON.stringify(distManifest(folder), null, 2) + '\n'
}

// Returns whether anything changed, so a build can tell a stale committed file from an up to date one.
export function writeManifest(folder = 'dist', out = DEFAULT_OUT) {
  const path = resolve(out)
  const body = manifestText(folder)
  let before = null
  try { before = readFileSync(path, 'utf8') } catch {}
  if (before !== body) writeFileSync(path, body)
  return {path, changed: before !== body, ...distManifest(folder)}
}

function main(argv) {
  const result = writeManifest('dist', options(argv).out)
  console.log(`${result.path}: ${result.shared.length} shared, ${result.service.length} service only${result.changed ? '' : ', already up to date'}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}

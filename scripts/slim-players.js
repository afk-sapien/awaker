// Sleeper's player directory is about 15 MB of everyone who ever played, and a browser-only
// visitor downloads all of it before the first page is drawn. The service already reduces it to
// the handful of fields the dashboard reads, and this writes that same subset to disk so a
// self-hoster can serve roughly 500 KB, near 70 KB compressed, from their own origin instead.
//
// Usage: node scripts/slim-players.js [--out dist/players.json] [--from directory.json]
//
// The dashboard only trusts the file while it is as fresh as a live fetch would have been, so run
// this on a daily schedule. Without --from the current directory is fetched from Sleeper.
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {gzipSync} from 'node:zlib'
import {pathToFileURL} from 'node:url'
import {playerFile, slimPlayers} from '../server/provider.js'
import * as api from '../dist/api.js'

export const DEFAULT_OUT = 'dist/players.json'

const USAGE = `Usage: node scripts/slim-players.js [--out ${DEFAULT_OUT}] [--from directory.json]`
export function options(argv) {
  const chosen = {out: DEFAULT_OUT, from: null}
  for (let i = 0; i < argv.length; i++) {
    const split = argv[i].indexOf('=')
    const name = split === -1 ? argv[i] : argv[i].slice(0, split)
    if (!['--out', '--from'].includes(name)) throw Error(`Unknown option ${name}. ${USAGE}`)
    const value = split === -1 ? argv[++i] : argv[i].slice(split + 1)
    if (!value) throw Error(`${name} needs a path. ${USAGE}`)
    chosen[name.slice(2)] = value
  }
  return chosen
}

// The generated time is what the dashboard checks before using the file, so it travels with it.
export function slimFile(directory, now = Date.now()) {
  if (!directory || typeof directory !== 'object' || Array.isArray(directory)) throw Error('The player directory must be an object keyed by player id.')
  const file = playerFile(slimPlayers(directory), now)
  if (!file.count) throw Error('No fantasy players were found in that directory.')
  return file
}

export function writeSlimPlayers(directory, out = DEFAULT_OUT, now = Date.now()) {
  const file = slimFile(directory, now)
  const body = JSON.stringify(file)
  const path = resolve(out)
  mkdirSync(dirname(path), {recursive: true})
  writeFileSync(path, body)
  return {path, count: file.count, generatedAt: file.generatedAt, bytes: Buffer.byteLength(body), gzipBytes: gzipSync(Buffer.from(body), {level: 6}).length}
}

// Fetching the directory and writing the file is the whole job, so anything that generates the file
// as part of a larger build calls this and reads the numbers back, rather than spawning this script
// and parsing what it prints.
export async function buildPlayersFile({out = DEFAULT_OUT, from = null} = {}) {
  const directory = from ? JSON.parse(readFileSync(resolve(from), 'utf8')) : await api.loadPlayers()
  return writeSlimPlayers(directory, out)
}

async function main(argv) {
  const result = await buildPlayersFile(options(argv))
  const kb = n => `${(n / 1024).toFixed(0)} KB`
  console.log(`${result.path}: ${result.count} players, ${kb(result.bytes)} (${kb(result.gzipBytes)} gzipped)`)
  console.log('Serve it beside index.html and regenerate it daily, or the dashboard fetches the full directory instead.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(process.argv.slice(2)) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}

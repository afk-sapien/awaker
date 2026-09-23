import {readdirSync, readFileSync, existsSync, statSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {dirname, join, relative, resolve} from 'node:path'
import {pathToFileURL} from 'node:url'

const files = folder => readdirSync(folder).flatMap(name => statSync(join(folder, name)).isDirectory() ? files(join(folder, name)) : [join(folder, name)])
const scripts = ['dist', 'server', 'scripts', 'tests'].flatMap(files).filter(name => name.endsWith('.js'))
for (const file of scripts) {
  const result = spawnSync(process.execPath, ['--check', file], {stdio: 'inherit'})
  if (result.status !== 0) process.exit(result.status || 1)
}

// A browser treats './engine.js' and './engine.js?v=2' as two modules, so each file would load (and keep state) twice.
// Imports are compared by the file they resolve to, since ui/ modules reach the engines through '../'.
const urls = new Map(), problems = []
const specifiers = source => [...source.matchAll(/(?:\bimport|\bexport)\s*(?:[\w*{}\s,$]*?\s*from\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g)].map(m => m[1] || m[2])
const modules = files('dist').filter(name => name.endsWith('.js'))
for (const file of modules) {
  for (const spec of specifiers(readFileSync(file, 'utf8'))) {
    if (!spec.startsWith('.') && !spec.startsWith('/')) continue
    if (/[?#]/.test(spec)) problems.push(`${file} imports ${spec} with a query string`)
    const target = relative('dist', spec.startsWith('/') ? join('dist', spec) : resolve(dirname(file), spec.replace(/[?#].*$/, '')))
    if (!existsSync(join('dist', target))) problems.push(`${file} imports ${spec}, which does not exist`)
    if (!urls.has(target)) urls.set(target, new Set())
    urls.get(target).add(spec.match(/[?#].*$/)?.[0] || '')
  }
}
for (const name of readdirSync('dist').filter(name => name.endsWith('.html'))) {
  for (const m of readFileSync(`dist/${name}`, 'utf8').matchAll(/(?:src|href)="(\/[^"?#]+\.(?:js|css))[?#][^"]*"/g)) problems.push(`dist/${name} loads ${m[1]} with a query string`)
}
for (const [file, suffixes] of urls) if (suffixes.size > 1) problems.push(`${file} is imported under ${suffixes.size} different URLs`)

// A named import that nothing exports only fails once a browser loads the page, so every module the
// dashboard is built from is linked here. The entry points run on load and need a browser, so they are skipped.
const entries = new Set(['dist/app.js', 'dist/boot.js', 'dist/integrations.js'])
for (const file of modules.filter(file => !entries.has(file))) {
  try { await import(pathToFileURL(resolve(file))) }
  catch (error) { if (error instanceof SyntaxError) problems.push(`${file}: ${error.message}`) }
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1) }
console.log('JavaScript syntax, import and link checks passed.')

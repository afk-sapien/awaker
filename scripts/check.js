import {readdirSync, readFileSync, existsSync, statSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {dirname, join, relative, resolve} from 'node:path'
import {pathToFileURL} from 'node:url'

const files = folder => readdirSync(folder).flatMap(name => statSync(join(folder, name)).isDirectory() ? files(join(folder, name)) : [join(folder, name)])
const specifiers = source => [...source.matchAll(/(?:\bimport|\bexport)\s*(?:[\w*{}\s,$]*?\s*from\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g)].map(m => m[1] || m[2])

// The three tiers of docs/core-split.md, written down here so that crossing one fails the build
// instead of being noticed months later. Tier 3, the dashboard, is dist/ui/ plus the entry points:
// it touches the DOM. Tier 1, the core, is every other module in dist/, which is why server/ can
// import the engines under Node and a browser can load the same files unchanged. Tier 2 is
// server/ and scripts/, which are Node only and are never served.
export const DASHBOARD_MODULES = ['app.js', 'boot.js', 'integrations.js']
const dashboard = path => DASHBOARD_MODULES.includes(path) || path.startsWith('ui/')

// Where an import specifier lands, as a dist-relative path, or null when it names no file at all.
export function distTarget(file, spec) {
  if (!spec.startsWith('.') && !spec.startsWith('/')) return null
  return relative('dist', spec.startsWith('/') ? join('dist', spec) : resolve(dirname(file), spec.replace(/[?#].*$/, '')))
}

// from and target are dist-relative. Two rules, both about what a browser can do: everything dist/
// imports has to be in dist/, since nothing else is served and there are no dependencies to resolve
// a bare name against, and the core may not import the dashboard, so importing an engine from
// server/ cannot drag the DOM in behind it.
export function tierProblem(from, spec, target) {
  if (target === null) return `imports ${spec}, and dist/ has no dependencies for a browser to resolve a bare specifier against`
  if (target.startsWith('..')) return `imports ${spec}, which is outside dist/ and is not served to the browser`
  if (!dashboard(from) && dashboard(target)) return `is core and must not import the dashboard module ${spec}`
  return null
}

// The service may import the core but not the dashboard. Nothing stops it today beyond the fact
// that a ui/ module would throw on document, which is a late and confusing way to find out.
export function serviceProblem(file, spec) {
  const target = distTarget(file, spec)
  if (target === null || target.startsWith('..') || !dashboard(target)) return null
  return `is the service and must not import the dashboard module ${spec}`
}

async function main() {
  const scripts = ['dist', 'server', 'scripts', 'tests'].flatMap(files).filter(name => name.endsWith('.js'))
  for (const file of scripts) {
    const result = spawnSync(process.execPath, ['--check', file], {stdio: 'inherit'})
    if (result.status !== 0) process.exit(result.status || 1)
  }

  // A browser treats './engine.js' and './engine.js?v=2' as two modules, so each file would load (and keep state) twice.
  // Imports are compared by the file they resolve to, since ui/ modules reach the engines through '../'.
  const urls = new Map(), problems = []
  const modules = files('dist').filter(name => name.endsWith('.js'))
  for (const file of modules) {
    const from = relative('dist', file)
    for (const spec of specifiers(readFileSync(file, 'utf8'))) {
      const target = distTarget(file, spec)
      const tier = tierProblem(from, spec, target)
      if (tier) problems.push(`${file} ${tier}`)
      if (target === null || target.startsWith('..')) continue
      if (/[?#]/.test(spec)) problems.push(`${file} imports ${spec} with a query string`)
      if (!existsSync(join('dist', target))) problems.push(`${file} imports ${spec}, which does not exist`)
      if (!urls.has(target)) urls.set(target, new Set())
      urls.get(target).add(spec.match(/[?#].*$/)?.[0] || '')
    }
  }
  for (const file of ['server', 'scripts'].flatMap(files).filter(name => name.endsWith('.js'))) {
    for (const spec of specifiers(readFileSync(file, 'utf8'))) {
      const problem = serviceProblem(file, spec)
      if (problem) problems.push(`${file} ${problem}`)
    }
  }
  for (const name of readdirSync('dist').filter(name => name.endsWith('.html'))) {
    for (const m of readFileSync(`dist/${name}`, 'utf8').matchAll(/(?:src|href)="(\/[^"?#]+\.(?:js|css))[?#][^"]*"/g)) problems.push(`dist/${name} loads ${m[1]} with a query string`)
  }
  for (const [file, suffixes] of urls) if (suffixes.size > 1) problems.push(`${file} is imported under ${suffixes.size} different URLs`)

  // A named import that nothing exports only fails once a browser loads the page, so every module the
  // dashboard is built from is linked and run here. Modules only define things when loaded, so any error is a
  // real one: a missing export, or a value used before a circular import has defined it. The entry points
  // run on load and need a browser, so they are skipped.
  const entries = new Set(DASHBOARD_MODULES.map(name => `dist/${name}`))
  for (const file of modules.filter(file => !entries.has(file))) {
    try { await import(pathToFileURL(resolve(file))) }
    catch (error) { problems.push(`${file}: ${error.message}`) }
  }
  if (problems.length) { console.error(problems.join('\n')); process.exit(1) }
  console.log('JavaScript syntax, import, tier and link checks passed.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()

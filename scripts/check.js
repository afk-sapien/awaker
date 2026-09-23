import {readdirSync, readFileSync} from 'node:fs'
import {spawnSync} from 'node:child_process'

for (const folder of ['dist', 'server', 'scripts', 'tests']) {
  for (const name of readdirSync(folder).filter(name => name.endsWith('.js'))) {
    const result = spawnSync(process.execPath, ['--check', `${folder}/${name}`], {stdio: 'inherit'})
    if (result.status !== 0) process.exit(result.status || 1)
  }
}

// A browser treats './engine.js' and './engine.js?v=2' as two modules, so each file would load (and keep state) twice.
const urls = new Map(), problems = []
const specifiers = source => [...source.matchAll(/(?:\bimport|\bexport)\s*(?:[\w*{}\s,$]*?\s*from\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g)].map(m => m[1] || m[2])
for (const name of readdirSync('dist').filter(name => name.endsWith('.js'))) {
  for (const spec of specifiers(readFileSync(`dist/${name}`, 'utf8'))) {
    if (!spec.startsWith('.') && !spec.startsWith('/')) continue
    if (/[?#]/.test(spec)) problems.push(`dist/${name} imports ${spec} with a query string`)
    const file = spec.replace(/[?#].*$/, '').replace(/^\.?\//, '')
    if (!urls.has(file)) urls.set(file, new Set())
    urls.get(file).add(spec)
  }
}
for (const name of readdirSync('dist').filter(name => name.endsWith('.html'))) {
  for (const m of readFileSync(`dist/${name}`, 'utf8').matchAll(/(?:src|href)="(\/[^"?#]+\.(?:js|css))[?#][^"]*"/g)) problems.push(`dist/${name} loads ${m[1]} with a query string`)
}
for (const [file, specs] of urls) if (specs.size > 1) problems.push(`${file} is imported under ${specs.size} different URLs: ${[...specs].join(', ')}`)
if (problems.length) { console.error(problems.join('\n')); process.exit(1) }
console.log('JavaScript syntax checks passed.')

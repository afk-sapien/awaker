import test from 'node:test'
import assert from 'node:assert/strict'
import {readdirSync} from 'node:fs'
import {DASHBOARD_MODULES, distTarget, serviceProblem, tierProblem} from '../scripts/check.js'

// Tier 1 as docs/core-split.md names it. The list is here as well as in the document so that adding
// a module to dist/ without deciding which tier it belongs to fails rather than passing quietly.
const CORE_MODULES = ['analysis.js', 'api.js', 'cache.js', 'defenses.js', 'demo.js', 'engine.js', 'league.js', 'lineup.js', 'network.js', 'scouting.js', 'season.js', 'themes.js', 'trades.js', 'waivers.js']

const problem = (from, spec) => tierProblem(from, spec, distTarget(`dist/${from}`, spec))

test('the core and the dashboard are exactly the modules the tier document names',() => {
 const shipped = readdirSync('dist').filter(name => name.endsWith('.js')).sort()
 assert.deepEqual(shipped, [...CORE_MODULES, ...DASHBOARD_MODULES].sort(), 'a new module in dist/ needs a tier in docs/core-split.md and in this list')
 for (const name of CORE_MODULES) assert.equal(problem(name, './engine.js'), null, `${name} may import the core`)
})

test('the core may not import the dashboard, in either direction of travel',() => {
 assert.match(problem('engine.js', './ui/render.js'), /must not import the dashboard/)
 assert.match(problem('api.js', './app.js'), /must not import the dashboard/)
 assert.match(problem('cache.js', '/ui/state.js'), /must not import the dashboard/)
 assert.equal(problem('ui/render.js', '../engine.js'), null, 'the dashboard imports the core freely')
 assert.equal(problem('ui/pages/charts.js', '../state.js'), null)
 assert.equal(problem('app.js', './ui/events.js'), null)
})

test('nothing in dist reaches outside it or names a dependency',() => {
 assert.match(problem('engine.js', '../server/provider.js'), /outside dist\//)
 assert.match(problem('ui/render.js', '../../server/http.js'), /outside dist\//)
 assert.match(problem('api.js', 'node:fs'), /bare specifier/)
 assert.match(problem('api.js', 'idb-keyval'), /bare specifier/)
})

test('the service may import the core but not the dashboard',() => {
 assert.match(serviceProblem('server/http.js', '../dist/ui/render.js'), /must not import the dashboard/)
 assert.match(serviceProblem('scripts/slim-players.js', '../dist/boot.js'), /must not import the dashboard/)
 assert.equal(serviceProblem('server/provider.js', '../dist/api.js'), null)
 assert.equal(serviceProblem('server/http.js', 'node:fs'), null, 'the service runs under Node and may use built-ins')
})

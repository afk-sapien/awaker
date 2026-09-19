import test from 'node:test'
import assert from 'node:assert/strict'
import {releaseMetadata} from '../scripts/release-metadata.js'

const repository = {full_name: 'AFK-Sapien/Awaker', default_branch: 'master'}
test('manual publication accepts only the default branch and never assigns latest', () => {
 assert.deepEqual(releaseMetadata('workflow_dispatch', {repository}, 'refs/heads/master', '0.2.0'), {
  image: 'ghcr.io/afk-sapien/awaker', version: 'edge', latest: 'false'
 })
 assert.throws(() => releaseMetadata('workflow_dispatch', {repository}, 'refs/heads/feature', '0.2.0'), /default branch/)
})
test('release publication requires matching safe versions and keeps previews away from latest', () => {
 const release = (tag_name, prerelease) => ({repository, action: 'published', release: {tag_name, prerelease}})
 assert.equal(releaseMetadata('release', release('v0.2.0', false), '', '0.2.0').latest, 'true')
 assert.equal(releaseMetadata('release', release('v0.3.0-beta.1', true), '', '0.3.0-beta.1').latest, 'false')
 assert.throws(() => releaseMetadata('release', release('v0.3.0-beta.1', false), '', '0.3.0-beta.1'), /prerelease/)
 for (const tag of ['latest', 'v0.2.1', 'v0.2.0\ninjected=true', 'v0.2.0$(whoami)']) {
  assert.throws(() => releaseMetadata('release', release(tag, false), '', '0.2.0'), /match package/)
 }
 assert.throws(() => releaseMetadata('pull_request', {repository}, '', '0.2.0'), /Unsupported/)
})

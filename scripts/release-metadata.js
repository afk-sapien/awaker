import {readFileSync, appendFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'

export function releaseMetadata(eventName, event, ref, version) {
 const repository = event.repository.full_name.toLowerCase()
 if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(repository)) throw Error('Invalid repository name')
 if (eventName === 'workflow_dispatch') {
  if (ref !== `refs/heads/${event.repository.default_branch}`) throw Error('Manual publishing is allowed only from the default branch')
  return {image: `ghcr.io/${repository}`, version: 'edge', latest: 'false'}
 }
 if (eventName !== 'release' || event.action !== 'published') throw Error('Unsupported publication event')
 const tag = event.release.tag_name
 if (!/^v\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/.test(tag) || tag !== `v${version}`) throw Error('Release tag must match package.json, for example v0.2.0 or v0.3.0-beta.1')
 if (tag.includes('-') && !event.release.prerelease) throw Error('Mark preview versions as a GitHub prerelease')
 return {image: `ghcr.io/${repository}`, version: tag.slice(1), latest: String(!event.release.prerelease)}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
 const {version} = JSON.parse(readFileSync('package.json', 'utf8'))
 const values = releaseMetadata(process.env.GITHUB_EVENT_NAME, event, process.env.GITHUB_REF, version)
 execFileSync('git', ['merge-base', '--is-ancestor', 'HEAD', `origin/${event.repository.default_branch}`])
 for (const [key, value] of Object.entries(values)) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`)
}

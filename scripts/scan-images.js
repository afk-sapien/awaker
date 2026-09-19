import {execFileSync, spawnSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, readFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'

const scanner = 'aquasec/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969'
const folder = mkdtempSync(join(tmpdir(), 'awaker-scan-'))
const reports = resolve('release/security')
mkdirSync(reports, {recursive: true})
const user = process.getuid ? ['--user', `${process.getuid()}:${process.getgid()}`] : []
try {
 for (const mode of ['static', 'service']) {
  const archive = join(folder, `${mode}.tar`)
  execFileSync('docker', ['save', `awaker-smoke:${mode}`, '-o', archive], {stdio: 'inherit'})
  const scan = spawnSync('docker', ['run', '--rm', ...user, '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
   '-e', 'TMPDIR=/scan', '-v', `${folder}:/scan`, '-v', `${reports}:/reports`, scanner, 'image',
   '--cache-dir', '/scan/cache', '--input', `/scan/${mode}.tar`, '--scanners', 'vuln',
   '--format', 'json', '--output', `/reports/${mode}.json`, '--quiet'], {stdio: 'inherit'})
  if (scan.error || scan.status !== 0) throw Error(`Could not scan ${mode} image`)
  const report = JSON.parse(readFileSync(join(reports, `${mode}.json`), 'utf8'))
  const findings = (report.Results || []).flatMap(result => result.Vulnerabilities || [])
  const blocking = findings.filter(item => ['HIGH', 'CRITICAL'].includes(item.Severity))
  console.log(`${mode}: ${findings.length} known vulnerabilities, ${blocking.length} HIGH or CRITICAL`)
  for (const item of findings) console.log(`${item.Severity}: ${item.VulnerabilityID} in ${item.PkgName} ${item.InstalledVersion}`)
  if (blocking.length) process.exitCode = 1
  rmSync(archive)
 }
} finally { rmSync(folder, {recursive: true, force: true}) }

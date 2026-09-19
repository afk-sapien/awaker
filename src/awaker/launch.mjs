import {existsSync} from 'node:fs'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'

const [command, root, directory, envFile, serialized] = process.argv.slice(2)
if (existsSync(envFile)) process.loadEnvFile(envFile)
const overrides = JSON.parse(serialized)
Object.assign(process.env, overrides)
if (!process.env.AWAKER_DB && !process.env.SUNDAY_DB) {
  process.env.AWAKER_DB = resolve(directory, 'awaker.sqlite')
}
if (overrides.PORT && !overrides.AWAKER_PUBLIC_URL) {
  process.env.AWAKER_PUBLIC_URL = `http://127.0.0.1:${overrides.PORT}`
}
const entry = {serve: 'preview.js', service: 'main.js', mcp: 'mcp.js'}[command]
if (!entry) throw Error('Unknown Awaker command')
const module = await import(pathToFileURL(resolve(root, 'server', entry)))
if (command === 'mcp') await module.runMcp()

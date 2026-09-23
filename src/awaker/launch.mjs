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
// --port fills in a missing browser URL. One already set in the environment or the env file is
// kept, since it is usually a reverse proxy's address. For mcp, --port names the local service to call.
if (overrides.PORT) {
  const local = `http://127.0.0.1:${overrides.PORT}`
  if (command === 'mcp') process.env.AWAKER_API_URL = local
  else if (!process.env.AWAKER_PUBLIC_URL && !process.env.SUNDAY_PUBLIC_URL) process.env.AWAKER_PUBLIC_URL = local
}
// The adapter only needs the agent token, so the owner token never reaches it.
if (command === 'mcp') {
  delete process.env.AWAKER_ADMIN_TOKEN
  delete process.env.SUNDAY_ADMIN_TOKEN
}
const entry = {serve: 'start.js', service: 'main.js', mcp: 'mcp.js'}[command]
if (!entry) throw Error('Unknown Awaker command')
const module = await import(pathToFileURL(resolve(root, 'server', entry)))
if (command === 'mcp') await module.runMcp()

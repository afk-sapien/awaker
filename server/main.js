import {resolve, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {openStore} from './store.js'
import {createProvider} from './provider.js'
import {createService} from './service.js'
import {createWorker} from './scheduler.js'
import {createNtfy} from './ntfy.js'
import {createHttpServer} from './http.js'
import {config} from './config.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const settings = config(process.env, root)
const store = openStore(settings.db)
const stored = store.get('settings', {}).username
if (!settings.username) {
  console.error('Set SLEEPER_USERNAME to the Sleeper account this service reports on, then start it again.')
  console.error(stored ? `This installation previously used "${stored}", so SLEEPER_USERNAME=${stored} keeps its history.`
    : 'Pass it in the environment, in .env, or with awaker service --username YOUR_SLEEPER_NAME.')
  store.close()
  process.exit(1)
}
const service = createService({store, provider: createProvider(store), username: settings.username})
const ntfy = createNtfy({store})
if (!process.env.NTFY_TOPIC && (process.env.NTFY_URL || process.env.NTFY_TOKEN)) {
  console.log('NTFY_URL and NTFY_TOKEN are ignored without NTFY_TOPIC. Add the topic, or set notifications up in Notifications.')
}
const worker = createWorker({store, service, ntfy, publicUrl: settings.publicUrl})
const server = createHttpServer({...settings, service, worker, ntfy, dist: resolve(root, 'dist')})
let activeTick = Promise.resolve()
let ticking = false
const tick = () => {
  if (ticking) return
  ticking = true
  // tick() reports its own failures. This only guards the reporting itself, such as a full disk.
  activeTick = worker.tick().catch(error => console.error('Background run could not record its result:', error?.message || error)).finally(() => { ticking = false })
}
const interval = setInterval(tick, 60000)
server.listen(settings.port, settings.host, () => {
  console.log(`Awaker service: ${settings.publicUrl}/integrations.html`)
  if (!settings.adminToken && !settings.agentToken) {
    console.log('No owner token is set, so anyone who can reach this address can view and change its settings.')
    console.log('That suits a personal machine or a trusted network. Run awaker setup to add tokens before exposing it more widely.')
  }
  tick()
})
let stopping = false
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (stopping) return
  stopping = true
  clearInterval(interval)
  const deadline = setTimeout(() => process.exit(1), 10000)
  deadline.unref()
  server.close(async () => {
    await activeTick
    store.close()
    clearTimeout(deadline)
  })
})

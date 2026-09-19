import {resolve, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {openStore} from './store.js'
import {createProvider} from './provider.js'
import {createService} from './service.js'
import {createWorker} from './scheduler.js'
import {ntfyPublisher} from './ntfy.js'
import {createHttpServer} from './http.js'
import {config} from './config.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const settings = config(process.env, root)
const store = openStore(settings.db)
const service = createService({store, provider: createProvider(store)})
if (process.env.SLEEPER_USERNAME && !service.settings().username) service.saveSettings({username: process.env.SLEEPER_USERNAME})
const publish = ntfyPublisher()
const worker = createWorker({store, service, publish, publicUrl: settings.publicUrl})
const server = createHttpServer({...settings, service, worker, publish, dist: resolve(root, 'dist')})
let activeTick = Promise.resolve()
let ticking = false
const tick = () => {
  if (ticking) return
  ticking = true
  activeTick = worker.tick().finally(() => { ticking = false })
}
const interval = setInterval(tick, 60000)
server.listen(settings.port, settings.host, () => {
  console.log(`Awaker service: ${settings.publicUrl}/integrations.html`)
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

import {createServer} from 'node:http'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {config} from './config.js'
import {json, serveStatic} from './static.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const {host, port, publicUrl} = config()
const server = createServer(async (req, res) => {
  try {
    if (req.headers.host !== new URL(publicUrl).host) return json(res, 403, {error: 'Unrecognized host.'})
    await serveStatic(req, res, resolve(root, 'dist'), new URL(req.url, publicUrl).pathname)
  } catch (error) {
    json(res, error.status || 500, {error: error.status ? error.message : 'Request failed.'})
  }
})
server.requestTimeout = 30000
server.headersTimeout = 15000
server.listen(port, host, () => console.log(`Awaker dashboard: ${publicUrl}`))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close())

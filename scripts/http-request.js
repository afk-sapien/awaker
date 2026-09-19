import {request} from 'node:http'

// Native fetch controls Host itself. Health probes need the configured public Host.
export function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, {method: options.method || 'GET', headers: options.headers, signal: options.signal, timeout: 10000}, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('error', reject)
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        resolve({
          status: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          headers: new Headers(Object.entries(res.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value])),
          text: async () => body,
          json: async () => JSON.parse(body)
        })
      })
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(Error('Request timed out')))
    req.end(options.body)
  })
}

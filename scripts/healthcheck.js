import {httpRequest} from './http-request.js'
const publicUrl = process.env.AWAKER_PUBLIC_URL || process.env.SUNDAY_PUBLIC_URL || 'http://127.0.0.1:4173'
try {
  const response = await httpRequest(`http://127.0.0.1:${process.env.PORT || 4173}/healthz`, {
    headers: {Host: new URL(publicUrl).host},
    signal: AbortSignal.timeout(3000)
  })
  if (!response.ok || (await response.json()).status !== 'ok') process.exitCode = 1
} catch { process.exitCode = 1 }

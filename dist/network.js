// Limit decoded bytes too, including compressed and chunked provider responses.
export async function readJsonResponse(response, maxBytes = 32 * 1024 * 1024) {
 if (Number(response.headers.get('content-length')) > maxBytes) {
  await response.body?.cancel()
  throw Error('Data service response is too large.')
 }
 if (!response.body) throw Error('Data service returned an empty response.')
 const reader = response.body.getReader()
 const decoder = new TextDecoder()
 const parts = []
 let size = 0
 try {
  while (true) {
   const {done, value} = await reader.read()
   if (done) break
   size += value.byteLength
   if (size > maxBytes) throw Error('Data service response is too large.')
   parts.push(decoder.decode(value, {stream: true}))
  }
  parts.push(decoder.decode())
  return JSON.parse(parts.join(''))
 } finally {
  try { await reader.cancel() } finally { reader.releaseLock() }
 }
}

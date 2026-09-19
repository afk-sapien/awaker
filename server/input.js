// A null record represents one oversized message. Resume at the next newline.
export async function* boundedLines(input, maxBytes = 65536) {
 let pending = Buffer.alloc(0)
 let oversized = false
 for await (const value of input) {
  const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
  let start = 0
  while (start < chunk.length) {
   const end = chunk.indexOf(10, start)
   const piece = chunk.subarray(start, end < 0 ? chunk.length : end)
   if (!oversized) {
    if (pending.length + piece.length > maxBytes) {
     pending = Buffer.alloc(0)
     oversized = true
    } else pending = Buffer.concat([pending, piece])
   }
   if (end < 0) break
   yield oversized ? null : pending.toString('utf8')
   pending = Buffer.alloc(0)
   oversized = false
   start = end + 1
  }
 }
 if (oversized) yield null
 else if (pending.length) yield pending.toString('utf8')
}

import test from 'node:test'
import assert from 'node:assert/strict'
import {Readable} from 'node:stream'
import {readJsonResponse} from '../dist/network.js'
import {json} from '../dist/api.js'
import {boundedLines} from '../server/input.js'
import {validateSettings} from '../server/settings.js'
import {contracts, validate} from '../server/contracts.js'

test('settings and contracts reject inherited field names and non-string timezones', () => {
 for (const key of ['__proto__', 'constructor', 'toString']) {
  const input = JSON.parse(`{"${key}":{}}`)
  assert.throws(() => validateSettings({alerts: input}), /Unknown alert/)
  assert.throws(() => validate(input, contracts[0].inputSchema), /Unknown input/)
 }
 for (const timezone of [null, {}, [], 12, true]) {
  assert.throws(() => validateSettings({timezone}), /Invalid timezone/)
 }
 assert.equal(validateSettings({timezone: 'UTC'}).timezone, 'UTC')
})

test('provider responses enforce size limits even without Content-Length and cancel the stream', async () => {
 let canceled = false
 const oversized = new Response(new ReadableStream({
  pull(controller) { controller.enqueue(new Uint8Array(9)) },
  cancel() { canceled = true }
 }))
 await assert.rejects(readJsonResponse(oversized, 8), /too large/)
 assert.equal(canceled, true)
 await assert.rejects(readJsonResponse(new Response('{}', {headers: {'Content-Length': '100'}}), 8), /too large/)
 const bytes = new TextEncoder().encode('{"name":"日本語 🏈"}')
 const chunks = new ReadableStream({start(controller) {
  for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
  controller.close()
 }})
 assert.deepEqual(await readJsonResponse(new Response(chunks), bytes.length), {name: '日本語 🏈'})
 await assert.rejects(readJsonResponse(new Response('{')), SyntaxError)
})

test('provider fetching allows only approved HTTPS origins and refuses redirects', async t => {
 let calls = 0
 t.mock.method(globalThis, 'fetch', async (url, options) => {
  calls++
  assert.equal(url, 'https://api.sleeper.app/v1/state/nfl')
  assert.equal(options.redirect, 'error')
  assert.equal(options.credentials, 'omit')
  return Response.json({week: 2})
 })
 for (const url of ['http://api.sleeper.app/x', 'https://api.sleeper.app.evil.test/x', 'https://user:pass@api.sleeper.app/x', 'http://127.0.0.1/x', 'https://evil.test/x']) {
  await assert.rejects(json(url), /Unrecognized data provider/)
 }
 assert.equal(calls, 0)
 assert.deepEqual(await json('https://api.sleeper.app/v1/state/nfl'), {week: 2})
 assert.equal(calls, 1)
})

test('MCP input discards oversized records, resumes parsing, and handles split UTF-8 and EOF', async () => {
 const bytes = Buffer.from('"🏈"')
 const input = Readable.from([Buffer.alloc(65536, 120), Buffer.from('x'), Buffer.from('\n{"ok":true}\r\n'), bytes.subarray(0, 3), bytes.subarray(3)])
 const records = []
 for await (const line of boundedLines(input)) records.push(line)
 assert.deepEqual(records, [null, '{"ok":true}\r', '"🏈"'])
 const atLimit = []
 for await (const line of boundedLines(Readable.from(['1234\n12345']), 4)) atLimit.push(line)
 assert.deepEqual(atLimit, ['1234', null])
})

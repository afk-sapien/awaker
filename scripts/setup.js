import {randomBytes} from 'node:crypto'
import {writeFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = resolve(root, '.env')
const token = () => randomBytes(32).toString('hex')
try {
  writeFileSync(target, `AWAKER_ADMIN_TOKEN=${token()}\nAWAKER_AGENT_TOKEN=${token()}\nAWAKER_HOST=127.0.0.1\nPORT=4173\nAWAKER_PUBLIC_URL=http://127.0.0.1:4173\nAWAKER_API_URL=http://127.0.0.1:4173\n`, {flag: 'wx', mode: 0o600})
  console.log('Created .env with distinct owner and agent tokens. Run npm run service, then sign in at http://127.0.0.1:4173/integrations.html using AWAKER_ADMIN_TOKEN from .env.')
} catch (error) {
  if (error.code !== 'EEXIST') throw error
  console.error('.env already exists. Existing settings and tokens were kept.')
  process.exitCode = 1
}

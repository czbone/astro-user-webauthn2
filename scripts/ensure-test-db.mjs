import 'dotenv/config'
import fs from 'node:fs'
import pg from 'pg'

const src = process.env.DATABASE_URL
if (!src) {
  throw new Error('DATABASE_URL is not set')
}

const testDb = 'astro_webauthn_test'
const url = new URL(src)
url.pathname = `/${testDb}`
const testUrl = url.toString()

const envPath = '.env'
let env = fs.readFileSync(envPath, 'utf8')
if (!/^TEST_DATABASE_URL=/m.test(env)) {
  if (!env.endsWith('\n')) env += '\n'
  fs.writeFileSync(envPath, `${env}TEST_DATABASE_URL="${testUrl}"\n`)
  console.log('Appended TEST_DATABASE_URL to .env')
} else {
  console.log('TEST_DATABASE_URL already present in .env')
}

const admin = new URL(src)
admin.pathname = '/postgres'
const client = new pg.Client({ connectionString: admin.toString() })
await client.connect()
const result = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [testDb])
if ((result.rowCount ?? 0) === 0) {
  await client.query(`CREATE DATABASE "${testDb}"`)
  console.log(`Created database ${testDb}`)
} else {
  console.log(`Database ${testDb} already exists`)
}
await client.end()

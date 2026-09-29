import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const compiled = join(root, 'dist', 'seed.mjs')
const source = join(root, 'prisma', 'seed.ts')

const result = existsSync(compiled)
  ? spawnSync(process.execPath, [compiled], { cwd: root, stdio: 'inherit' })
  : spawnSync(process.execPath, ['--import', 'tsx', source], {
      cwd: root,
      stdio: 'inherit'
    })

if (result.error) {
  console.error(result.error)
  process.exit(1)
}

process.exit(result.status ?? 1)

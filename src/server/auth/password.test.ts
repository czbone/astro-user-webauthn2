import { describe, expect, it } from 'vitest'
import { generateTemporaryPassword, hashPassword, verifyPassword } from '@/server/auth/password'

describe('password', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('correct-horse')
    expect(hash.startsWith('scrypt$')).toBe(true)
    await expect(verifyPassword('correct-horse', hash)).resolves.toBe(true)
  })

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('correct-horse')
    await expect(verifyPassword('wrong-password', hash)).resolves.toBe(false)
  })

  it('rejects a malformed hash', async () => {
    await expect(verifyPassword('anything', 'not-a-valid-hash')).resolves.toBe(false)
  })

  it('generates a temporary password of the requested length', () => {
    expect(generateTemporaryPassword(24)).toHaveLength(24)
  })
})

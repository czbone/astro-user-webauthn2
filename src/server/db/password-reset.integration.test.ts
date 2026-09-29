import { beforeEach, describe, expect, it } from 'vitest'
import { generateToken, hashToken } from '@/server/auth/tokens'
import PasswordResetDB from '@/server/db/password-reset'
import { createTestUser, resetDatabase } from '@/test/db'

describe('PasswordResetDB', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('creates and finds a valid reset token', async () => {
    const { user } = await createTestUser()
    const token = generateToken()
    const created = await PasswordResetDB.create(
      user.id,
      hashToken(token),
      new Date(Date.now() + 60_000)
    )

    const found = await PasswordResetDB.findValidByTokenHash(hashToken(token))
    expect(found).toMatchObject({
      id: created.id,
      userId: user.id
    })
    expect(await PasswordResetDB.countForUser(user.id)).toBe(1)
  })

  it('marks reset token as used', async () => {
    const { user } = await createTestUser()
    const token = generateToken()
    const tokenHash = hashToken(token)
    await PasswordResetDB.create(user.id, tokenHash, new Date(Date.now() + 60_000))

    await PasswordResetDB.markUsed(tokenHash)
    expect(await PasswordResetDB.findValidByTokenHash(tokenHash)).toBeNull()
    expect(await PasswordResetDB.countForUser(user.id)).toBe(0)
  })

  it('invalidates pending reset tokens for a user', async () => {
    const { user } = await createTestUser()
    const a = generateToken()
    const b = generateToken()
    await PasswordResetDB.create(user.id, hashToken(a), new Date(Date.now() + 60_000))
    await PasswordResetDB.create(user.id, hashToken(b), new Date(Date.now() + 60_000))

    await PasswordResetDB.invalidatePendingForUser(user.id)
    expect(await PasswordResetDB.findValidByTokenHash(hashToken(a))).toBeNull()
    expect(await PasswordResetDB.findValidByTokenHash(hashToken(b))).toBeNull()
    expect(await PasswordResetDB.countForUser(user.id)).toBe(0)
  })
})

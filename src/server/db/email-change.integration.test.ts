import { beforeEach, describe, expect, it } from 'vitest'
import { generateToken, hashToken } from '@/server/auth/tokens'
import EmailChangeDB from '@/server/db/email-change'
import { createTestUser, resetDatabase } from '@/test/db'

describe('EmailChangeDB', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('marks a change received without deleting it', async () => {
    const { user } = await createTestUser()
    const token = generateToken()
    const tokenHash = hashToken(token)
    await EmailChangeDB.create(
      user.id,
      'next@example.com',
      tokenHash,
      new Date(Date.now() + 60_000)
    )

    const verified = await EmailChangeDB.markVerified(tokenHash)
    expect(verified?.verifiedAt).toEqual(expect.any(String))
    expect(await EmailChangeDB.findByEmail('next@example.com')).toMatchObject({
      userId: user.id,
      verifiedAt: verified?.verifiedAt
    })
    expect((await EmailChangeDB.markVerified(tokenHash))?.verifiedAt).toBe(verified?.verifiedAt)
  })

  it('invalidates the address hold', async () => {
    const { user } = await createTestUser()
    const token = generateToken()
    await EmailChangeDB.create(
      user.id,
      'next@example.com',
      hashToken(token),
      new Date(Date.now() + 60_000)
    )

    await EmailChangeDB.invalidatePendingForUser(user.id)
    expect(await EmailChangeDB.findByEmail('next@example.com')).toBeNull()
    expect(await EmailChangeDB.findForUser(user.id)).toBeNull()
    expect(await EmailChangeDB.list()).toEqual([])
  })
})

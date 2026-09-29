import { beforeEach, describe, expect, it } from 'vitest'
import { generateToken, hashToken } from '@/server/auth/tokens'
import InviteDB from '@/server/db/invite'
import { createTestUser, resetDatabase } from '@/test/db'

describe('InviteDB', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('creates and finds a valid invite', async () => {
    const { user } = await createTestUser()
    const token = generateToken()
    const created = await InviteDB.create(user.id, hashToken(token), new Date(Date.now() + 60_000))

    const found = await InviteDB.findValidByTokenHash(hashToken(token))
    expect(found).toMatchObject({
      id: created.id,
      userId: user.id
    })
  })

  it('marks invite as used', async () => {
    const { user } = await createTestUser()
    const token = generateToken()
    const tokenHash = hashToken(token)
    await InviteDB.create(user.id, tokenHash, new Date(Date.now() + 60_000))

    await InviteDB.markUsed(tokenHash)
    expect(await InviteDB.findValidByTokenHash(tokenHash)).toBeNull()
  })

  it('invalidates pending invites for a user', async () => {
    const { user } = await createTestUser()
    const a = generateToken()
    const b = generateToken()
    await InviteDB.create(user.id, hashToken(a), new Date(Date.now() + 60_000))
    await InviteDB.create(user.id, hashToken(b), new Date(Date.now() + 60_000))

    await InviteDB.invalidatePendingForUser(user.id)
    expect(await InviteDB.findValidByTokenHash(hashToken(a))).toBeNull()
    expect(await InviteDB.findValidByTokenHash(hashToken(b))).toBeNull()
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { generateToken, hashToken } from '@/server/auth/tokens'
import MagicLinkDB from '@/server/db/magic-link'
import { createTestUser, resetDatabase } from '@/test/db'

describe('MagicLinkDB', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('creates and finds a valid magic link token', async () => {
    const { user } = await createTestUser()
    const token = generateToken()
    const created = await MagicLinkDB.create(
      user.id,
      hashToken(token),
      new Date(Date.now() + 60_000)
    )

    const found = await MagicLinkDB.findValidByTokenHash(hashToken(token))
    expect(found).toMatchObject({
      id: created.id,
      userId: user.id
    })
    expect(await MagicLinkDB.countForUser(user.id)).toBe(1)
  })

  it('consumes a token once', async () => {
    const { user } = await createTestUser()
    const token = generateToken()
    const tokenHash = hashToken(token)
    await MagicLinkDB.create(user.id, tokenHash, new Date(Date.now() + 60_000))

    const consumed = await MagicLinkDB.consume(tokenHash)
    expect(consumed).toMatchObject({ userId: user.id })
    expect(await MagicLinkDB.findValidByTokenHash(tokenHash)).toBeNull()
    expect(await MagicLinkDB.consume(tokenHash)).toBeNull()
    expect(await MagicLinkDB.countForUser(user.id)).toBe(0)
  })

  it('invalidates pending magic link tokens for a user', async () => {
    const { user } = await createTestUser()
    const a = generateToken()
    const b = generateToken()
    await MagicLinkDB.create(user.id, hashToken(a), new Date(Date.now() + 60_000))
    await MagicLinkDB.create(user.id, hashToken(b), new Date(Date.now() + 60_000))

    await MagicLinkDB.invalidatePendingForUser(user.id)
    expect(await MagicLinkDB.findValidByTokenHash(hashToken(a))).toBeNull()
    expect(await MagicLinkDB.findValidByTokenHash(hashToken(b))).toBeNull()
    expect(await MagicLinkDB.countForUser(user.id)).toBe(0)
  })
})

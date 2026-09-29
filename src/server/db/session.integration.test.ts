import { beforeEach, describe, expect, it } from 'vitest'
import { redis } from '@/lib/redis'
import { authEnv } from '@/server/auth/env'
import { generateToken, hashToken } from '@/server/auth/tokens'
import SessionDB from '@/server/db/session'
import { RedisKeys } from '@/server/redis/keys'
import { createTestUser, resetDatabase } from '@/test/db'

describe('SessionDB', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('creates and finds a valid session', async () => {
    const { user } = await createTestUser()
    const token = generateToken()
    const created = await SessionDB.create(authEnv.appId(), user.id, hashToken(token))

    const found = await SessionDB.findValid(authEnv.appId(), hashToken(token))
    expect(found).toMatchObject({
      id: created.id,
      userId: user.id
    })
  })

  it('touches session TTL', async () => {
    const { user } = await createTestUser()
    const token = generateToken()
    const tokenHash = hashToken(token)
    await SessionDB.create(authEnv.appId(), user.id, tokenHash)

    const key = RedisKeys.session(authEnv.appId(), tokenHash)
    await redis.expire(key, 90)
    const before = await redis.ttl(key)

    await SessionDB.touch(authEnv.appId(), tokenHash, user.id)
    const after = await redis.ttl(key)
    expect(after).toBeGreaterThan(before)
  })

  it('revokes a single session', async () => {
    const { user } = await createTestUser()
    const a = generateToken()
    const b = generateToken()
    await SessionDB.create(authEnv.appId(), user.id, hashToken(a))
    await SessionDB.create(authEnv.appId(), user.id, hashToken(b))

    await SessionDB.revoke(authEnv.appId(), hashToken(a))
    expect(await SessionDB.findValid(authEnv.appId(), hashToken(a))).toBeNull()
    expect(await SessionDB.findValid(authEnv.appId(), hashToken(b))).toBeTruthy()
    expect(await SessionDB.countForUser(user.id)).toBe(1)
  })

  it('revokes all sessions for a user', async () => {
    const { user } = await createTestUser()
    const authHash = hashToken(generateToken())
    const appHash = hashToken(generateToken())
    await SessionDB.create(authEnv.appId(), user.id, authHash)
    await SessionDB.create('app', user.id, appHash)

    await SessionDB.revokeAllForUser(user.id)
    expect(await SessionDB.countForUser(user.id)).toBe(0)
    expect(await SessionDB.findValid(authEnv.appId(), authHash)).toBeNull()
    expect(await SessionDB.findValid('app', appHash)).toBeNull()
  })
})

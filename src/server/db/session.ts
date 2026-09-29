import { randomUUID } from 'node:crypto'
import { redis } from '@/lib/redis'
import { SESSION_MAX_AGE_SECONDS } from '@/server/auth/env'
import { RedisKeys } from '@/server/redis/keys'

export type SessionRecord = {
  id: string
  userId: string
  appId: string
  createdAt: string
  tokenHash: string
}

export function sessionIndexMember(appId: string, tokenHash: string): string {
  return `${appId}/${tokenHash}`
}

function parseIndexMember(member: string): { appId: string; tokenHash: string } | null {
  const slash = member.indexOf('/')
  if (slash <= 0 || slash === member.length - 1) return null
  return { appId: member.slice(0, slash), tokenHash: member.slice(slash + 1) }
}

class SessionDB {
  async create(appId: string, userId: string, tokenHash: string): Promise<SessionRecord> {
    const record: SessionRecord = {
      id: randomUUID(),
      userId,
      appId,
      createdAt: new Date().toISOString(),
      tokenHash
    }
    const ttl = SESSION_MAX_AGE_SECONDS
    const sessionKey = RedisKeys.session(appId, tokenHash)
    const userKey = RedisKeys.sessionUser(userId)

    const pipeline = redis.pipeline()
    pipeline.set(
      sessionKey,
      JSON.stringify({
        id: record.id,
        userId: record.userId,
        appId: record.appId,
        createdAt: record.createdAt
      }),
      'EX',
      ttl
    )
    pipeline.sadd(userKey, sessionIndexMember(appId, tokenHash))
    pipeline.expire(userKey, ttl)
    await pipeline.exec()

    return record
  }

  async findValid(appId: string, tokenHash: string): Promise<SessionRecord | null> {
    const raw = await redis.get(RedisKeys.session(appId, tokenHash))
    if (!raw) return null

    try {
      const parsed = JSON.parse(raw) as Omit<SessionRecord, 'tokenHash'>
      if (!parsed.id || !parsed.userId || parsed.appId !== appId) return null
      return { ...parsed, tokenHash }
    } catch {
      return null
    }
  }

  async touch(appId: string, tokenHash: string, userId: string) {
    const ttl = SESSION_MAX_AGE_SECONDS
    const pipeline = redis.pipeline()
    pipeline.expire(RedisKeys.session(appId, tokenHash), ttl)
    pipeline.expire(RedisKeys.sessionUser(userId), ttl)
    await pipeline.exec()
  }

  async revoke(appId: string, tokenHash: string) {
    const session = await this.findValid(appId, tokenHash)
    const pipeline = redis.pipeline()
    pipeline.del(RedisKeys.session(appId, tokenHash))
    if (session) {
      pipeline.srem(RedisKeys.sessionUser(session.userId), sessionIndexMember(appId, tokenHash))
    }
    await pipeline.exec()
  }

  async revokeAllForUser(userId: string) {
    const userKey = RedisKeys.sessionUser(userId)
    const members = await redis.smembers(userKey)
    if (members.length === 0) {
      await redis.del(userKey)
      return
    }

    const pipeline = redis.pipeline()
    for (const member of members) {
      const parsed = parseIndexMember(member)
      if (parsed) {
        pipeline.del(RedisKeys.session(parsed.appId, parsed.tokenHash))
      }
    }
    pipeline.del(userKey)
    await pipeline.exec()
  }

  async countForUser(userId: string): Promise<number> {
    return redis.scard(RedisKeys.sessionUser(userId))
  }
}

export default new SessionDB()

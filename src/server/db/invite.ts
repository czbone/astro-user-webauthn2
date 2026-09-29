import { randomUUID } from 'node:crypto'
import { redis } from '@/lib/redis'
import { RedisKeys } from '@/server/redis/keys'

export type InviteRecord = {
  id: string
  userId: string
  createdAt: string
  tokenHash: string
}

function ttlSecondsFromExpiresAt(expiresAt: Date): number {
  return Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 1000))
}

class InviteDB {
  async create(userId: string, tokenHash: string, expiresAt: Date): Promise<InviteRecord> {
    const record: InviteRecord = {
      id: randomUUID(),
      userId,
      createdAt: new Date().toISOString(),
      tokenHash
    }
    const ttl = ttlSecondsFromExpiresAt(expiresAt)
    const inviteKey = RedisKeys.invite(tokenHash)
    const userKey = RedisKeys.inviteUser(userId)

    const pipeline = redis.pipeline()
    pipeline.set(
      inviteKey,
      JSON.stringify({
        id: record.id,
        userId: record.userId,
        createdAt: record.createdAt
      }),
      'EX',
      ttl
    )
    pipeline.sadd(userKey, tokenHash)
    pipeline.expire(userKey, ttl)
    await pipeline.exec()

    return record
  }

  async findValidByTokenHash(tokenHash: string): Promise<InviteRecord | null> {
    const raw = await redis.get(RedisKeys.invite(tokenHash))
    if (!raw) return null

    try {
      const parsed = JSON.parse(raw) as Omit<InviteRecord, 'tokenHash'>
      if (!parsed.id || !parsed.userId) return null
      return { ...parsed, tokenHash }
    } catch {
      return null
    }
  }

  async markUsed(tokenHash: string) {
    const invite = await this.findValidByTokenHash(tokenHash)
    const pipeline = redis.pipeline()
    pipeline.del(RedisKeys.invite(tokenHash))
    if (invite) {
      pipeline.srem(RedisKeys.inviteUser(invite.userId), tokenHash)
    }
    await pipeline.exec()
  }

  async invalidatePendingForUser(userId: string) {
    const userKey = RedisKeys.inviteUser(userId)
    const tokenHashes = await redis.smembers(userKey)
    if (tokenHashes.length === 0) {
      await redis.del(userKey)
      return
    }

    const pipeline = redis.pipeline()
    for (const tokenHash of tokenHashes) {
      pipeline.del(RedisKeys.invite(tokenHash))
    }
    pipeline.del(userKey)
    await pipeline.exec()
  }
}

export default new InviteDB()

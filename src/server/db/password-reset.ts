import { randomUUID } from 'node:crypto'
import { redis } from '@/lib/redis'
import { RedisKeys } from '@/server/redis/keys'

export type PasswordResetRecord = {
  id: string
  userId: string
  createdAt: string
  tokenHash: string
}

function ttlSecondsFromExpiresAt(expiresAt: Date): number {
  return Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 1000))
}

class PasswordResetDB {
  async create(userId: string, tokenHash: string, expiresAt: Date): Promise<PasswordResetRecord> {
    const record: PasswordResetRecord = {
      id: randomUUID(),
      userId,
      createdAt: new Date().toISOString(),
      tokenHash
    }
    const ttl = ttlSecondsFromExpiresAt(expiresAt)
    const resetKey = RedisKeys.reset(tokenHash)
    const userKey = RedisKeys.resetUser(userId)

    const pipeline = redis.pipeline()
    pipeline.set(
      resetKey,
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

  async findValidByTokenHash(tokenHash: string): Promise<PasswordResetRecord | null> {
    const raw = await redis.get(RedisKeys.reset(tokenHash))
    if (!raw) return null

    try {
      const parsed = JSON.parse(raw) as Omit<PasswordResetRecord, 'tokenHash'>
      if (!parsed.id || !parsed.userId) return null
      return { ...parsed, tokenHash }
    } catch {
      return null
    }
  }

  async markUsed(tokenHash: string) {
    const reset = await this.findValidByTokenHash(tokenHash)
    const pipeline = redis.pipeline()
    pipeline.del(RedisKeys.reset(tokenHash))
    if (reset) {
      pipeline.srem(RedisKeys.resetUser(reset.userId), tokenHash)
    }
    await pipeline.exec()
  }

  async invalidatePendingForUser(userId: string) {
    const userKey = RedisKeys.resetUser(userId)
    const tokenHashes = await redis.smembers(userKey)
    if (tokenHashes.length === 0) {
      await redis.del(userKey)
      return
    }

    const pipeline = redis.pipeline()
    for (const tokenHash of tokenHashes) {
      pipeline.del(RedisKeys.reset(tokenHash))
    }
    pipeline.del(userKey)
    await pipeline.exec()
  }

  async countForUser(userId: string): Promise<number> {
    return redis.scard(RedisKeys.resetUser(userId))
  }
}

export default new PasswordResetDB()

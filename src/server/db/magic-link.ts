import { randomUUID } from 'node:crypto'
import { redis } from '@/lib/redis'
import { RedisKeys } from '@/server/redis/keys'

export type MagicLinkRecord = {
  id: string
  userId: string
  createdAt: string
  tokenHash: string
}

function ttlSecondsFromExpiresAt(expiresAt: Date): number {
  return Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 1000))
}

class MagicLinkDB {
  async create(userId: string, tokenHash: string, expiresAt: Date): Promise<MagicLinkRecord> {
    const record: MagicLinkRecord = {
      id: randomUUID(),
      userId,
      createdAt: new Date().toISOString(),
      tokenHash
    }
    const ttl = ttlSecondsFromExpiresAt(expiresAt)
    const magicKey = RedisKeys.magic(tokenHash)
    const userKey = RedisKeys.magicUser(userId)

    const pipeline = redis.pipeline()
    pipeline.set(
      magicKey,
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

  async findValidByTokenHash(tokenHash: string): Promise<MagicLinkRecord | null> {
    const raw = await redis.get(RedisKeys.magic(tokenHash))
    if (!raw) return null

    try {
      const parsed = JSON.parse(raw) as Omit<MagicLinkRecord, 'tokenHash'>
      if (!parsed.id || !parsed.userId) return null
      return { ...parsed, tokenHash }
    } catch {
      return null
    }
  }

  async consume(tokenHash: string): Promise<MagicLinkRecord | null> {
    const record = await this.findValidByTokenHash(tokenHash)
    if (!record) return null

    const pipeline = redis.pipeline()
    pipeline.del(RedisKeys.magic(tokenHash))
    pipeline.srem(RedisKeys.magicUser(record.userId), tokenHash)
    await pipeline.exec()

    return record
  }

  async invalidatePendingForUser(userId: string) {
    const userKey = RedisKeys.magicUser(userId)
    const tokenHashes = await redis.smembers(userKey)
    if (tokenHashes.length === 0) {
      await redis.del(userKey)
      return
    }

    const pipeline = redis.pipeline()
    for (const tokenHash of tokenHashes) {
      pipeline.del(RedisKeys.magic(tokenHash))
    }
    pipeline.del(userKey)
    await pipeline.exec()
  }

  async countForUser(userId: string): Promise<number> {
    return redis.scard(RedisKeys.magicUser(userId))
  }
}

export default new MagicLinkDB()

import { randomUUID } from 'node:crypto'
import { redis } from '@/lib/redis'
import { RedisKeys } from '@/server/redis/keys'

export type EmailChangeRecord = {
  id: string
  userId: string
  email: string
  createdAt: string
  verifiedAt: string | null
  tokenHash: string
}

type StoredEmailChange = Omit<EmailChangeRecord, 'tokenHash'>

function ttlSecondsFromExpiresAt(expiresAt: Date): number {
  return Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 1000))
}

function parseStored(raw: string): StoredEmailChange | null {
  try {
    const parsed = JSON.parse(raw) as StoredEmailChange
    if (!parsed.id || !parsed.userId || !parsed.email || !parsed.createdAt) return null
    return {
      id: parsed.id,
      userId: parsed.userId,
      email: parsed.email,
      createdAt: parsed.createdAt,
      verifiedAt: parsed.verifiedAt ?? null
    }
  } catch {
    return null
  }
}

class EmailChangeDB {
  async create(
    userId: string,
    email: string,
    tokenHash: string,
    expiresAt: Date
  ): Promise<EmailChangeRecord> {
    const record: EmailChangeRecord = {
      id: randomUUID(),
      userId,
      email,
      createdAt: new Date().toISOString(),
      verifiedAt: null,
      tokenHash
    }
    const ttl = ttlSecondsFromExpiresAt(expiresAt)
    const pipeline = redis.pipeline()
    pipeline.set(
      RedisKeys.emailChange(tokenHash),
      JSON.stringify({
        id: record.id,
        userId: record.userId,
        email: record.email,
        createdAt: record.createdAt,
        verifiedAt: null
      }),
      'EX',
      ttl
    )
    pipeline.sadd(RedisKeys.emailChangeUser(userId), tokenHash)
    pipeline.expire(RedisKeys.emailChangeUser(userId), ttl)
    pipeline.set(RedisKeys.emailChangeAddr(email), tokenHash, 'EX', ttl)
    pipeline.sadd(RedisKeys.emailChangeUsers(), userId)
    await pipeline.exec()
    return record
  }

  async findValidByTokenHash(tokenHash: string): Promise<EmailChangeRecord | null> {
    const raw = await redis.get(RedisKeys.emailChange(tokenHash))
    if (!raw) return null
    const parsed = parseStored(raw)
    if (!parsed) return null
    return { ...parsed, tokenHash }
  }

  async findForUser(userId: string): Promise<EmailChangeRecord | null> {
    const hashes = await redis.smembers(RedisKeys.emailChangeUser(userId))
    const records = await Promise.all(
      hashes.map((tokenHash) => this.findValidByTokenHash(tokenHash))
    )
    const stale = hashes.filter((_, index) => !records[index])
    if (stale.length > 0) {
      await redis.srem(RedisKeys.emailChangeUser(userId), ...stale)
    }
    return records.find((record) => record !== null) ?? null
  }

  async findByEmail(email: string): Promise<EmailChangeRecord | null> {
    const tokenHash = await redis.get(RedisKeys.emailChangeAddr(email))
    if (!tokenHash) return null
    const record = await this.findValidByTokenHash(tokenHash)
    if (!record) {
      await redis.del(RedisKeys.emailChangeAddr(email))
      return null
    }
    return record
  }

  async list(): Promise<EmailChangeRecord[]> {
    const userIds = await redis.smembers(RedisKeys.emailChangeUsers())
    const records = await Promise.all(userIds.map((userId) => this.findForUser(userId)))
    const missing = userIds.filter((_, index) => !records[index])
    if (missing.length > 0) {
      await redis.srem(RedisKeys.emailChangeUsers(), ...missing)
    }
    return records.filter((record): record is EmailChangeRecord => record !== null)
  }

  async markVerified(tokenHash: string): Promise<EmailChangeRecord | null> {
    const record = await this.findValidByTokenHash(tokenHash)
    if (!record) return null
    if (record.verifiedAt) return record

    const key = RedisKeys.emailChange(tokenHash)
    const pttl = await redis.pttl(key)
    if (pttl < 1) return null
    const ttl = Math.max(1, Math.ceil(pttl / 1000))
    const verifiedAt = new Date().toISOString()
    await redis.set(
      key,
      JSON.stringify({
        id: record.id,
        userId: record.userId,
        email: record.email,
        createdAt: record.createdAt,
        verifiedAt
      }),
      'EX',
      ttl
    )
    return { ...record, verifiedAt }
  }

  async invalidatePendingForUser(userId: string) {
    const userKey = RedisKeys.emailChangeUser(userId)
    const tokenHashes = await redis.smembers(userKey)
    const records = await Promise.all(
      tokenHashes.map((tokenHash) => this.findValidByTokenHash(tokenHash))
    )
    const pipeline = redis.pipeline()
    for (const tokenHash of tokenHashes) {
      pipeline.del(RedisKeys.emailChange(tokenHash))
    }
    for (const record of records) {
      if (record) pipeline.del(RedisKeys.emailChangeAddr(record.email))
    }
    pipeline.del(userKey)
    pipeline.srem(RedisKeys.emailChangeUsers(), userId)
    await pipeline.exec()
  }
}

export default new EmailChangeDB()

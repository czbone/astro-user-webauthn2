import { redis } from '@/lib/redis'
import { RedisKeys } from '@/server/redis/keys'

export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ ok: true } | { ok: false; retryAfterSec: number }> {
  const redisKey = RedisKeys.rateLimit(key)
  const count = await redis.incr(redisKey)

  if (count === 1) {
    await redis.pexpire(redisKey, windowMs)
  }

  if (count > limit) {
    const pttl = await redis.pttl(redisKey)
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil(Math.max(pttl, 0) / 1000))
    }
  }

  return { ok: true }
}

import Redis from 'ioredis'
import { redisUrl } from '@/server/auth/redis-env'

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined
}

export const redis =
  globalForRedis.redis ??
  new Redis(redisUrl(), {
    maxRetriesPerRequest: 3,
    lazyConnect: false
  })

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis
}

redis.on('error', (err) => {
  console.error('Redis connection error:', err)
})

export default redis

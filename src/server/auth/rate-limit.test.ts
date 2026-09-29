import { beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryRedis } from '@/test/memory-redis'

vi.mock('@/lib/redis', async () => {
  const mod = await import('@/test/memory-redis')
  return {
    redis: mod.memoryRedis,
    default: mod.memoryRedis
  }
})

const { checkRateLimit } = await import('@/server/auth/rate-limit')

describe('checkRateLimit', () => {
  beforeEach(() => {
    memoryRedis.clear()
  })

  it('allows requests under the limit', async () => {
    const key = `allow-${Date.now()}-${Math.random()}`
    expect(await checkRateLimit(key, 3, 60_000)).toEqual({ ok: true })
    expect(await checkRateLimit(key, 3, 60_000)).toEqual({ ok: true })
    expect(await checkRateLimit(key, 3, 60_000)).toEqual({ ok: true })
  })

  it('blocks requests over the limit', async () => {
    const key = `block-${Date.now()}-${Math.random()}`
    await checkRateLimit(key, 2, 60_000)
    await checkRateLimit(key, 2, 60_000)
    const limited = await checkRateLimit(key, 2, 60_000)
    expect(limited.ok).toBe(false)
    if (!limited.ok) {
      expect(limited.retryAfterSec).toBeGreaterThanOrEqual(1)
    }
  })
})

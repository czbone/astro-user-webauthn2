import { beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryRedis } from '@/test/memory-redis'

vi.mock('@/lib/redis', async () => {
  const mod = await import('@/test/memory-redis')
  return {
    redis: mod.memoryRedis,
    default: mod.memoryRedis
  }
})

const { saveChallenge, takeChallenge } = await import('@/server/auth/challenges')

describe('challenges', () => {
  beforeEach(() => {
    memoryRedis.clear()
  })

  it('saves and consumes a challenge for a user', async () => {
    const userId = `user-${Date.now()}-${Math.random()}`
    await saveChallenge('register', 'challenge-value', userId)

    const first = await takeChallenge('register', userId)
    expect(first).toMatchObject({
      challenge: 'challenge-value',
      kind: 'register',
      userId
    })

    expect(await takeChallenge('register', userId)).toBeNull()
  })

  it('returns null when no challenge exists', async () => {
    expect(await takeChallenge('register', `missing-${Date.now()}`)).toBeNull()
  })
})

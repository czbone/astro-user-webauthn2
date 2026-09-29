import { redis } from '@/lib/redis'
import { RedisKeys } from '@/server/redis/keys'

export type ChallengeEntry = {
  challenge: string
  userId?: string
  kind: string
}

const TTL_SECONDS = 5 * 60

async function setEntry(key: string, entry: ChallengeEntry) {
  await redis.set(key, JSON.stringify(entry), 'EX', TTL_SECONDS)
}

async function takeEntry(key: string): Promise<ChallengeEntry | null> {
  const raw = await redis.get(key)
  if (!raw) return null
  await redis.del(key)

  try {
    return JSON.parse(raw) as ChallengeEntry
  } catch {
    return null
  }
}

export async function saveChallenge(kind: string, challenge: string, userId?: string) {
  const key = userId ? RedisKeys.challenge(kind, userId) : RedisKeys.challenge(kind, challenge)

  const entry: ChallengeEntry = { challenge, kind }
  if (userId) {
    entry.userId = userId
  }
  await setEntry(key, entry)

  if (kind === 'auth') {
    const byChallenge: ChallengeEntry = { challenge, kind }
    if (userId) {
      byChallenge.userId = userId
    }
    await setEntry(RedisKeys.authChallenge(challenge), byChallenge)
  }
}

export async function takeChallenge(kind: string, userId: string): Promise<ChallengeEntry | null> {
  return takeEntry(RedisKeys.challenge(kind, userId))
}

export async function takeAuthChallengeByValue(challenge: string): Promise<ChallengeEntry | null> {
  const entry = await takeEntry(RedisKeys.authChallenge(challenge))
  if (!entry) return null
  if (entry.userId) {
    await redis.del(RedisKeys.challenge('auth', entry.userId))
  }
  return entry
}

export async function takeAuthChallengeForUser(userId: string): Promise<ChallengeEntry | null> {
  const entry = await takeEntry(RedisKeys.challenge('auth', userId))
  if (!entry) return null
  await redis.del(RedisKeys.authChallenge(entry.challenge))
  return entry
}

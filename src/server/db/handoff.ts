import { redis } from '@/lib/redis'
import { HANDOFF_TTL_SECONDS } from '@/server/auth/env'
import { RedisKeys } from '@/server/redis/keys'

export type HandoffRecord = {
  token: string
  userId: string
  state: string
  redirectUri: string
}

class HandoffDB {
  async create(appId: string, codeHash: string, record: HandoffRecord): Promise<void> {
    await redis.set(
      RedisKeys.handoff(appId, codeHash),
      JSON.stringify(record),
      'EX',
      HANDOFF_TTL_SECONDS
    )
  }
}

export default new HandoffDB()

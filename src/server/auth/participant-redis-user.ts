import { redisKeyPrefix } from '@/server/auth/redis-env'

export const PARTICIPANT_REDIS_USERNAME = 'app_participant'

type AclClient = {
  call: (command: string, ...args: string[]) => Promise<unknown>
}

let ensuring: Promise<void> | null = null

export function participantRedisAclCommand(password: string, prefix = ''): string[] {
  return [
    'SETUSER',
    PARTICIPANT_REDIS_USERNAME,
    'reset',
    'on',
    `>${password}`,
    `(~${prefix}sess:* +get +expire +del)`,
    `(~${prefix}handoff:* +get +getdel +del)`,
    `(~${prefix}sess:user:* +srem)`
  ]
}

export function resetParticipantRedisUserState(): void {
  ensuring = null
}

export async function ensureParticipantRedisUser(client: AclClient): Promise<void> {
  const password = process.env.PARTICIPANT_REDIS_PASSWORD?.trim()
  if (!password) return
  if (!ensuring) {
    const command = participantRedisAclCommand(password, redisKeyPrefix())
    ensuring = client.call('ACL', ...command).then(
      () => undefined,
      (error: unknown) => {
        ensuring = null
        throw error
      }
    )
  }
  await ensuring
}

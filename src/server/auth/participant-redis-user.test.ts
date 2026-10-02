import { afterEach, describe, expect, it } from 'vitest'
import {
  ensureParticipantRedisUser,
  participantRedisAclCommand,
  resetParticipantRedisUserState
} from '@/server/auth/participant-redis-user'

describe('participant redis user', () => {
  afterEach(() => {
    delete process.env.PARTICIPANT_REDIS_PASSWORD
    delete process.env.REDIS_KEY_PREFIX
    resetParticipantRedisUserState()
  })

  it('builds selectors for the shared user', () => {
    expect(participantRedisAclCommand('secret')).toEqual([
      'SETUSER',
      'app_participant',
      'reset',
      'on',
      '>secret',
      '(~sess:* +get +expire +del)',
      '(~handoff:* +get +getdel +del)',
      '(~sess:user:* +srem)'
    ])
  })

  it('prefixes every key pattern', () => {
    expect(participantRedisAclCommand('secret', 'dev:')).toEqual([
      'SETUSER',
      'app_participant',
      'reset',
      'on',
      '>secret',
      '(~dev:sess:* +get +expire +del)',
      '(~dev:handoff:* +get +getdel +del)',
      '(~dev:sess:user:* +srem)'
    ])
  })

  it('does nothing when the password is unset', async () => {
    const calls: string[][] = []
    await ensureParticipantRedisUser({
      call: async (...args: string[]) => {
        calls.push(args)
        return 'OK'
      }
    })
    expect(calls).toEqual([])
  })

  it('applies the ACL once and retries after a failure', async () => {
    process.env.PARTICIPANT_REDIS_PASSWORD = 'secret'
    process.env.REDIS_KEY_PREFIX = 'dev:'
    const calls: string[][] = []
    let fail = true
    const client = {
      call: async (...args: string[]) => {
        calls.push(args)
        if (fail) throw new Error('unavailable')
        return 'OK'
      }
    }

    await expect(ensureParticipantRedisUser(client)).rejects.toThrow('unavailable')
    fail = false
    await ensureParticipantRedisUser(client)
    await ensureParticipantRedisUser(client)

    expect(calls).toEqual([
      ['ACL', ...participantRedisAclCommand('secret', 'dev:')],
      ['ACL', ...participantRedisAclCommand('secret', 'dev:')]
    ])
  })
})
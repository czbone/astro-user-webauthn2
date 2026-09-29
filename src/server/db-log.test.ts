import { describe, expect, it } from 'vitest'
import { parseDbLogLevel } from '@/server/db-log'

describe('parseDbLogLevel', () => {
  it('defaults to warn in production when unset', () => {
    expect(parseDbLogLevel(undefined, true)).toEqual({
      level: 'warn',
      log: ['error', 'warn']
    })
    expect(parseDbLogLevel('   ', true)).toEqual({
      level: 'warn',
      log: ['error', 'warn']
    })
  })

  it('defaults to query outside production when unset', () => {
    expect(parseDbLogLevel(undefined, false)).toEqual({
      level: 'query',
      log: ['error', 'warn', 'info', 'query']
    })
  })

  it('maps each named level to a cumulative prisma log list', () => {
    expect(parseDbLogLevel('silent', true)).toEqual({ level: 'silent', log: [] })
    expect(parseDbLogLevel('error', true)).toEqual({ level: 'error', log: ['error'] })
    expect(parseDbLogLevel('warn', true)).toEqual({
      level: 'warn',
      log: ['error', 'warn']
    })
    expect(parseDbLogLevel('info', false)).toEqual({
      level: 'info',
      log: ['error', 'warn', 'info']
    })
    expect(parseDbLogLevel('QUERY', true)).toEqual({
      level: 'query',
      log: ['error', 'warn', 'info', 'query']
    })
  })

  it('throws on an unknown value', () => {
    expect(() => parseDbLogLevel('debug', true)).toThrow(/DB_LOG_LEVEL/)
  })
})

import { describe, expect, it } from 'vitest'
import { generateToken, hashToken } from '@/server/auth/tokens'

describe('tokens', () => {
  it('generates a non-empty base64url token', () => {
    const token = generateToken()
    expect(token.length).toBeGreaterThan(10)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('hashes the same token deterministically', () => {
    const token = 'example-token-value'
    expect(hashToken(token)).toBe(hashToken(token))
    expect(hashToken(token)).toHaveLength(64)
  })

  it('produces different hashes for different tokens', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'))
  })
})

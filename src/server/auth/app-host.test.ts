import { describe, expect, it } from 'vitest'
import {
  isDirectChildHost,
  normalizeOrigin,
  normalizeRedirectUri,
  safeHandoffNext
} from '@/server/auth/app-host'

describe('app host rules', () => {
  it('accepts one label under the parent domain', () => {
    expect(isDirectChildHost('auth.example.com', 'example.com')).toBe(true)
    expect(isDirectChildHost('app.localhost', 'localhost')).toBe(true)
  })

  it('rejects the apex, nested hosts, and other parents', () => {
    expect(isDirectChildHost('example.com', 'example.com')).toBe(false)
    expect(isDirectChildHost('foo.app.example.com', 'example.com')).toBe(false)
    expect(isDirectChildHost('app.example.com', 'example.co.jp')).toBe(false)
  })

  it('normalizes default ports away', () => {
    expect(normalizeOrigin('https://app.example.com:443/')).toBe('https://app.example.com')
    expect(normalizeOrigin('https://app.example.com/callback')).toBeNull()
  })

  it('rejects redirect URIs with a query or a different origin', () => {
    expect(
      normalizeRedirectUri('https://app.example.com/callback', 'https://app.example.com')
    ).toBe('https://app.example.com/callback')
    expect(
      normalizeRedirectUri('https://app.example.com/callback?next=1', 'https://app.example.com')
    ).toBeNull()
    expect(
      normalizeRedirectUri('https://evil.example.com/callback', 'https://app.example.com')
    ).toBeNull()
  })

  it('allows only a handoff path as the login return target', () => {
    const next = '/auth/handoff?app=posts&redirect_uri=https%3A%2F%2Fapp.example.com%2Fcb&state=abc'
    expect(safeHandoffNext(next)).toBe(next)
    expect(
      safeHandoffNext('https://app.example.com/auth/handoff?app=posts&redirect_uri=x&state=abc')
    ).toBeNull()
    expect(safeHandoffNext('/posts')).toBeNull()
  })
})

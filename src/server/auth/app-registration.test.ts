import { afterEach, describe, expect, it, vi } from 'vitest'
import { validateParticipatingApp } from '@/server/auth/app-registration'

const HOST_ERROR = 'ホストは親ドメインか、その直下のサブドメインである必要があります'

describe('validateParticipatingApp host', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('accepts the apex and a direct child under the parent domain', () => {
    vi.stubEnv('PARENT_DOMAIN', 'example.com')
    vi.stubEnv('WEBAUTHN_ORIGIN', 'https://auth.example.com')

    expect(
      validateParticipatingApp({
        id: 'site',
        name: '頂点',
        origin: 'https://example.com',
        redirectUris: ['https://example.com/callback']
      })
    ).toEqual({
      ok: true,
      value: {
        id: 'site',
        name: '頂点',
        origin: 'https://example.com',
        redirectUris: ['https://example.com/callback']
      }
    })

    expect(
      validateParticipatingApp({
        id: 'board',
        name: '直下',
        origin: 'https://app.example.com',
        redirectUris: ['https://app.example.com/callback']
      }).ok
    ).toBe(true)
  })

  it('rejects the localhost apex', () => {
    vi.stubEnv('PARENT_DOMAIN', 'localhost')
    vi.stubEnv('WEBAUTHN_ORIGIN', 'http://auth.localhost:3000')

    expect(
      validateParticipatingApp({
        id: 'site',
        name: '頂点',
        origin: 'http://localhost:4000',
        redirectUris: ['http://localhost:4000/callback']
      })
    ).toEqual({ ok: false, error: HOST_ERROR })
  })

  it('rejects the auth server host', () => {
    vi.stubEnv('PARENT_DOMAIN', 'example.com')
    vi.stubEnv('WEBAUTHN_ORIGIN', 'https://auth.example.com')

    expect(
      validateParticipatingApp({
        id: 'site',
        name: '認証',
        origin: 'https://auth.example.com',
        redirectUris: ['https://auth.example.com/callback']
      })
    ).toEqual({ ok: false, error: '認証サーバーと同じホストは登録できません' })
  })
})

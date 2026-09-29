import { beforeEach, describe, expect, it, vi } from 'vitest'
import { redis } from '@/lib/redis'
import app from '@/server/api/app'
import { DEVICE_INVITE_TTL_MS, authEnv } from '@/server/auth/env'
import { sendPasswordResetMail, sendUserInviteMail } from '@/server/auth/mail'
import { verifyPassword } from '@/server/auth/password'
import { createSession } from '@/server/auth/session'
import { generateToken, hashToken } from '@/server/auth/tokens'
import * as webauthn from '@/server/auth/webauthn'
import CredentialDB from '@/server/db/credential'
import InviteDB from '@/server/db/invite'
import MagicLinkDB from '@/server/db/magic-link'
import PasswordResetDB from '@/server/db/password-reset'
import SessionDB from '@/server/db/session'
import UserDB from '@/server/db/user'
import { RedisKeys } from '@/server/redis/keys'
import {
  createTestUser,
  insertPasskeyFixture,
  resetDatabase,
  sessionCookieFromResponse,
  sessionCookieHeader
} from '@/test/db'

describe('auth integration', () => {
  beforeEach(async () => {
    await resetDatabase()
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('logs in with password and creates a session', async () => {
    const { email, password, user } = await createTestUser()

    const res = await app.request('/auth/login/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    })

    expect(res.status).toBe(200)
    const token = sessionCookieFromResponse(res)
    expect(token).toBeTruthy()

    const session = await SessionDB.findValid(authEnv.appId(), hashToken(token!))
    expect(session).toMatchObject({ userId: user.id })
    expect(await SessionDB.countForUser(user.id)).toBe(1)

    const body = await res.json()
    expect(body.user).toMatchObject({
      id: user.id,
      email: user.email,
      mustSetupPasskey: true
    })
  })

  it('returns the current user for GET /auth/me with a session cookie', async () => {
    const { email, password, user } = await createTestUser()

    const loginRes = await app.request('/auth/login/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    })
    const token = sessionCookieFromResponse(loginRes)
    expect(token).toBeTruthy()

    const meRes = await app.request('/auth/me', {
      headers: { Cookie: sessionCookieHeader(token!) }
    })

    expect(meRes.status).toBe(200)
    await expect(meRes.json()).resolves.toMatchObject({
      user: {
        id: user.id,
        email: user.email
      }
    })
  })

  it('revokes the session on logout', async () => {
    const { email, password, user } = await createTestUser()

    const loginRes = await app.request('/auth/login/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    })
    const token = sessionCookieFromResponse(loginRes)
    expect(token).toBeTruthy()

    const logoutRes = await app.request('/auth/logout', {
      method: 'POST',
      headers: { Cookie: sessionCookieHeader(token!) }
    })
    expect(logoutRes.status).toBe(200)

    expect(await SessionDB.findValid(authEnv.appId(), hashToken(token!))).toBeNull()
    expect(await SessionDB.countForUser(user.id)).toBe(0)

    const meRes = await app.request('/auth/me', {
      headers: { Cookie: sessionCookieHeader(token!) }
    })
    expect(meRes.status).toBe(200)
    await expect(meRes.json()).resolves.toEqual({ user: null })
  })

  it('creates a password reset record when the user exists', async () => {
    const { email, user } = await createTestUser()

    const res = await app.request('/auth/password-reset/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    })

    expect(res.status).toBe(200)
    expect(await PasswordResetDB.countForUser(user.id)).toBe(1)
    expect(sendPasswordResetMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: user.email,
        name: user.name
      })
    )
  })

  it('rejects wrong passwords without creating a session', async () => {
    const { email, user } = await createTestUser()

    const res = await app.request('/auth/login/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'wrong-password' })
    })

    expect(res.status).toBe(401)
    expect(await SessionDB.countForUser(user.id)).toBe(0)
  })

  it('returns magic method for users without passkeys', async () => {
    const { email } = await createTestUser()

    const res = await app.request('/auth/login/method', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ method: 'magic' })
  })

  it('returns passkey method and options for users with passkeys', async () => {
    const { email, user } = await createTestUser()
    const credential = await insertPasskeyFixture(user.id, {
      transports: JSON.stringify(['internal'])
    })

    const res = await app.request('/auth/login/method', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.method).toBe('passkey')
    expect(body.options.allowCredentials).toEqual([
      { id: credential.credentialId, type: 'public-key' }
    ])
    expect(body.options.allowCredentials[0]).not.toHaveProperty('transports')
    expect(body.options.challenge).toEqual(expect.any(String))
  })

  it('returns 401 for non-existent email', async () => {
    const res = await app.request('/auth/login/method', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'missing@example.com' })
    })

    expect(res.status).toBe(401)
  })

  it('completes passkey login flow with options and verify', async () => {
    const { email, user } = await createTestUser()
    await insertPasskeyFixture(user.id)

    const optionsRes = await app.request('/auth/login/passkey/options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    })
    expect(optionsRes.status).toBe(200)
    const optionsBody = await optionsRes.json()
    expect(optionsBody.options.challenge).toBeTruthy()

    vi.spyOn(webauthn, 'verifyAuthentication').mockResolvedValue({
      verification: {} as Awaited<ReturnType<typeof webauthn.verifyAuthentication>>['verification'],
      userId: user.id
    })

    const verifyRes = await app.request('/auth/login/passkey/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        response: {
          id: 'fake',
          rawId: 'fake',
          response: {},
          type: 'public-key',
          clientExtensionResults: {}
        }
      })
    })

    expect(verifyRes.status).toBe(200)
    await expect(verifyRes.json()).resolves.toMatchObject({
      user: {
        id: user.id,
        hasPasskey: true,
        mustSetupPasskey: false
      }
    })
  })

  it('creates session after successful passkey authentication', async () => {
    const { user } = await createTestUser()
    await insertPasskeyFixture(user.id)

    vi.spyOn(webauthn, 'verifyAuthentication').mockResolvedValue({
      verification: {} as Awaited<ReturnType<typeof webauthn.verifyAuthentication>>['verification'],
      userId: user.id
    })

    const res = await app.request('/auth/login/passkey/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        response: {
          id: 'fake',
          rawId: 'fake',
          response: {},
          type: 'public-key',
          clientExtensionResults: {}
        }
      })
    })

    expect(res.status).toBe(200)
    const token = sessionCookieFromResponse(res)
    expect(token).toBeTruthy()
    expect(await SessionDB.countForUser(user.id)).toBe(1)
  })

  it('updates credential lastUsedAt on authentication', async () => {
    const { user } = await createTestUser()
    const cred = await insertPasskeyFixture(user.id)
    expect(cred.lastUsedAt).toBeNull()

    await CredentialDB.updateCounter(cred.id, 1n)
    const updated = await CredentialDB.findByCredentialId(cred.credentialId)
    expect(updated?.lastUsedAt).toBeInstanceOf(Date)
    expect(updated?.counter).toBe(1n)
  })

  it('allows first passkey registration for authenticated user', async () => {
    const { user } = await createTestUser()
    const { token } = await createSession(user.id)

    const res = await app.request('/auth/passkey/register/options', {
      method: 'POST',
      headers: { Cookie: sessionCookieHeader(token) }
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.options.challenge).toBeTruthy()
  })

  it('completes passkey registration with options and verify', async () => {
    const { user } = await createTestUser()
    const { token } = await createSession(user.id)

    const optionsRes = await app.request('/auth/passkey/register/options', {
      method: 'POST',
      headers: { Cookie: sessionCookieHeader(token) }
    })
    expect(optionsRes.status).toBe(200)

    vi.spyOn(webauthn, 'verifyRegistration').mockResolvedValue(
      {} as Awaited<ReturnType<typeof webauthn.verifyRegistration>>
    )

    const verifyRes = await app.request('/auth/passkey/register/verify', {
      method: 'POST',
      headers: {
        Cookie: sessionCookieHeader(token),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        response: {
          id: 'fake',
          rawId: 'fake',
          response: {},
          type: 'public-key',
          clientExtensionResults: {}
        },
        deviceName: 'Phone'
      })
    })

    expect(verifyRes.status).toBe(200)
    await expect(verifyRes.json()).resolves.toEqual({ ok: true })
  })

  it('rejects passkey registration without a device name', async () => {
    const { user } = await createTestUser()
    const { token } = await createSession(user.id)
    const spy = vi.spyOn(webauthn, 'verifyRegistration')

    const verifyRes = await app.request('/auth/passkey/register/verify', {
      method: 'POST',
      headers: {
        Cookie: sessionCookieHeader(token),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        response: {
          id: 'fake',
          rawId: 'fake',
          response: {},
          type: 'public-key',
          clientExtensionResults: {}
        }
      })
    })

    expect(verifyRes.status).toBe(400)
    await expect(verifyRes.json()).resolves.toEqual({ error: 'デバイス名は必須です' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('rejects passkey registration with a blank device name', async () => {
    const { user } = await createTestUser()
    const { token } = await createSession(user.id)
    const spy = vi.spyOn(webauthn, 'verifyRegistration')

    const verifyRes = await app.request('/auth/passkey/register/verify', {
      method: 'POST',
      headers: {
        Cookie: sessionCookieHeader(token),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        response: {
          id: 'fake',
          rawId: 'fake',
          response: {},
          type: 'public-key',
          clientExtensionResults: {}
        },
        deviceName: '   '
      })
    })

    expect(verifyRes.status).toBe(400)
    await expect(verifyRes.json()).resolves.toEqual({ error: 'デバイス名は必須です' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('rejects second passkey registration from /auth (requires /devices)', async () => {
    const { user } = await createTestUser()
    await insertPasskeyFixture(user.id)
    const { token } = await createSession(user.id)

    const optionsRes = await app.request('/auth/passkey/register/options', {
      method: 'POST',
      headers: { Cookie: sessionCookieHeader(token) }
    })
    expect(optionsRes.status).toBe(403)

    const verifyRes = await app.request('/auth/passkey/register/verify', {
      method: 'POST',
      headers: {
        Cookie: sessionCookieHeader(token),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        response: {
          id: 'fake',
          rawId: 'fake',
          response: {},
          type: 'public-key',
          clientExtensionResults: {}
        }
      })
    })
    expect(verifyRes.status).toBe(403)
  })

  it('resets password and deletes all credentials on confirm', async () => {
    const { email, user } = await createTestUser()
    await insertPasskeyFixture(user.id)
    await insertPasskeyFixture(user.id)

    await app.request('/auth/password-reset/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    })
    const resetToken = vi.mocked(sendPasswordResetMail).mock.calls[0]?.[0].token
    expect(resetToken).toBeTruthy()

    const newPassword = 'new-password-123'
    const res = await app.request('/auth/password-reset/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: resetToken, password: newPassword })
    })

    expect(res.status).toBe(200)
    expect(await CredentialDB.countForUser(user.id)).toBe(0)

    const updated = await UserDB.findById(user.id)
    expect(await verifyPassword(newPassword, updated!.password)).toBe(true)
  })

  it('revokes all sessions for the user on confirm', async () => {
    const { email, user } = await createTestUser()
    await createSession(user.id)
    await createSession(user.id)
    expect(await SessionDB.countForUser(user.id)).toBe(2)

    await app.request('/auth/password-reset/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    })
    const resetToken = vi.mocked(sendPasswordResetMail).mock.calls[0]?.[0].token

    const res = await app.request('/auth/password-reset/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: resetToken, password: 'new-password-123' })
    })

    expect(res.status).toBe(200)
    // old sessions revoked; one fresh session created by confirm
    expect(await SessionDB.countForUser(user.id)).toBe(1)
    expect(sessionCookieFromResponse(res)).toBeTruthy()
  })

  it('invalidates pending device invites on confirm', async () => {
    const { email, user } = await createTestUser()
    const inviteToken = generateToken()
    await InviteDB.create(
      user.id,
      hashToken(inviteToken),
      new Date(Date.now() + DEVICE_INVITE_TTL_MS)
    )

    await app.request('/auth/password-reset/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    })
    const resetToken = vi.mocked(sendPasswordResetMail).mock.calls[0]?.[0].token

    await app.request('/auth/password-reset/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: resetToken, password: 'new-password-123' })
    })

    expect(await InviteDB.findValidByTokenHash(hashToken(inviteToken))).toBeNull()
  })

  it('invalidates pending magic links on password reset confirm', async () => {
    const { email, user } = await createTestUser()
    const magicToken = generateToken()
    await MagicLinkDB.create(user.id, hashToken(magicToken), new Date(Date.now() + 60_000))

    await app.request('/auth/password-reset/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    })
    const resetToken = vi.mocked(sendPasswordResetMail).mock.calls[0]?.[0].token

    await app.request('/auth/password-reset/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: resetToken, password: 'new-password-123' })
    })

    expect(await MagicLinkDB.findValidByTokenHash(hashToken(magicToken))).toBeNull()
  })

  it('creates new session and redirects to setup-passkey', async () => {
    const { email, user } = await createTestUser()

    await app.request('/auth/password-reset/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    })
    const resetToken = vi.mocked(sendPasswordResetMail).mock.calls[0]?.[0].token

    const res = await app.request('/auth/password-reset/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: resetToken, password: 'new-password-123' })
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      ok: true,
      redirectTo: '/setup-passkey'
    })
    expect(sessionCookieFromResponse(res)).toBeTruthy()
    expect(await SessionDB.countForUser(user.id)).toBe(1)
  })

  it('rejects invalid or expired reset tokens', async () => {
    const res = await app.request('/auth/password-reset/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'invalid', password: 'new-password-123' })
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: '再設定リンクが無効または期限切れです'
    })
  })

  it('rejects password login for users with passkeys (403)', async () => {
    const { email, password, user } = await createTestUser()
    await insertPasskeyFixture(user.id)

    const res = await app.request('/auth/login/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    })

    expect(res.status).toBe(403)
    expect(await SessionDB.countForUser(user.id)).toBe(0)
  })

  it('enforces passkey requirement before accessing protected routes', async () => {
    const { user } = await createTestUser()
    const { token } = await createSession(user.id)

    const res = await app.request('/posts', {
      headers: { Cookie: sessionCookieHeader(token) }
    })

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({
      error: '先にパスキーを登録してください'
    })
  })

  it('returns 429 after exceeding password login attempts', async () => {
    const { email } = await createTestUser()

    for (let i = 0; i < 10; i++) {
      const res = await app.request('/auth/login/password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '203.0.113.10'
        },
        body: JSON.stringify({ email, password: 'wrong-password' })
      })
      expect(res.status).toBe(401)
    }

    const limited = await app.request('/auth/login/password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.10'
      },
      body: JSON.stringify({ email, password: 'wrong-password' })
    })

    expect(limited.status).toBe(429)
  })

  it('stops sending reset mail after exceeding reset request attempts', async () => {
    const { email } = await createTestUser()

    for (let i = 0; i < 5; i++) {
      const res = await app.request('/auth/password-reset/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '203.0.113.20'
        },
        body: JSON.stringify({ email })
      })
      expect(res.status).toBe(200)
    }
    expect(sendPasswordResetMail).toHaveBeenCalledTimes(5)

    const limited = await app.request('/auth/password-reset/request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.20'
      },
      body: JSON.stringify({ email })
    })

    // API intentionally returns the same generic 200 to avoid account enumeration
    expect(limited.status).toBe(200)
    expect(sendPasswordResetMail).toHaveBeenCalledTimes(5)
  })

  it('rejects reuse of consumed password reset token', async () => {
    const { email } = await createTestUser()

    await app.request('/auth/password-reset/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    })
    const resetToken = vi.mocked(sendPasswordResetMail).mock.calls[0]?.[0].token

    const first = await app.request('/auth/password-reset/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: resetToken, password: 'new-password-123' })
    })
    expect(first.status).toBe(200)

    const second = await app.request('/auth/password-reset/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: resetToken, password: 'another-password-123' })
    })
    expect(second.status).toBe(400)
  })

  it('rejects revoked session token', async () => {
    const { user } = await createTestUser()
    const { token } = await createSession(user.id)
    await SessionDB.revoke(authEnv.appId(), hashToken(token))

    const res = await app.request('/auth/me', {
      headers: { Cookie: sessionCookieHeader(token) }
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ user: null })
  })

  it('allows different tokens for same user simultaneously', async () => {
    const { user } = await createTestUser()
    const a = await createSession(user.id)
    const b = await createSession(user.id)

    const meA = await app.request('/auth/me', {
      headers: { Cookie: sessionCookieHeader(a.token) }
    })
    const meB = await app.request('/auth/me', {
      headers: { Cookie: sessionCookieHeader(b.token) }
    })

    expect(meA.status).toBe(200)
    expect(meB.status).toBe(200)
    await expect(meA.json()).resolves.toMatchObject({ user: { id: user.id } })
    await expect(meB.json()).resolves.toMatchObject({ user: { id: user.id } })
    expect(await SessionDB.countForUser(user.id)).toBe(2)
  })

  it('extends session TTL on valid access', async () => {
    const { user } = await createTestUser()
    await insertPasskeyFixture(user.id)
    const { token } = await createSession(user.id)
    const key = RedisKeys.session(authEnv.appId(), hashToken(token))

    await redis.expire(key, 120)
    const before = await redis.ttl(key)
    expect(before).toBeLessThanOrEqual(120)

    const res = await app.request('/auth/me', {
      headers: { Cookie: sessionCookieHeader(token) }
    })
    expect(res.status).toBe(200)

    const after = await redis.ttl(key)
    expect(after).toBeGreaterThan(before)
    expect(after).toBeGreaterThan(1000)
  })

  it('revokes single session on logout (others remain active)', async () => {
    const { user } = await createTestUser()
    const a = await createSession(user.id)
    const b = await createSession(user.id)

    const logoutRes = await app.request('/auth/logout', {
      method: 'POST',
      headers: { Cookie: sessionCookieHeader(a.token) }
    })
    expect(logoutRes.status).toBe(200)

    expect(await SessionDB.findValid(authEnv.appId(), hashToken(a.token))).toBeNull()
    expect(await SessionDB.findValid(authEnv.appId(), hashToken(b.token))).toBeTruthy()
    expect(await SessionDB.countForUser(user.id)).toBe(1)
  })

  it('revokes every app session on logout-all', async () => {
    const { user } = await createTestUser()
    await insertPasskeyFixture(user.id)
    const authSession = await createSession(user.id)
    const otherHash = hashToken(generateToken())
    await SessionDB.create('posts', user.id, otherHash)

    const res = await app.request('/auth/logout-all', {
      method: 'POST',
      headers: { Cookie: sessionCookieHeader(authSession.token) }
    })
    expect(res.status).toBe(200)
    expect(await SessionDB.findValid(authEnv.appId(), hashToken(authSession.token))).toBeNull()
    expect(await SessionDB.findValid('posts', otherHash)).toBeNull()
  })

  it('rejects a mutating request without Origin', async () => {
    const res = await app.request('/auth/login/password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-omit-origin': '1'
      },
      body: JSON.stringify({})
    })
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({ error: 'オリジンが不正です' })
  })

  it('rejects expired session tokens', async () => {
    const { user } = await createTestUser()
    const { token } = await createSession(user.id)
    await redis.del(RedisKeys.session(authEnv.appId(), hashToken(token)))

    const res = await app.request('/auth/me', {
      headers: { Cookie: sessionCookieHeader(token) }
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ user: null })
  })

  it('rejects reuse of consumed device invite token', async () => {
    const { user } = await createTestUser()
    const token = generateToken()
    const tokenHash = hashToken(token)
    await InviteDB.create(user.id, tokenHash, new Date(Date.now() + DEVICE_INVITE_TTL_MS))

    await InviteDB.markUsed(tokenHash)
    expect(await InviteDB.findValidByTokenHash(tokenHash)).toBeNull()

    const res = await app.request('/devices/register/options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    })
    expect(res.status).toBe(400)
  })

  it('consumes an invite magic link once and creates a session', async () => {
    const { user } = await createTestUser()
    const token = generateToken()
    await MagicLinkDB.create(user.id, hashToken(token), new Date(Date.now() + 60_000))

    const res = await app.request('/auth/magic/consume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, redirectTo: '/setup-passkey' })
    const sessionToken = sessionCookieFromResponse(res)
    expect(sessionToken).toBeTruthy()
    expect(await SessionDB.findValid(authEnv.appId(), hashToken(sessionToken!))).toMatchObject({
      userId: user.id
    })
    expect(await MagicLinkDB.findValidByTokenHash(hashToken(token))).toBeNull()

    const second = await app.request('/auth/magic/consume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    })
    expect(second.status).toBe(400)
  })

  it('rejects magic link consume when the user already has a passkey', async () => {
    const { user } = await createTestUser()
    await insertPasskeyFixture(user.id)
    const token = generateToken()
    await MagicLinkDB.create(user.id, hashToken(token), new Date(Date.now() + 60_000))

    const res = await app.request('/auth/magic/consume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    })

    expect(res.status).toBe(400)
    expect(await SessionDB.countForUser(user.id)).toBe(0)
  })

  it('resends a magic link for users without passkeys and revokes existing sessions', async () => {
    const { email, user } = await createTestUser()
    const { token: oldSession } = await createSession(user.id)

    const res = await app.request('/auth/magic/resend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    })

    expect(res.status).toBe(200)
    expect(sendUserInviteMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: user.email,
        name: user.name,
        token: expect.any(String)
      })
    )
    expect(await SessionDB.findValid(authEnv.appId(), hashToken(oldSession))).toBeNull()
    expect(await MagicLinkDB.countForUser(user.id)).toBe(1)
  })

  it('does not send a magic link for unknown emails or users with passkeys', async () => {
    const { email, user } = await createTestUser()
    await insertPasskeyFixture(user.id)

    const unknown = await app.request('/auth/magic/resend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'missing@example.com' })
    })
    const withPasskey = await app.request('/auth/magic/resend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    })

    expect(unknown.status).toBe(200)
    expect(withPasskey.status).toBe(200)
    expect(sendUserInviteMail).not.toHaveBeenCalled()
    expect(await SessionDB.countForUser(user.id)).toBe(0)
  })

  it('rejects invalid or expired magic link tokens without creating a session', async () => {
    const { user } = await createTestUser()
    const expiredToken = generateToken()
    await MagicLinkDB.create(user.id, hashToken(expiredToken), new Date(Date.now() + 60_000))
    await redis.del(RedisKeys.magic(hashToken(expiredToken)))

    const missing = await app.request('/auth/magic/consume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'not-a-real-token' })
    })
    const expired = await app.request('/auth/magic/consume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: expiredToken })
    })

    expect(missing.status).toBe(400)
    expect(expired.status).toBe(400)
    expect(await SessionDB.countForUser(user.id)).toBe(0)
  })

  it('stops sending magic link mail after exceeding resend attempts', async () => {
    const { email } = await createTestUser()

    for (let i = 0; i < 5; i++) {
      const res = await app.request('/auth/magic/resend', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '203.0.113.30'
        },
        body: JSON.stringify({ email })
      })
      expect(res.status).toBe(200)
    }
    expect(sendUserInviteMail).toHaveBeenCalledTimes(5)

    const limited = await app.request('/auth/magic/resend', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.30'
      },
      body: JSON.stringify({ email })
    })

    expect(limited.status).toBe(200)
    expect(sendUserInviteMail).toHaveBeenCalledTimes(5)
  })
})

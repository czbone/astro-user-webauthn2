import { beforeEach, describe, expect, it, vi } from 'vitest'
import app from '@/server/api/app'
import { saveChallenge } from '@/server/auth/challenges'
import { sendDeviceInviteMail } from '@/server/auth/mail'
import { createSession } from '@/server/auth/session'
import { generateToken, hashToken } from '@/server/auth/tokens'
import * as webauthn from '@/server/auth/webauthn'
import { DEVICE_INVITE_TTL_MS } from '@/server/auth/env'
import InviteDB from '@/server/db/invite'
import { createTestUser, insertPasskeyFixture, resetDatabase, sessionCookieHeader } from '@/test/db'

async function passkeyUserCookie(input?: { email?: string }) {
  const created = await createTestUser(input)
  await insertPasskeyFixture(created.user.id, { deviceName: 'Primary' })
  const { token } = await createSession(created.user.id)
  return { ...created, cookie: sessionCookieHeader(token) }
}

describe('devices integration', () => {
  beforeEach(async () => {
    await resetDatabase()
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('lists devices for authenticated user with passkey', async () => {
    const { cookie, user } = await passkeyUserCookie()
    await insertPasskeyFixture(user.id, { deviceName: 'Secondary' })

    const res = await app.request('/devices', {
      headers: { Cookie: cookie }
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(2)
    expect(body.map((d: { deviceName: string | null }) => d.deviceName).sort()).toEqual([
      'Primary',
      'Secondary'
    ])
  })

  it('returns 403 without passkey setup', async () => {
    const { user } = await createTestUser()
    const { token } = await createSession(user.id)

    const res = await app.request('/devices', {
      headers: { Cookie: sessionCookieHeader(token) }
    })

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({
      error: '先にパスキーを登録してください'
    })
  })

  it('deletes a device successfully', async () => {
    const { cookie, user } = await passkeyUserCookie()
    const second = await insertPasskeyFixture(user.id, { deviceName: 'Extra' })

    const res = await app.request(`/devices/${second.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie }
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })

    const listRes = await app.request('/devices', {
      headers: { Cookie: cookie }
    })
    const list = await listRes.json()
    expect(list).toHaveLength(1)
    expect(list[0].deviceName).toBe('Primary')
  })

  it('rejects deletion of the last device with 400', async () => {
    const { cookie } = await passkeyUserCookie()
    const listRes = await app.request('/devices', { headers: { Cookie: cookie } })
    const [only] = await listRes.json()

    const res = await app.request(`/devices/${only.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie }
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining('最後のパスキーは削除できません')
    })
  })

  it('returns 404 for non-existent device', async () => {
    const { cookie, user } = await passkeyUserCookie({ email: 'owner@example.com' })
    await insertPasskeyFixture(user.id)

    const res = await app.request('/devices/00000000-0000-0000-0000-000000000000', {
      method: 'DELETE',
      headers: { Cookie: cookie }
    })

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({
      error: 'デバイスが見つかりません'
    })
  })

  it("prevents deleting another user's device", async () => {
    const owner = await passkeyUserCookie({ email: 'owner@example.com' })
    await insertPasskeyFixture(owner.user.id)
    const other = await passkeyUserCookie({ email: 'other@example.com' })
    const otherDevice = await insertPasskeyFixture(other.user.id, {
      deviceName: 'Other Device'
    })

    const res = await app.request(`/devices/${otherDevice.id}`, {
      method: 'DELETE',
      headers: { Cookie: owner.cookie }
    })

    expect(res.status).toBe(404)
  })

  it('creates reauth options', async () => {
    const { cookie } = await passkeyUserCookie()

    const res = await app.request('/devices/reauth/options', {
      method: 'POST',
      headers: { Cookie: cookie }
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.options).toMatchObject({
      challenge: expect.any(String),
      allowCredentials: expect.any(Array)
    })
  })

  it('verifies reauth response and stores reauth-ok flag', async () => {
    const { cookie, user } = await passkeyUserCookie()
    const spy = vi.spyOn(webauthn, 'verifyReauth').mockImplementation(async (userId) => {
      await saveChallenge('reauth-ok', '1', userId)
      return {} as Awaited<ReturnType<typeof webauthn.verifyReauth>>
    })

    const res = await app.request('/devices/reauth/verify', {
      method: 'POST',
      headers: {
        Cookie: cookie,
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

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
    expect(spy).toHaveBeenCalledWith(user.id, expect.any(Object))
    expect(await webauthn.consumeReauth(user.id)).toBe(true)
  })

  it('requires reauth before creating invite', async () => {
    const { cookie } = await passkeyUserCookie()

    const res = await app.request('/devices/invite', {
      method: 'POST',
      headers: { Cookie: cookie }
    })

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({
      error: 'デバイス追加には再認証が必要です'
    })
  })

  it('creates invite token and sends email', async () => {
    const { cookie, user, email } = await passkeyUserCookie({
      email: 'invite-owner@example.com'
    })
    await saveChallenge('reauth-ok', '1', user.id)

    const res = await app.request('/devices/invite', {
      method: 'POST',
      headers: { Cookie: cookie }
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      message: '招待メールを送信しました'
    })
    expect(sendDeviceInviteMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: email,
        name: user.name,
        token: expect.any(String)
      })
    )
  })

  it('invalidates previous pending invites', async () => {
    const { cookie, user } = await passkeyUserCookie()
    const oldToken = generateToken()
    await InviteDB.create(user.id, hashToken(oldToken), new Date(Date.now() + DEVICE_INVITE_TTL_MS))
    expect(await InviteDB.findValidByTokenHash(hashToken(oldToken))).toBeTruthy()

    await saveChallenge('reauth-ok', '1', user.id)
    const res = await app.request('/devices/invite', {
      method: 'POST',
      headers: { Cookie: cookie }
    })
    expect(res.status).toBe(200)

    expect(await InviteDB.findValidByTokenHash(hashToken(oldToken))).toBeNull()
    const newToken = vi.mocked(sendDeviceInviteMail).mock.calls[0]?.[0].token
    expect(newToken).toBeTruthy()
    expect(await InviteDB.findValidByTokenHash(hashToken(newToken!))).toBeTruthy()
  })

  it('returns 403 without reauth', async () => {
    const { cookie } = await passkeyUserCookie()

    const res = await app.request('/devices/invite', {
      method: 'POST',
      headers: { Cookie: cookie }
    })

    expect(res.status).toBe(403)
  })

  it('creates registration options with valid invite token', async () => {
    const { user } = await createTestUser({ email: 'reg@example.com', name: 'Reg User' })
    await insertPasskeyFixture(user.id)
    const token = generateToken()
    await InviteDB.create(user.id, hashToken(token), new Date(Date.now() + DEVICE_INVITE_TTL_MS))

    const res = await app.request('/devices/register/options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      email: 'reg@example.com',
      name: 'Reg User',
      options: { challenge: expect.any(String) }
    })
  })

  it('verifies registration and marks invite as used', async () => {
    const { user } = await createTestUser()
    await insertPasskeyFixture(user.id)
    const token = generateToken()
    const tokenHash = hashToken(token)
    await InviteDB.create(user.id, tokenHash, new Date(Date.now() + DEVICE_INVITE_TTL_MS))

    vi.spyOn(webauthn, 'verifyRegistration').mockResolvedValue(
      {} as Awaited<ReturnType<typeof webauthn.verifyRegistration>>
    )

    const res = await app.request('/devices/register/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        response: {
          id: 'fake',
          rawId: 'fake',
          response: {},
          type: 'public-key',
          clientExtensionResults: {}
        },
        deviceName: 'Laptop'
      })
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
    expect(await InviteDB.findValidByTokenHash(tokenHash)).toBeNull()
  })

  it('rejects device registration without a device name', async () => {
    const { user } = await createTestUser()
    await insertPasskeyFixture(user.id)
    const token = generateToken()
    const tokenHash = hashToken(token)
    await InviteDB.create(user.id, tokenHash, new Date(Date.now() + DEVICE_INVITE_TTL_MS))
    const spy = vi.spyOn(webauthn, 'verifyRegistration')

    const res = await app.request('/devices/register/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        response: {
          id: 'fake',
          rawId: 'fake',
          response: {},
          type: 'public-key',
          clientExtensionResults: {}
        }
      })
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'デバイス名は必須です' })
    expect(spy).not.toHaveBeenCalled()
    expect(await InviteDB.findValidByTokenHash(tokenHash)).not.toBeNull()
  })

  it('rejects device registration when the device name is already used', async () => {
    const { user } = await createTestUser()
    await insertPasskeyFixture(user.id, { deviceName: 'Laptop' })
    const token = generateToken()
    const tokenHash = hashToken(token)
    await InviteDB.create(user.id, tokenHash, new Date(Date.now() + DEVICE_INVITE_TTL_MS))
    const spy = vi.spyOn(webauthn, 'verifyRegistration')

    const res = await app.request('/devices/register/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        response: {
          id: 'fake',
          rawId: 'fake',
          response: {},
          type: 'public-key',
          clientExtensionResults: {}
        },
        deviceName: '  Laptop  '
      })
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: '同じデバイス名は既に登録されています' })
    expect(spy).not.toHaveBeenCalled()
    expect(await InviteDB.findValidByTokenHash(tokenHash)).not.toBeNull()
  })

  it('rejects invalid or expired invite tokens', async () => {
    const res = await app.request('/devices/register/options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'invalid-token' })
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: '招待が無効または期限切れです'
    })
  })

  it('allows registration without session cookie', async () => {
    const { user } = await createTestUser({ email: 'nosession@example.com' })
    await insertPasskeyFixture(user.id)
    const token = generateToken()
    await InviteDB.create(user.id, hashToken(token), new Date(Date.now() + DEVICE_INVITE_TTL_MS))

    const res = await app.request('/devices/register/options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      email: 'nosession@example.com'
    })
  })
})

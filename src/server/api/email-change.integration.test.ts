import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import app from '@/server/api/app'
import { saveChallenge } from '@/server/auth/challenges'
import { sendEmailChangeNoticeMail, sendEmailChangeRequestMail } from '@/server/auth/mail'
import { createSession } from '@/server/auth/session'
import { generateToken, hashToken } from '@/server/auth/tokens'
import EmailChangeDB from '@/server/db/email-change'
import InviteDB from '@/server/db/invite'
import MagicLinkDB from '@/server/db/magic-link'
import PasswordResetDB from '@/server/db/password-reset'
import SessionDB from '@/server/db/session'
import {
  createTestUser,
  grantAppAccess,
  insertPasskeyFixture,
  resetDatabase,
  sessionCookieHeader
} from '@/test/db'

async function adminCookie() {
  const { user } = await createTestUser({
    role: 'admin',
    email: 'admin@example.com',
    name: 'Admin User'
  })
  await insertPasskeyFixture(user.id)
  const { token } = await createSession(user.id)
  return { user, cookie: sessionCookieHeader(token) }
}

function requestToken(): string {
  const calls = vi.mocked(sendEmailChangeRequestMail).mock.calls
  const token = calls[calls.length - 1]?.[0]?.token
  if (!token) throw new Error('確認メールが送信されていません')
  return token
}

async function requestChange(cookie: string, userId: string, email: string) {
  return app.request('/admin/email-changes', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, email })
  })
}

describe('email change integration', () => {
  beforeEach(async () => {
    await resetDatabase()
    vi.clearAllMocks()
  })

  it('rejects managers', async () => {
    const { user } = await createTestUser({ role: 'manager', email: 'manager@example.com' })
    await insertPasskeyFixture(user.id)
    const { token } = await createSession(user.id)

    const res = await app.request('/admin/email-changes', {
      headers: { Cookie: sessionCookieHeader(token) }
    })

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({ error: '管理者権限が必要です' })
  })

  it('sends a confirmation mail without changing the address or sessions', async () => {
    const { cookie } = await adminCookie()
    const { user } = await createTestUser({ email: 'member@example.com', name: 'Member' })
    const { token: memberToken } = await createSession(user.id)

    const res = await requestChange(cookie, user.id, 'Next@Example.com')

    expect(res.status).toBe(200)
    expect(sendEmailChangeRequestMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'next@example.com',
        name: 'Member',
        token: expect.any(String)
      })
    )
    expect((await prisma.user.findUnique({ where: { id: user.id } }))?.email).toBe(
      'member@example.com'
    )
    expect(await SessionDB.countForUser(user.id)).toBe(1)

    const verify = await app.request('/auth/email-change/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookieHeader(memberToken) },
      body: JSON.stringify({ token: requestToken() })
    })
    expect(verify.status).toBe(200)
    expect((await prisma.user.findUnique({ where: { id: user.id } }))?.email).toBe(
      'member@example.com'
    )
    expect(await SessionDB.countForUser(user.id)).toBe(1)
    const pending = await EmailChangeDB.findForUser(user.id)
    expect(pending?.verifiedAt).toEqual(expect.any(String))
    expect(pending?.email).toBe('next@example.com')
  })

  it('rejects an address that is current, taken, or held by another change', async () => {
    const { cookie } = await adminCookie()
    const { user } = await createTestUser({ email: 'member@example.com', name: 'Member' })
    await createTestUser({ email: 'taken@example.com' })

    const same = await requestChange(cookie, user.id, 'member@example.com')
    expect(same.status).toBe(400)

    const taken = await requestChange(cookie, user.id, 'taken@example.com')
    expect(taken.status).toBe(409)

    const first = await requestChange(cookie, user.id, 'fresh@example.com')
    expect(first.status).toBe(200)
    const { user: other } = await createTestUser({ email: 'other@example.com' })
    const held = await requestChange(cookie, other.id, 'fresh@example.com')
    expect(held.status).toBe(409)
    await expect(held.json()).resolves.toMatchObject({
      error: 'このメールアドレスは変更手続き中です'
    })
  })

  it('rejects an invitation that uses an address held by a pending change', async () => {
    const { cookie } = await adminCookie()
    const { user } = await createTestUser({ email: 'member@example.com' })
    expect((await requestChange(cookie, user.id, 'held@example.com')).status).toBe(200)

    const res = await app.request('/admin/users', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'held@example.com', name: 'Held' })
    })

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({
      error: 'このメールアドレスは変更手続き中です'
    })
  })

  it('replaces the previous confirmation link when requesting again', async () => {
    const { cookie } = await adminCookie()
    const { user } = await createTestUser({ email: 'member@example.com', name: 'Member' })

    expect((await requestChange(cookie, user.id, 'first@example.com')).status).toBe(200)
    const firstToken = requestToken()
    expect((await requestChange(cookie, user.id, 'second@example.com')).status).toBe(200)

    const stale = await app.request('/auth/email-change/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: firstToken })
    })
    expect(stale.status).toBe(400)

    const fresh = await app.request('/auth/email-change/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: requestToken() })
    })
    expect(fresh.status).toBe(200)
    expect((await EmailChangeDB.findForUser(user.id))?.email).toBe('second@example.com')
  })

  it('keeps a second receipt confirmation idempotent', async () => {
    const { cookie } = await adminCookie()
    const { user } = await createTestUser({ email: 'member@example.com', name: 'Member' })
    expect((await requestChange(cookie, user.id, 'next@example.com')).status).toBe(200)
    const token = requestToken()

    const first = await app.request('/auth/email-change/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    })
    const second = await app.request('/auth/email-change/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    })

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(await EmailChangeDB.findByEmail('next@example.com')).not.toBeNull()
  })

  it('commits only after email-change reauth and revokes the target sessions', async () => {
    const { user: admin, cookie } = await adminCookie()
    const { user } = await createTestUser({ email: 'member@example.com', name: 'Member' })
    await insertPasskeyFixture(user.id, { deviceName: 'phone' })
    await grantAppAccess(user.id, 'user', 'posts')
    await createSession(user.id)
    const magic = generateToken()
    const invite = generateToken()
    const reset = generateToken()
    const expiresAt = new Date(Date.now() + 60_000)
    await MagicLinkDB.create(user.id, hashToken(magic), expiresAt)
    await InviteDB.create(user.id, hashToken(invite), expiresAt)
    await PasswordResetDB.create(user.id, hashToken(reset), expiresAt)

    expect((await requestChange(cookie, user.id, 'next@example.com')).status).toBe(200)
    await saveChallenge('emailchg-reauth-ok', '1', admin.id)
    const beforeReceipt = await app.request(`/admin/email-changes/${user.id}/commit`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: '{}'
    })
    expect(beforeReceipt.status).toBe(400)

    const verify = await app.request('/auth/email-change/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: requestToken() })
    })
    expect(verify.status).toBe(200)

    await saveChallenge('reauth-ok', '1', admin.id)
    const wrongKind = await app.request(`/admin/email-changes/${user.id}/commit`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: '{}'
    })
    expect(wrongKind.status).toBe(403)

    await saveChallenge('emailchg-reauth-ok', '1', admin.id)
    const commit = await app.request(`/admin/email-changes/${user.id}/commit`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'attacker@example.com' })
    })
    expect(commit.status).toBe(200)
    await expect(commit.json()).resolves.toMatchObject({
      ok: true,
      email: 'next@example.com',
      selfRevoked: false
    })

    const updated = await prisma.user.findUnique({ where: { id: user.id } })
    expect(updated?.email).toBe('next@example.com')
    expect(updated?.role).toBe('user')
    expect(await prisma.webAuthnCredential.count({ where: { userId: user.id } })).toBe(1)
    expect(
      await prisma.appGrant.findUnique({
        where: { userId_appId: { userId: user.id, appId: 'posts' } }
      })
    ).toMatchObject({ permission: 'user' })
    expect(await SessionDB.countForUser(user.id)).toBe(0)
    expect(await SessionDB.countForUser(admin.id)).toBe(1)
    expect(await MagicLinkDB.findValidByTokenHash(hashToken(magic))).toBeNull()
    expect(await InviteDB.findValidByTokenHash(hashToken(invite))).toBeNull()
    expect(await PasswordResetDB.findValidByTokenHash(hashToken(reset))).toBeNull()
    expect(await EmailChangeDB.findForUser(user.id)).toBeNull()
    expect(sendEmailChangeNoticeMail).toHaveBeenCalledWith({
      to: 'member@example.com',
      name: 'Member'
    })
  })

  it('revokes the admin session when they change their own address', async () => {
    const { user, cookie } = await adminCookie()
    expect((await requestChange(cookie, user.id, 'admin-next@example.com')).status).toBe(200)
    const verify = await app.request('/auth/email-change/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: requestToken() })
    })
    expect(verify.status).toBe(200)

    await saveChallenge('emailchg-reauth-ok', '1', user.id)
    const commit = await app.request(`/admin/email-changes/${user.id}/commit`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: '{}'
    })
    expect(commit.status).toBe(200)
    await expect(commit.json()).resolves.toMatchObject({ selfRevoked: true })
    expect(commit.headers.getSetCookie().some((header) => header.includes('Max-Age=0'))).toBe(true)
    expect(await SessionDB.countForUser(user.id)).toBe(0)

    const me = await app.request('/auth/me', { headers: { Cookie: cookie } })
    await expect(me.json()).resolves.toEqual({ user: null })
    expect(sendEmailChangeNoticeMail).toHaveBeenCalledWith({
      to: 'admin@example.com',
      name: 'Admin User'
    })
  })
})

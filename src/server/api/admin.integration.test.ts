import { beforeEach, describe, expect, it, vi } from 'vitest'
import app from '@/server/api/app'
import { authEnv } from '@/server/auth/env'
import { sendUserInviteMail } from '@/server/auth/mail'
import { createSession } from '@/server/auth/session'
import { PostDB } from '@/server/db'
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

describe('admin integration', () => {
  beforeEach(async () => {
    await resetDatabase()
    vi.clearAllMocks()
  })

  it('lists all users for admin', async () => {
    const { cookie } = await adminCookie()
    await createTestUser({ email: 'member@example.com', name: 'Member' })

    const res = await app.request('/admin/users', {
      headers: { Cookie: cookie }
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(2)
    expect(body.map((u: { email: string }) => u.email).sort()).toEqual([
      'admin@example.com',
      'member@example.com'
    ])
  })

  it('returns 403 for non-admin users', async () => {
    const { user } = await createTestUser({ role: 'user' })
    await insertPasskeyFixture(user.id)
    const { token } = await createSession(user.id)

    const res = await app.request('/admin/users', {
      headers: { Cookie: sessionCookieHeader(token) }
    })

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({
      error: '管理者権限が必要です'
    })
  })

  it('creates a new user and sends a magic link email', async () => {
    const { cookie } = await adminCookie()

    const res = await app.request('/admin/users', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'invitee@example.com',
        name: 'Invitee'
      })
    })

    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toMatchObject({
      email: 'invitee@example.com',
      name: 'Invitee',
      role: 'user'
    })

    expect(sendUserInviteMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'invitee@example.com',
        name: 'Invitee',
        token: expect.any(String)
      })
    )
  })

  it('rejects duplicate email addresses with 409', async () => {
    const { cookie } = await adminCookie()
    await createTestUser({ email: 'dup@example.com' })

    const res = await app.request('/admin/users', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'dup@example.com',
        name: 'Duplicate'
      })
    })

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({
      error: 'このメールアドレスは既に登録されています'
    })
  })

  it('validates required fields (email, name)', async () => {
    const { cookie } = await adminCookie()

    const res = await app.request('/admin/users', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email: '', name: '' })
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: 'メールアドレスと名前は必須です'
    })
  })

  it('defaults role to user and accepts admin role', async () => {
    const { cookie } = await adminCookie()

    const userRes = await app.request('/admin/users', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'role-user@example.com',
        name: 'Role User'
      })
    })
    expect(userRes.status).toBe(201)
    await expect(userRes.json()).resolves.toMatchObject({ role: 'user' })

    const adminRes = await app.request('/admin/users', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'role-admin@example.com',
        name: 'Role Admin',
        role: 'admin'
      })
    })
    expect(adminRes.status).toBe(201)
    await expect(adminRes.json()).resolves.toMatchObject({ role: 'admin' })
  })

  it('verifies sendUserInviteMail was called with correct params', async () => {
    const { cookie } = await adminCookie()

    await app.request('/admin/users', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'mail-check@example.com',
        name: 'Mail Check'
      })
    })

    expect(sendUserInviteMail).toHaveBeenCalledTimes(1)
    const arg = vi.mocked(sendUserInviteMail).mock.calls[0]?.[0]
    expect(arg).toMatchObject({
      to: 'mail-check@example.com',
      name: 'Mail Check'
    })
    expect(arg?.token.length).toBeGreaterThan(10)
  })

  it('returns correct counts for users, admins, posts, and published posts', async () => {
    const { cookie, user: admin } = await adminCookie()
    const { user: member } = await createTestUser({ email: 'stats-user@example.com' })

    await PostDB.create({
      title: 'Published',
      content: 'ok',
      published: true,
      authorId: member.id
    })
    await PostDB.create({
      title: 'Draft',
      content: 'draft',
      published: false,
      authorId: admin.id
    })

    const res = await app.request('/admin/stats', {
      headers: { Cookie: cookie }
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      userCount: 2,
      adminCount: 1,
      postCount: 2,
      publishedPostCount: 1
    })
  })

  it('requires authentication for all endpoints', async () => {
    const usersRes = await app.request('/admin/users')
    const statsRes = await app.request('/admin/stats')
    const createRes = await app.request('/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'x@example.com', name: 'X' })
    })

    expect(usersRes.status).toBe(401)
    expect(statsRes.status).toBe(401)
    expect(createRes.status).toBe(401)
  })

  it('requires admin role for all endpoints', async () => {
    const { user } = await createTestUser({ role: 'user' })
    await insertPasskeyFixture(user.id)
    const { token } = await createSession(user.id)
    const cookie = sessionCookieHeader(token)

    const usersRes = await app.request('/admin/users', { headers: { Cookie: cookie } })
    const statsRes = await app.request('/admin/stats', { headers: { Cookie: cookie } })
    const createRes = await app.request('/admin/users', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email: 'x@example.com', name: 'X' })
    })

    expect(usersRes.status).toBe(403)
    expect(statsRes.status).toBe(403)
    expect(createRes.status).toBe(403)
  })

  it('requires passkey setup for all endpoints', async () => {
    const { user } = await createTestUser({ role: 'admin' })
    const { token } = await createSession(user.id)
    const cookie = sessionCookieHeader(token)

    const usersRes = await app.request('/admin/users', { headers: { Cookie: cookie } })
    const statsRes = await app.request('/admin/stats', { headers: { Cookie: cookie } })
    const createRes = await app.request('/admin/users', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email: 'x@example.com', name: 'X' })
    })

    expect(usersRes.status).toBe(403)
    expect(statsRes.status).toBe(403)
    expect(createRes.status).toBe(403)
    await expect(usersRes.json()).resolves.toMatchObject({
      error: '先にパスキーを登録してください'
    })
  })

  it('registers a participating app and refuses to delete the auth server', async () => {
    const { user, cookie } = await adminCookie()
    await grantAppAccess(user.id)
    const parent = authEnv.parentDomain()
    const origin = parent === 'localhost' ? 'http://app.localhost:4000' : `https://app.${parent}`

    const created = await app.request('/admin/apps', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        id: 'posts',
        name: '投稿',
        origin,
        redirectUris: [`${origin}/callback`]
      })
    })
    expect(created.status).toBe(201)

    const removed = await app.request(`/admin/apps/${authEnv.appId()}`, {
      method: 'DELETE',
      headers: { Cookie: cookie }
    })
    expect(removed.status).toBe(400)
    await expect(removed.json()).resolves.toMatchObject({
      error: '認証サーバーは削除できません'
    })
  })
})

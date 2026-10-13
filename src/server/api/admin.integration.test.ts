import { beforeEach, describe, expect, it, vi } from 'vitest'
import app from '@/server/api/app'
import { authEnv } from '@/server/auth/env'
import { sendUserInviteMail } from '@/server/auth/mail'
import { createSession } from '@/server/auth/session'
import { prisma } from '@/lib/prisma'
import { createTestUser, insertPasskeyFixture, resetDatabase, sessionCookieHeader } from '@/test/db'

async function ensureAuthApp() {
  const origin = new URL(authEnv.origin()).origin
  await prisma.app.upsert({
    where: { id: authEnv.appId() },
    create: {
      id: authEnv.appId(),
      name: '認証サーバー',
      origin,
      redirectUris: [],
      defaultPermission: null
    },
    update: {}
  })
}

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

  it('returns correct counts for users and admins', async () => {
    const { cookie } = await adminCookie()
    await createTestUser({ email: 'stats-user@example.com' })

    const res = await app.request('/admin/stats', {
      headers: { Cookie: cookie }
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      userCount: 2,
      adminCount: 1
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
    const { cookie } = await adminCookie()
    await ensureAuthApp()
    const parent = authEnv.parentDomain()
    const origin = parent === 'localhost' ? 'http://app.localhost:4000' : `https://app.${parent}`

    const missingDefault = await app.request('/admin/apps', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        id: 'board',
        name: '参加アプリ',
        origin,
        redirectUris: [`${origin}/callback`]
      })
    })
    expect(missingDefault.status).toBe(400)

    const created = await app.request('/admin/apps', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        id: 'board',
        name: '参加アプリ',
        origin,
        redirectUris: [`${origin}/callback`],
        defaultPermission: 'user'
      })
    })
    expect(created.status).toBe(201)
    await expect(created.json()).resolves.toMatchObject({
      id: 'board',
      defaultPermission: 'user',
      isAuthServer: false
    })

    const listed = await app.request('/admin/apps', { headers: { Cookie: cookie } })
    const apps = (await listed.json()) as Array<{ id: string; isAuthServer: boolean }>
    expect(apps.find((item) => item.id === authEnv.appId())?.isAuthServer).toBe(true)

    const kept = await app.request(`/admin/apps/board`, {
      method: 'PATCH',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: '参加アプリ改',
        redirectUris: [`${origin}/callback`]
      })
    })
    expect(kept.status).toBe(200)
    await expect(kept.json()).resolves.toMatchObject({
      name: '参加アプリ改',
      defaultPermission: 'user'
    })

    const authDefault = await app.request(`/admin/apps/${authEnv.appId()}`, {
      method: 'PATCH',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: '認証サーバー',
        redirectUris: [],
        defaultPermission: 'user'
      })
    })
    expect(authDefault.status).toBe(400)

    const removed = await app.request(`/admin/apps/${authEnv.appId()}`, {
      method: 'DELETE',
      headers: { Cookie: cookie }
    })
    expect(removed.status).toBe(400)
    await expect(removed.json()).resolves.toMatchObject({
      error: '認証サーバーは削除できません'
    })
  })

  it('upserts a none grant and refuses grants for the auth server', async () => {
    const { user, cookie } = await adminCookie()
    await ensureAuthApp()
    const parent = authEnv.parentDomain()
    const origin = parent === 'localhost' ? 'http://app.localhost:4000' : `https://app.${parent}`
    await prisma.app.create({
      data: {
        id: 'board',
        name: '参加アプリ',
        origin,
        redirectUris: [`${origin}/callback`],
        defaultPermission: null
      }
    })

    const rejected = await app.request('/admin/grants', {
      method: 'PUT',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        userId: user.id,
        appId: authEnv.appId(),
        permission: 'user'
      })
    })
    expect(rejected.status).toBe(400)

    const saved = await app.request('/admin/grants', {
      method: 'PUT',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        userId: user.id,
        appId: 'board',
        permission: 'none'
      })
    })
    expect(saved.status).toBe(200)
    await expect(saved.json()).resolves.toMatchObject({
      userId: user.id,
      appId: 'board',
      permission: 'none'
    })

    await prisma.appGrant.create({
      data: { userId: user.id, appId: authEnv.appId(), permission: 'admin' }
    })
    const listed = await app.request('/admin/grants', { headers: { Cookie: cookie } })
    const grants = (await listed.json()) as Array<{ appId: string; permission: string }>
    expect(grants).toEqual([expect.objectContaining({ appId: 'board', permission: 'none' })])

    const deleted = await app.request(`/admin/grants/${user.id}/board`, {
      method: 'DELETE',
      headers: { Cookie: cookie }
    })
    expect(deleted.status).toBe(200)
    expect(await prisma.appGrant.count({ where: { appId: 'board' } })).toBe(0)
  })
})

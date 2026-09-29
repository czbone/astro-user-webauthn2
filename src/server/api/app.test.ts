import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {}
}))

vi.mock('@/lib/redis', () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    incr: vi.fn(),
    expire: vi.fn(),
    pexpire: vi.fn(),
    pttl: vi.fn(),
    sadd: vi.fn(),
    srem: vi.fn(),
    smembers: vi.fn(),
    scard: vi.fn(),
    pipeline: () => ({
      set() {
        return this
      },
      del() {
        return this
      },
      sadd() {
        return this
      },
      srem() {
        return this
      },
      expire() {
        return this
      },
      exec: vi.fn().mockResolvedValue([])
    }),
    on: vi.fn()
  }
}))

vi.mock('@/server/auth/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ ok: true })
}))

vi.mock('@/server/db', () => ({
  UserDB: {
    findByEmail: vi.fn(),
    countCredentials: vi.fn(),
    count: vi.fn(),
    countAdmins: vi.fn(),
    list: vi.fn()
  },
  PostDB: {
    listForViewer: vi.fn(),
    count: vi.fn(),
    countPublished: vi.fn()
  },
  SessionDB: {
    findValidByTokenHash: vi.fn(),
    create: vi.fn(),
    touch: vi.fn(),
    revoke: vi.fn(),
    revokeAllForUser: vi.fn()
  },
  CredentialDB: {},
  InviteDB: {},
  PasswordResetDB: {
    invalidatePendingForUser: vi.fn(),
    create: vi.fn()
  },
  MagicLinkDB: {
    invalidatePendingForUser: vi.fn(),
    create: vi.fn(),
    consume: vi.fn()
  }
}))

vi.mock('@/server/auth/mail', () => ({
  sendPasswordResetMail: vi.fn(),
  sendUserInviteMail: vi.fn()
}))

const { default: app } = await import('@/server/api/app')
const { UserDB, PasswordResetDB } = await import('@/server/db')
const { sendPasswordResetMail } = await import('@/server/auth/mail')

describe('API app smoke', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('GET /auth/me returns null user without a session', async () => {
    const res = await app.request('/auth/me')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ user: null })
  })

  it('POST /auth/login/password rejects empty credentials', async () => {
    const res = await app.request('/auth/login/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://auth.localhost:3000' },
      body: JSON.stringify({})
    })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: 'メールアドレスとパスワードは必須です'
    })
  })

  it('GET /posts requires authentication', async () => {
    const res = await app.request('/posts')
    expect(res.status).toBe(401)
  })

  it('GET /admin/stats requires authentication', async () => {
    const res = await app.request('/admin/stats')
    expect(res.status).toBe(401)
  })

  it('POST /auth/password-reset/request always returns a generic success', async () => {
    vi.mocked(UserDB.findByEmail).mockResolvedValue(null)

    const res = await app.request('/auth/password-reset/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://auth.localhost:3000' },
      body: JSON.stringify({ email: 'nobody@example.com' })
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      message: '入力されたメールアドレスにアカウントがある場合、再設定手順を送信しました'
    })
    expect(PasswordResetDB.create).not.toHaveBeenCalled()
    expect(sendPasswordResetMail).not.toHaveBeenCalled()
  })
})

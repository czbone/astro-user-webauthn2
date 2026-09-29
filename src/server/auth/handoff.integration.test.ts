import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'
import { handleHandoff } from '@/server/auth/handoff'
import { authEnv } from '@/server/auth/env'
import { hashToken } from '@/server/auth/tokens'
import { createSession } from '@/server/auth/session'
import { RedisKeys } from '@/server/redis/keys'
import {
  createTestUser,
  grantAppAccess,
  insertPasskeyFixture,
  resetDatabase,
  sessionCookieHeader
} from '@/test/db'
import { Hono } from 'hono'

const handoffApp = new Hono()
handoffApp.get('/auth/handoff', (c) => handleHandoff(c))

function participatingApp() {
  const parent = authEnv.parentDomain()
  const origin = parent === 'localhost' ? 'http://app.localhost:4000' : `https://app.${parent}`
  return {
    origin,
    redirectUri: `${origin}/callback`
  }
}

async function authCookie() {
  const created = await createTestUser()
  await insertPasskeyFixture(created.user.id)
  await grantAppAccess(created.user.id)
  const { token } = await createSession(created.user.id)
  return { ...created, token, cookie: sessionCookieHeader(token) }
}

describe('handoff', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('issues a one-time code for a granted app', async () => {
    const { user, cookie } = await authCookie()
    const target = participatingApp()
    await prisma.app.create({
      data: {
        id: 'posts',
        name: '投稿',
        origin: target.origin,
        redirectUris: [target.redirectUri]
      }
    })
    await prisma.appGrant.create({
      data: { userId: user.id, appId: 'posts', permission: 'user' }
    })

    const res = await handoffApp.request(
      `/auth/handoff?app=posts&redirect_uri=${encodeURIComponent(target.redirectUri)}&state=state-1`,
      { headers: { Cookie: cookie } }
    )

    expect(res.status).toBe(303)
    const location = res.headers.get('location')
    expect(location?.startsWith(`${target.redirectUri}?code=`)).toBe(true)
    expect(location).toContain('state=state-1')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    expect(res.headers.get('cache-control')).toBe('no-store')

    const code = new URL(location ?? '').searchParams.get('code')
    expect(code).toBeTruthy()
    const raw = await redis.get(RedisKeys.handoff('posts', hashToken(code ?? '')))
    expect(JSON.parse(raw ?? '{}')).toMatchObject({
      userId: user.id,
      state: 'state-1',
      redirectUri: participatingApp().redirectUri
    })
  })

  it('does not create a session when the redirect URI does not match', async () => {
    const { user, cookie } = await authCookie()
    const target = participatingApp()
    await prisma.app.create({
      data: {
        id: 'posts',
        name: '投稿',
        origin: target.origin,
        redirectUris: [target.redirectUri]
      }
    })
    await prisma.appGrant.create({
      data: { userId: user.id, appId: 'posts', permission: 'user' }
    })

    const res = await handoffApp.request(
      `/auth/handoff?app=posts&redirect_uri=${encodeURIComponent(`${target.origin}/other`)}&state=state-1`,
      { headers: { Cookie: cookie } }
    )

    expect(res.status).toBe(403)
    expect(await redis.get(RedisKeys.session('posts', 'missing'))).toBeNull()
    expect(await redis.keys(RedisKeys.handoff('posts', '*'))).toEqual([])
  })

  it('sends an anonymous browser to login and keeps the handoff URL', async () => {
    const res = await handoffApp.request(
      '/auth/handoff?app=posts&redirect_uri=http%3A%2F%2Fapp.localhost%3A4000%2Fcallback&state=state-1'
    )
    expect(res.status).toBe(302)
    const location = res.headers.get('location') ?? ''
    expect(location.startsWith('/login?next=')).toBe(true)
    expect(decodeURIComponent(location.slice('/login?next='.length))).toContain('/auth/handoff?')
  })

  it('does not hand off before a passkey exists', async () => {
    const created = await createTestUser()
    await grantAppAccess(created.user.id)
    const { token } = await createSession(created.user.id)
    const res = await handoffApp.request(
      '/auth/handoff?app=posts&redirect_uri=http%3A%2F%2Fapp.localhost%3A4000%2Fcallback&state=state-1',
      { headers: { Cookie: sessionCookieHeader(token) } }
    )
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/setup-passkey')
    expect(authEnv.appId()).toBeTruthy()
  })
})

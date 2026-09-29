import { beforeEach, describe, expect, it } from 'vitest'
import app from '@/server/api/app'
import { createSession } from '@/server/auth/session'
import { PostDB } from '@/server/db'
import { authEnv } from '@/server/auth/env'
import { hashToken } from '@/server/auth/tokens'
import { redis } from '@/lib/redis'
import { RedisKeys } from '@/server/redis/keys'
import {
  createTestUser,
  grantAppAccess,
  insertPasskeyFixture,
  resetDatabase,
  sessionCookieHeader
} from '@/test/db'

async function passkeySession(input?: {
  email?: string
  role?: 'admin' | 'user'
  name?: string
  permission?: 'admin' | 'user'
}) {
  const created = await createTestUser(input)
  await insertPasskeyFixture(created.user.id)
  await grantAppAccess(created.user.id, input?.permission ?? 'user')
  const { token } = await createSession(created.user.id)
  return { ...created, cookie: sessionCookieHeader(token), token }
}

describe('posts integration', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('returns 403 when the user has not registered a passkey', async () => {
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

  it('lists posts when a passkey fixture exists for the user', async () => {
    const { cookie } = await passkeySession()

    const res = await app.request('/posts', {
      headers: { Cookie: cookie }
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })

  it('creates a published post', async () => {
    const { cookie, user } = await passkeySession()

    const res = await app.request('/posts', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: 'Hello',
        content: 'World',
        published: true
      })
    })

    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toMatchObject({
      title: 'Hello',
      content: 'World',
      published: true,
      authorId: user.id
    })
  })

  it('creates a draft post (published=false)', async () => {
    const { cookie } = await passkeySession()

    const res = await app.request('/posts', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: 'Draft',
        content: 'WIP',
        published: false
      })
    })

    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toMatchObject({
      title: 'Draft',
      published: false
    })
  })

  it('rejects posts without title (400)', async () => {
    const { cookie } = await passkeySession()

    const res = await app.request('/posts', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ title: '  ', content: 'x' })
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: 'タイトルは必須です'
    })
  })

  it('retrieves a published post for any authenticated user', async () => {
    const author = await passkeySession({ email: 'author@example.com' })
    const viewer = await passkeySession({ email: 'viewer@example.com' })
    const post = await PostDB.create({
      title: 'Public',
      content: 'ok',
      published: true,
      authorId: author.user.id
    })

    const res = await app.request(`/posts/${post.id}`, {
      headers: { Cookie: viewer.cookie }
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      id: post.id,
      title: 'Public'
    })
  })

  it('retrieves own draft for the author', async () => {
    const { cookie, user } = await passkeySession()
    const post = await PostDB.create({
      title: 'My Draft',
      content: null,
      published: false,
      authorId: user.id
    })

    const res = await app.request(`/posts/${post.id}`, {
      headers: { Cookie: cookie }
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      id: post.id,
      published: false
    })
  })

  it('retrieves any draft for an app admin', async () => {
    const author = await passkeySession({ email: 'author2@example.com' })
    const admin = await passkeySession({
      email: 'admin@example.com',
      role: 'user',
      permission: 'admin'
    })
    const post = await PostDB.create({
      title: 'Secret Draft',
      content: 'secret',
      published: false,
      authorId: author.user.id
    })

    const res = await app.request(`/posts/${post.id}`, {
      headers: { Cookie: admin.cookie }
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ id: post.id })
  })

  it("returns 404 for another user's draft (non-admin)", async () => {
    const author = await passkeySession({ email: 'author3@example.com' })
    const other = await passkeySession({ email: 'other@example.com' })
    const post = await PostDB.create({
      title: 'Private Draft',
      content: 'nope',
      published: false,
      authorId: author.user.id
    })

    const res = await app.request(`/posts/${post.id}`, {
      headers: { Cookie: other.cookie }
    })

    expect(res.status).toBe(404)
  })

  it('returns 404 for non-existent post', async () => {
    const { cookie } = await passkeySession()

    const res = await app.request('/posts/00000000-0000-0000-0000-000000000000', {
      headers: { Cookie: cookie }
    })

    expect(res.status).toBe(404)
  })

  it('updates own post successfully', async () => {
    const { cookie, user } = await passkeySession()
    const post = await PostDB.create({
      title: 'Old',
      content: 'a',
      published: false,
      authorId: user.id
    })

    const res = await app.request(`/posts/${post.id}`, {
      method: 'PATCH',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ title: 'New' })
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ title: 'New' })
  })

  it('updates title, content, and published status', async () => {
    const { cookie, user } = await passkeySession()
    const post = await PostDB.create({
      title: 'Old',
      content: 'a',
      published: false,
      authorId: user.id
    })

    const res = await app.request(`/posts/${post.id}`, {
      method: 'PATCH',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: 'Updated',
        content: 'b',
        published: true
      })
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      title: 'Updated',
      content: 'b',
      published: true
    })
  })

  it("returns 404 when updating another user's post", async () => {
    const author = await passkeySession({ email: 'author4@example.com' })
    const other = await passkeySession({ email: 'other4@example.com' })
    const post = await PostDB.create({
      title: 'Owned',
      content: null,
      published: true,
      authorId: author.user.id
    })

    const res = await app.request(`/posts/${post.id}`, {
      method: 'PATCH',
      headers: {
        Cookie: other.cookie,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ title: 'Hijack' })
    })

    expect(res.status).toBe(404)
  })

  it('returns 404 when updating non-existent post', async () => {
    const { cookie } = await passkeySession()

    const res = await app.request('/posts/00000000-0000-0000-0000-000000000000', {
      method: 'PATCH',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ title: 'Nope' })
    })

    expect(res.status).toBe(404)
  })

  it('deletes own post successfully', async () => {
    const { cookie, user } = await passkeySession()
    const post = await PostDB.create({
      title: 'Delete me',
      content: null,
      published: true,
      authorId: user.id
    })

    const res = await app.request(`/posts/${post.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie }
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      message: '投稿を削除しました'
    })

    const getRes = await app.request(`/posts/${post.id}`, {
      headers: { Cookie: cookie }
    })
    expect(getRes.status).toBe(404)
  })

  it("returns 404 when deleting another user's post", async () => {
    const author = await passkeySession({ email: 'author5@example.com' })
    const other = await passkeySession({ email: 'other5@example.com' })
    const post = await PostDB.create({
      title: 'Keep',
      content: null,
      published: true,
      authorId: author.user.id
    })

    const res = await app.request(`/posts/${post.id}`, {
      method: 'DELETE',
      headers: { Cookie: other.cookie }
    })

    expect(res.status).toBe(404)
  })

  it('returns 404 when deleting non-existent post', async () => {
    const { cookie } = await passkeySession()

    const res = await app.request('/posts/00000000-0000-0000-0000-000000000000', {
      method: 'DELETE',
      headers: { Cookie: cookie }
    })

    expect(res.status).toBe(404)
  })

  it('lists only published posts and own drafts for regular user', async () => {
    const author = await passkeySession({ email: 'list-author@example.com' })
    const other = await passkeySession({ email: 'list-other@example.com' })

    await PostDB.create({
      title: 'Public',
      content: null,
      published: true,
      authorId: other.user.id
    })
    await PostDB.create({
      title: 'Other Draft',
      content: null,
      published: false,
      authorId: other.user.id
    })
    await PostDB.create({
      title: 'My Draft',
      content: null,
      published: false,
      authorId: author.user.id
    })

    const res = await app.request('/posts', {
      headers: { Cookie: author.cookie }
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    const titles = body.map((p: { title: string }) => p.title).sort()
    expect(titles).toEqual(['My Draft', 'Public'])
  })

  it('returns 403 without an app grant and does not extend the session', async () => {
    const created = await createTestUser()
    await insertPasskeyFixture(created.user.id)
    const { token } = await createSession(created.user.id)
    const key = RedisKeys.session(authEnv.appId(), hashToken(token))
    await redis.expire(key, 90)
    const before = await redis.ttl(key)

    const res = await app.request('/posts', {
      headers: { Cookie: sessionCookieHeader(token) }
    })

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({
      error: 'このアプリを利用する権限がありません'
    })
    const after = await redis.ttl(key)
    expect(after).toBeLessThanOrEqual(before)
  })

  it("lists all posts including others' drafts for an app admin", async () => {
    const author = await passkeySession({ email: 'admin-list-author@example.com' })
    const admin = await passkeySession({
      email: 'admin-list@example.com',
      role: 'user',
      permission: 'admin'
    })

    await PostDB.create({
      title: 'Hidden Draft',
      content: null,
      published: false,
      authorId: author.user.id
    })
    await PostDB.create({
      title: 'Visible',
      content: null,
      published: true,
      authorId: author.user.id
    })

    const res = await app.request('/posts', {
      headers: { Cookie: admin.cookie }
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    const titles = body.map((p: { title: string }) => p.title).sort()
    expect(titles).toEqual(['Hidden Draft', 'Visible'])
  })
})

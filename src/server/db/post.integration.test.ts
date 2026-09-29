import { beforeEach, describe, expect, it } from 'vitest'
import PostDB from '@/server/db/post'
import { createTestUser, resetDatabase } from '@/test/db'

describe('PostDB', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('creates a post', async () => {
    const { user } = await createTestUser()
    const post = await PostDB.create({
      title: 'Title',
      content: 'Body',
      published: true,
      authorId: user.id
    })

    expect(post).toMatchObject({
      title: 'Title',
      content: 'Body',
      published: true,
      authorId: user.id
    })
  })

  it('lists published posts and own drafts for regular viewer', async () => {
    const author = await createTestUser({ email: 'author@example.com' })
    const other = await createTestUser({ email: 'other@example.com' })

    await PostDB.create({
      title: 'Public',
      published: true,
      authorId: other.user.id
    })
    await PostDB.create({
      title: 'Other Draft',
      published: false,
      authorId: other.user.id
    })
    await PostDB.create({
      title: 'My Draft',
      published: false,
      authorId: author.user.id
    })

    const list = await PostDB.listForViewer({ id: author.user.id, permission: 'user' })
    expect(list.map((p) => p.title).sort()).toEqual(['My Draft', 'Public'])
  })

  it('lists all posts for admin viewer', async () => {
    const author = await createTestUser({ email: 'author2@example.com' })
    await PostDB.create({
      title: 'Draft',
      published: false,
      authorId: author.user.id
    })
    await PostDB.create({
      title: 'Public',
      published: true,
      authorId: author.user.id
    })

    const list = await PostDB.listForViewer({ id: 'admin-id', permission: 'admin' })
    expect(list).toHaveLength(2)
  })

  it('getByIdForViewer respects visibility rules', async () => {
    const author = await createTestUser({ email: 'author3@example.com' })
    const other = await createTestUser({ email: 'other3@example.com' })
    const draft = await PostDB.create({
      title: 'Draft',
      published: false,
      authorId: author.user.id
    })

    expect(
      await PostDB.getByIdForViewer(draft.id, { id: author.user.id, permission: 'user' })
    ).toBeTruthy()
    expect(
      await PostDB.getByIdForViewer(draft.id, { id: other.user.id, permission: 'user' })
    ).toBeNull()
    expect(
      await PostDB.getByIdForViewer(draft.id, { id: other.user.id, permission: 'admin' })
    ).toBeTruthy()
  })

  it('updates and deletes owned posts only', async () => {
    const author = await createTestUser({ email: 'author4@example.com' })
    const other = await createTestUser({ email: 'other4@example.com' })
    const post = await PostDB.create({
      title: 'Owned',
      published: false,
      authorId: author.user.id
    })

    expect(await PostDB.updateOwned(post.id, other.user.id, { title: 'Nope' })).toBeNull()

    const updated = await PostDB.updateOwned(post.id, author.user.id, {
      title: 'Updated',
      published: true
    })
    expect(updated).toMatchObject({ title: 'Updated', published: true })

    expect(await PostDB.deleteOwned(post.id, other.user.id)).toBe(false)
    expect(await PostDB.deleteOwned(post.id, author.user.id)).toBe(true)
  })

  it('counts total and published posts', async () => {
    const { user } = await createTestUser()
    await PostDB.create({ title: 'A', published: true, authorId: user.id })
    await PostDB.create({ title: 'B', published: false, authorId: user.id })

    expect(await PostDB.count()).toBe(2)
    expect(await PostDB.countPublished()).toBe(1)
  })
})

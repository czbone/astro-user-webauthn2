import { beforeEach, describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '@/server/auth/password'
import UserDB from '@/server/db/user'
import { createTestUser, insertPasskeyFixture, resetDatabase } from '@/test/db'

describe('UserDB', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('finds user by email (case-insensitive)', async () => {
    const { user } = await createTestUser({ email: 'Case@Example.com' })

    const found = await UserDB.findByEmail('case@example.com')
    expect(found?.id).toBe(user.id)
    expect(found?.email).toBe('case@example.com')
  })

  it('creates user with hashed password', async () => {
    const passwordHash = await hashPassword('secret-password')
    const user = await UserDB.create({
      email: 'created@example.com',
      password: passwordHash,
      name: 'Created',
      role: 'user'
    })

    expect(user.email).toBe('created@example.com')
    expect(await verifyPassword('secret-password', user.password)).toBe(true)
  })

  it('updates password', async () => {
    const { user } = await createTestUser()
    const next = await hashPassword('updated-password')
    await UserDB.updatePassword(user.id, next)

    const updated = await UserDB.findById(user.id)
    expect(await verifyPassword('updated-password', updated!.password)).toBe(true)
  })

  it('counts credentials for user', async () => {
    const { user } = await createTestUser()
    expect(await UserDB.countCredentials(user.id)).toBe(0)

    await insertPasskeyFixture(user.id)
    await insertPasskeyFixture(user.id)
    expect(await UserDB.countCredentials(user.id)).toBe(2)
  })

  it('lists all users', async () => {
    await createTestUser({ email: 'a@example.com', name: 'A' })
    await createTestUser({ email: 'b@example.com', name: 'B' })

    const list = await UserDB.list()
    expect(list).toHaveLength(2)
    expect(list.map((u) => u.email).sort()).toEqual(['a@example.com', 'b@example.com'])
  })

  it('counts total users and admins', async () => {
    await createTestUser({ role: 'user' })
    await createTestUser({ email: 'admin@example.com', role: 'admin' })

    expect(await UserDB.count()).toBe(2)
    expect(await UserDB.countAdmins()).toBe(1)
  })
})

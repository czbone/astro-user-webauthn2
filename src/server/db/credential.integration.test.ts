import { beforeEach, describe, expect, it } from 'vitest'
import CredentialDB from '@/server/db/credential'
import { createTestUser, insertPasskeyFixture, resetDatabase } from '@/test/db'

describe('CredentialDB', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('lists credentials by user id', async () => {
    const { user } = await createTestUser()
    await insertPasskeyFixture(user.id, { deviceName: 'A' })
    await insertPasskeyFixture(user.id, { deviceName: 'B' })

    const list = await CredentialDB.listByUserId(user.id)
    expect(list).toHaveLength(2)
  })

  it('finds credential by credentialId', async () => {
    const { user } = await createTestUser()
    const created = await insertPasskeyFixture(user.id)

    const found = await CredentialDB.findByCredentialId(created.credentialId)
    expect(found?.id).toBe(created.id)
  })

  it('creates a credential', async () => {
    const { user } = await createTestUser()
    const created = await CredentialDB.create({
      userId: user.id,
      credentialId: 'cred-create-1',
      publicKey: new Uint8Array([1, 2, 3]),
      counter: 0n,
      transports: JSON.stringify(['internal']),
      deviceName: 'Phone'
    })

    expect(created.deviceName).toBe('Phone')
    expect(await CredentialDB.countForUser(user.id)).toBe(1)
  })

  it('detects duplicate device names for the same user only', async () => {
    const owner = await createTestUser({ email: 'owner@example.com' })
    const other = await createTestUser({ email: 'other@example.com' })
    await insertPasskeyFixture(owner.user.id, { deviceName: 'Phone' })
    await insertPasskeyFixture(other.user.id, { deviceName: 'Phone' })

    expect(CredentialDB.normalizeDeviceName('  Phone  ')).toBe('Phone')
    expect(CredentialDB.normalizeDeviceName('   ')).toBeNull()
    expect(await CredentialDB.existsByUserIdAndDeviceName(owner.user.id, 'Phone')).toBe(true)
    expect(await CredentialDB.existsByUserIdAndDeviceName(owner.user.id, 'Tablet')).toBe(false)
    expect(await CredentialDB.existsByUserIdAndDeviceName(other.user.id, 'Phone')).toBe(true)
  })

  it('updates counter and lastUsedAt', async () => {
    const { user } = await createTestUser()
    const cred = await insertPasskeyFixture(user.id)
    expect(cred.lastUsedAt).toBeNull()

    await CredentialDB.updateCounter(cred.id, 5n)
    const updated = await CredentialDB.findByCredentialId(cred.credentialId)
    expect(updated?.counter).toBe(5n)
    expect(updated?.lastUsedAt).toBeInstanceOf(Date)
  })

  it('deletes a credential for the owning user only', async () => {
    const owner = await createTestUser({ email: 'owner@example.com' })
    const other = await createTestUser({ email: 'other@example.com' })
    const cred = await insertPasskeyFixture(owner.user.id)

    const foreign = await CredentialDB.deleteForUser(cred.id, other.user.id)
    expect(foreign.count).toBe(0)
    expect(await CredentialDB.countForUser(owner.user.id)).toBe(1)

    const owned = await CredentialDB.deleteForUser(cred.id, owner.user.id)
    expect(owned.count).toBe(1)
    expect(await CredentialDB.countForUser(owner.user.id)).toBe(0)
  })

  it('deletes all credentials for a user', async () => {
    const { user } = await createTestUser()
    await insertPasskeyFixture(user.id)
    await insertPasskeyFixture(user.id)

    await CredentialDB.deleteAllForUser(user.id)
    expect(await CredentialDB.countForUser(user.id)).toBe(0)
  })
})

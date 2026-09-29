import { prisma } from '@/lib/prisma'

class CredentialDB {
  async listByUserId(userId: string) {
    return prisma.webAuthnCredential.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    })
  }

  async findByCredentialId(credentialId: string) {
    return prisma.webAuthnCredential.findUnique({
      where: { credentialId }
    })
  }

  normalizeDeviceName(raw: unknown): string | null {
    if (raw == null) return null
    const name = String(raw).trim()
    return name.length > 0 ? name : null
  }

  async existsByUserIdAndDeviceName(userId: string, deviceName: string) {
    const found = await prisma.webAuthnCredential.findFirst({
      where: { userId, deviceName },
      select: { id: true }
    })
    return Boolean(found)
  }

  async create(data: {
    userId: string
    credentialId: string
    publicKey: Uint8Array
    counter: bigint
    transports: string | null
    deviceName: string | null
  }) {
    return prisma.webAuthnCredential.create({
      data: {
        userId: data.userId,
        credentialId: data.credentialId,
        publicKey: Buffer.from(data.publicKey),
        counter: data.counter,
        transports: data.transports,
        deviceName: data.deviceName
      }
    })
  }

  async updateCounter(id: string, counter: bigint) {
    return prisma.webAuthnCredential.update({
      where: { id },
      data: {
        counter,
        lastUsedAt: new Date()
      }
    })
  }

  async deleteForUser(id: string, userId: string) {
    return prisma.webAuthnCredential.deleteMany({
      where: { id, userId }
    })
  }

  async deleteAllForUser(userId: string) {
    return prisma.webAuthnCredential.deleteMany({ where: { userId } })
  }

  async countForUser(userId: string) {
    return prisma.webAuthnCredential.count({ where: { userId } })
  }
}

export default new CredentialDB()

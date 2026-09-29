import { prisma } from '@/lib/prisma'

export type AppPermission = 'admin' | 'user'

export type AppGrantRecord = {
  id: string
  userId: string
  appId: string
  permission: string
  createdAt: Date
  updatedAt: Date
}

class AppGrantDB {
  async findByUserAndApp(userId: string, appId: string): Promise<AppGrantRecord | null> {
    return prisma.appGrant.findUnique({
      where: { userId_appId: { userId, appId } }
    })
  }

  async list(): Promise<AppGrantRecord[]> {
    return prisma.appGrant.findMany({ orderBy: { createdAt: 'asc' } })
  }

  async upsert(userId: string, appId: string, permission: AppPermission): Promise<AppGrantRecord> {
    return prisma.appGrant.upsert({
      where: { userId_appId: { userId, appId } },
      create: { userId, appId, permission },
      update: { permission }
    })
  }

  async delete(userId: string, appId: string): Promise<boolean> {
    const existing = await this.findByUserAndApp(userId, appId)
    if (!existing) return false
    await prisma.appGrant.delete({ where: { id: existing.id } })
    return true
  }
}

export default new AppGrantDB()

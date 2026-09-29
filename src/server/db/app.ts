import { prisma } from '@/lib/prisma'

export type AppRecord = {
  id: string
  name: string
  origin: string
  redirectUris: string[]
  createdAt: Date
  updatedAt: Date
}

class AppDB {
  async list(): Promise<AppRecord[]> {
    return prisma.app.findMany({ orderBy: { createdAt: 'asc' } })
  }

  async findById(id: string): Promise<AppRecord | null> {
    return prisma.app.findUnique({ where: { id } })
  }

  async create(data: {
    id: string
    name: string
    origin: string
    redirectUris: string[]
  }): Promise<AppRecord> {
    return prisma.app.create({ data })
  }

  async updateDetails(
    id: string,
    data: { name: string; redirectUris: string[] }
  ): Promise<AppRecord> {
    return prisma.app.update({
      where: { id },
      data
    })
  }

  async delete(id: string): Promise<void> {
    await prisma.app.delete({ where: { id } })
  }
}

export default new AppDB()

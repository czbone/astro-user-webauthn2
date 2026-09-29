import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import 'dotenv/config'
import { parseDbLogLevel } from '@/server/db-log'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set')
}

const adapter = new PrismaPg(databaseUrl)
const { log } = parseDbLogLevel(process.env.DB_LOG_LEVEL, process.env.NODE_ENV === 'production')

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

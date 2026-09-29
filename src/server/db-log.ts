export const DB_LOG_LEVELS = ['silent', 'error', 'warn', 'info', 'query'] as const

export type DbLogLevel = (typeof DB_LOG_LEVELS)[number]

export type PrismaLogLevel = 'query' | 'info' | 'warn' | 'error'

const LOG_BY_LEVEL: Record<DbLogLevel, PrismaLogLevel[]> = {
  silent: [],
  error: ['error'],
  warn: ['error', 'warn'],
  info: ['error', 'warn', 'info'],
  query: ['error', 'warn', 'info', 'query']
}

export function isDbLogLevel(value: string): value is DbLogLevel {
  return (DB_LOG_LEVELS as readonly string[]).includes(value.trim().toLowerCase())
}

export function parseDbLogLevel(
  raw: string | undefined,
  production: boolean
): { level: DbLogLevel; log: PrismaLogLevel[] } {
  const trimmed = raw?.trim()
  if (!trimmed) {
    const level: DbLogLevel = production ? 'warn' : 'query'
    return { level, log: LOG_BY_LEVEL[level] }
  }

  const normalized = trimmed.toLowerCase()
  if (!isDbLogLevel(normalized)) {
    throw new Error(`DB_LOG_LEVEL の値が不正です: ${raw}（silent / error / warn / info / query）`)
  }

  return { level: normalized, log: LOG_BY_LEVEL[normalized] }
}

import { randomBytes } from 'node:crypto'
import { authEnv } from '@/server/auth/env'
import { hashPassword } from '@/server/auth/password'
import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'
import { redisKeyPrefix } from '@/server/auth/redis-env'
import UserDB from '@/server/db/user'

export async function resetRedis() {
  const prefix = redisKeyPrefix()
  if (!prefix) {
    await redis.flushdb()
    return
  }

  let cursor = '0'
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200)
    cursor = next
    if (keys.length > 0) {
      await redis.del(...keys)
    }
  } while (cursor !== '0')
}

export async function resetDatabase() {
  await prisma.app.deleteMany()
  await prisma.user.deleteMany()
  await resetRedis()
}

export async function createTestUser(input?: {
  email?: string
  password?: string
  name?: string
  role?: 'admin' | 'user'
}) {
  const password = input?.password ?? 'test-password-123'
  const email = input?.email ?? `user-${randomBytes(6).toString('hex')}@example.com`
  const user = await UserDB.create({
    email,
    password: await hashPassword(password),
    name: input?.name ?? 'Test User',
    role: input?.role ?? 'user'
  })
  return { user, password, email }
}

/** Fixture only — does not exercise WebAuthn registration. */
export async function insertPasskeyFixture(
  userId: string,
  input?: { deviceName?: string; transports?: string | null }
) {
  return prisma.webAuthnCredential.create({
    data: {
      userId,
      credentialId: `fixture-${randomBytes(16).toString('base64url')}`,
      publicKey: Buffer.from('integration-test-public-key'),
      counter: 0n,
      deviceName: input?.deviceName ?? null,
      transports: input?.transports ?? null
    }
  })
}

export async function grantAppAccess(
  userId: string,
  permission: 'admin' | 'user' = 'user',
  appId = authEnv.appId()
) {
  const origin = new URL(authEnv.origin()).origin
  await prisma.app.upsert({
    where: { id: appId },
    create: {
      id: appId,
      name: '認証サーバー',
      origin,
      redirectUris: []
    },
    update: {}
  })
  await prisma.appGrant.upsert({
    where: { userId_appId: { userId, appId } },
    create: { userId, appId, permission },
    update: { permission }
  })
}

export function sessionCookieHeader(token: string): string {
  return `__Host-session=${encodeURIComponent(token)}`
}

export function sessionCookieFromResponse(res: Response): string | null {
  const headers = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
  const candidates =
    headers.length > 0
      ? headers
      : [res.headers.get('set-cookie')].filter((value): value is string => Boolean(value))

  let token: string | null = null
  for (const header of candidates) {
    const match = /(?:^|;\s*)__Host-session=([^;]+)/i.exec(header)
    if (match?.[1]) {
      token = decodeURIComponent(match[1])
    }
  }
  return token
}

import 'dotenv/config'
import { vi } from 'vitest'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
if (!testDatabaseUrl) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Integration tests require a dedicated database URL.'
  )
}

process.env.DATABASE_URL = testDatabaseUrl
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379/'
process.env.REDIS_KEY_PREFIX = process.env.REDIS_KEY_PREFIX || `astro-webauthn-test:${process.pid}:`

// Hono 4 の request はプロトタイプではなくインスタンスフィールドなので、生成後に差し替える。
vi.mock('hono', async (importOriginal) => {
  const actual = await importOriginal<typeof import('hono')>()
  const { authServerOrigin } = await import('@/server/auth/app-registration')

  function ensureOrigin(
    input: string | URL | Request,
    requestInit?: RequestInit
  ): RequestInit | undefined {
    const method = (
      requestInit?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase()
    if (method === 'GET' || method === 'HEAD') return requestInit

    const headers = new Headers(
      requestInit?.headers ?? (input instanceof Request ? input.headers : undefined)
    )
    if (headers.get('x-test-omit-origin') === '1') {
      headers.delete('x-test-omit-origin')
    } else if (!headers.has('origin')) {
      headers.set('origin', authServerOrigin())
    }
    return { ...requestInit, headers }
  }

  class TestHono extends actual.Hono {
    constructor(...args: ConstructorParameters<typeof actual.Hono>) {
      super(...args)
      const originalRequest = this.request
      this.request = (input, requestInit, env, executionCtx) =>
        originalRequest(input, ensureOrigin(input, requestInit), env, executionCtx)
    }
  }

  return {
    ...actual,
    Hono: TestHono
  }
})

vi.mock('@/server/auth/mail', () => ({
  sendPasswordResetMail: vi.fn(),
  sendUserInviteMail: vi.fn(),
  sendDeviceInviteMail: vi.fn()
}))

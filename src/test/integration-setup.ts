import 'dotenv/config'
import { Hono } from 'hono'
import { vi } from 'vitest'
import { authServerOrigin } from '@/server/auth/app-registration'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
if (!testDatabaseUrl) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Integration tests require a dedicated database URL.'
  )
}

process.env.DATABASE_URL = testDatabaseUrl
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379/'
process.env.REDIS_KEY_PREFIX = process.env.REDIS_KEY_PREFIX || `astro-webauthn-test:${process.pid}:`

const originalRequest = Hono.prototype.request
Hono.prototype.request = function (input, requestInit, env) {
  const method = (
    requestInit?.method ?? (input instanceof Request ? input.method : 'GET')
  ).toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') {
    const headers = new Headers(
      requestInit?.headers ?? (input instanceof Request ? input.headers : undefined)
    )
    if (headers.get('x-test-omit-origin') === '1') {
      headers.delete('x-test-omit-origin')
    } else if (!headers.has('origin')) {
      headers.set('origin', authServerOrigin())
    }
    requestInit = { ...requestInit, headers }
  }
  return originalRequest.call(this, input, requestInit, env)
}

vi.mock('@/server/auth/mail', () => ({
  sendPasswordResetMail: vi.fn(),
  sendUserInviteMail: vi.fn(),
  sendDeviceInviteMail: vi.fn()
}))

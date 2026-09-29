import type { Context } from 'hono'
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from '@/server/auth/env'

function buildCookie(name: string, value: string, maxAge: number): string {
  const segments = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    'SameSite=Lax',
    'HttpOnly'
  ]
  segments.push('Secure')
  return segments.join('; ')
}

export function setSessionCookieOnContext(c: Context, token: string) {
  c.header('Set-Cookie', buildCookie(SESSION_COOKIE, token, SESSION_MAX_AGE_SECONDS), {
    append: true
  })
}

export function clearSessionCookieOnContext(c: Context) {
  c.header('Set-Cookie', buildCookie(SESSION_COOKIE, '', 0), { append: true })
}

export function getSessionTokenFromRequest(c: Context): string | null {
  const cookieHeader = c.req.header('cookie')
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === SESSION_COOKIE) {
      return decodeURIComponent(rest.join('='))
    }
  }
  return null
}

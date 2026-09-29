import type { Context } from 'hono'
import type { AstroCookies } from 'astro'
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, authEnv } from '@/server/auth/env'
import {
  clearSessionCookieOnContext,
  getSessionTokenFromRequest,
  setSessionCookieOnContext
} from '@/server/auth/cookie'
import { generateToken, hashToken } from '@/server/auth/tokens'
import SessionDB from '@/server/db/session'
import UserDB from '@/server/db/user'
import type { AuthUser } from '@/types/models'

export type ResolvedSession = {
  sessionId: string
  user: AuthUser
  token: string
  tokenHash: string
  appId: string
}

export function setSessionCookie(cookies: AstroCookies, token: string) {
  cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS
  })
}

export function clearSessionCookie(cookies: AstroCookies) {
  cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0
  })
}

export async function createSessionForApp(
  appId: string,
  userId: string
): Promise<{ token: string; sessionId: string }> {
  const token = generateToken()
  const session = await SessionDB.create(appId, userId, hashToken(token))
  return { token, sessionId: session.id }
}

export async function createSession(userId: string): Promise<{ token: string; sessionId: string }> {
  return createSessionForApp(authEnv.appId(), userId)
}

export async function readSessionFromToken(
  token: string | undefined | null
): Promise<ResolvedSession | null> {
  if (!token) return null

  const appId = authEnv.appId()
  const tokenHash = hashToken(token)
  const session = await SessionDB.findValid(appId, tokenHash)
  if (!session) return null

  const userRow = await UserDB.findById(session.userId)
  if (!userRow) {
    await SessionDB.revoke(appId, tokenHash)
    return null
  }

  const credentialCount = await UserDB.countCredentials(session.userId)
  const user: AuthUser = {
    id: userRow.id,
    email: userRow.email,
    name: userRow.name,
    role: userRow.role as 'admin' | 'user',
    hasPasskey: credentialCount > 0,
    mustSetupPasskey: credentialCount === 0
  }

  return {
    sessionId: session.id,
    user,
    token,
    tokenHash,
    appId
  }
}

export async function slideSession(session: ResolvedSession): Promise<void> {
  if (session.user.mustSetupPasskey) return
  await SessionDB.touch(session.appId, session.tokenHash, session.user.id)
}

export type ResolveSessionFromCookiesOptions = {
  /**
   * Sliding session のため Cookie の Max-Age を延長する。
   * Astro のページ frontmatter でのみ true にする（Layout / Navigation 等の
   * インポート先コンポーネントでは false。レスポンス送信後の set は警告になる）。
   */
  refreshCookie?: boolean
}

export async function resolveSessionFromCookies(
  cookies: AstroCookies,
  options: ResolveSessionFromCookiesOptions = {}
): Promise<ResolvedSession | null> {
  const { refreshCookie = true } = options
  const token = cookies.get(SESSION_COOKIE)?.value
  const resolved = await readSessionFromToken(token)
  if (!resolved) {
    if (token) clearSessionCookie(cookies)
    return null
  }
  if (resolved.user.mustSetupPasskey || !refreshCookie) {
    return resolved
  }
  await slideSession(resolved)
  setSessionCookie(cookies, resolved.token)
  return resolved
}

export async function resolveSessionFromHono(c: Context): Promise<ResolvedSession | null> {
  const token = getSessionTokenFromRequest(c)
  const resolved = await readSessionFromToken(token)
  if (!resolved && token) {
    clearSessionCookieOnContext(c)
  }
  return resolved
}

export { clearSessionCookieOnContext, getSessionTokenFromRequest, setSessionCookieOnContext }

import { createMiddleware } from 'hono/factory'
import { authServerOrigin } from '@/server/auth/app-registration'
import {
  resolveSessionFromHono,
  setSessionCookieOnContext,
  slideSession
} from '@/server/auth/session'
import { AppGrantDB } from '@/server/db'
import { authEnv } from '@/server/auth/env'
import type { AppVariables } from '@/server/middleware/types'

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export const requireAuthOrigin = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  if (!MUTATING.has(c.req.method)) {
    return next()
  }
  const origin = c.req.header('origin')
  if (!origin || origin !== authServerOrigin()) {
    return c.json({ error: 'オリジンが不正です' }, 403)
  }
  return next()
})

export const loadSession = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  const resolved = await resolveSessionFromHono(c)
  if (resolved) {
    c.set('user', resolved.user)
    c.set('sessionId', resolved.sessionId)
    c.set('sessionToken', resolved.token)
    c.set('tokenHash', resolved.tokenHash)
  }
  return next()
})

export const slideSessionAfterAuth = createMiddleware<{ Variables: AppVariables }>(
  async (c, next) => {
    const user = c.get('user')
    const token = c.get('sessionToken')
    const tokenHash = c.get('tokenHash')
    if (user && token && tokenHash && !user.mustSetupPasskey) {
      await slideSession({
        sessionId: c.get('sessionId'),
        user,
        token,
        tokenHash,
        appId: authEnv.appId()
      })
      setSessionCookieOnContext(c, token)
    }
    return next()
  }
)

export const requireAuth = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ error: 'ログインが必要です' }, 401)
  }
  return next()
})

export const requirePasskey = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ error: 'ログインが必要です' }, 401)
  }
  if (user.mustSetupPasskey) {
    return c.json({ error: '先にパスキーを登録してください' }, 403)
  }
  return next()
})

export const requireAppGrant = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ error: 'ログインが必要です' }, 401)
  }
  const grant = await AppGrantDB.findByUserAndApp(user.id, authEnv.appId())
  if (!grant || (grant.permission !== 'admin' && grant.permission !== 'user')) {
    return c.json({ error: 'このアプリを利用する権限がありません' }, 403)
  }
  c.set('appPermission', grant.permission)
  return next()
})

export const requireAdmin = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ error: 'ログインが必要です' }, 401)
  }
  if (user.mustSetupPasskey) {
    return c.json({ error: '先にパスキーを登録してください' }, 403)
  }
  if (user.role !== 'admin') {
    return c.json({ error: '管理者権限が必要です' }, 403)
  }
  return next()
})

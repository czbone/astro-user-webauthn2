import { AppDB, AppGrantDB, HandoffDB, SessionDB } from '@/server/db'
import { isAppId, isDirectChildHost, isHandoffState, safeHandoffNext } from '@/server/auth/app-host'
import { authEnv } from '@/server/auth/env'
import { authServerHost } from '@/server/auth/app-registration'
import { createSessionForApp, readSessionFromToken, slideSession } from '@/server/auth/session'
import { getSessionTokenFromRequest } from '@/server/auth/cookie'
import { generateToken, hashToken } from '@/server/auth/tokens'
import type { Context } from 'hono'

function handoffHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra)
  headers.set('Cache-Control', 'no-store')
  headers.set('Referrer-Policy', 'no-referrer')
  return headers
}

function redirectTo(location: string, status: 302 | 303): Response {
  const headers = handoffHeaders({ Location: location })
  return new Response(null, { status, headers })
}

function handoffError(status: number, message: string): Response {
  const body = `<!doctype html><html lang="ja"><meta charset="utf-8"><title>引き渡しできません</title><p>${escapeHtml(message)}</p>`
  return new Response(body, {
    status,
    headers: handoffHeaders({ 'Content-Type': 'text/html; charset=utf-8' })
  })
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function loginNext(request: Request): string {
  const url = new URL(request.url)
  const next = safeHandoffNext(`${url.pathname}${url.search}`)
  if (!next) return '/login'
  return `/login?next=${encodeURIComponent(next)}`
}

export async function handleHandoff(c: Context): Promise<Response> {
  const appId = c.req.query('app') ?? ''
  const redirectUri = c.req.query('redirect_uri') ?? ''
  const state = c.req.query('state') ?? ''

  if (
    !isAppId(appId) ||
    !isHandoffState(state) ||
    !redirectUri ||
    redirectUri.includes('?') ||
    redirectUri.includes('#')
  ) {
    return handoffError(400, '引き渡しのパラメータが正しくありません')
  }

  const token = getSessionTokenFromRequest(c)
  const session = await readSessionFromToken(token)
  if (!session) {
    return redirectTo(loginNext(c.req.raw), 302)
  }
  if (session.user.mustSetupPasskey) {
    return redirectTo('/setup-passkey', 302)
  }

  const app = await AppDB.findById(appId)
  if (!app || app.id === authEnv.appId()) {
    return handoffError(403, '引き渡し先のアプリを利用できません')
  }

  let redirectOrigin: string
  try {
    redirectOrigin = new URL(redirectUri).origin
  } catch {
    return handoffError(400, '引き渡しのパラメータが正しくありません')
  }
  const host = new URL(app.origin).hostname
  if (
    !isDirectChildHost(host, authEnv.parentDomain()) ||
    host === authServerHost() ||
    redirectOrigin !== app.origin ||
    !app.redirectUris.includes(redirectUri)
  ) {
    return handoffError(403, '引き渡し先のアプリを利用できません')
  }

  const grant = await AppGrantDB.findByUserAndApp(session.user.id, app.id)
  if (!grant) {
    return handoffError(403, '引き渡し先のアプリを利用できません')
  }

  const created = await createSessionForApp(app.id, session.user.id)
  const code = generateToken()
  try {
    await HandoffDB.create(app.id, hashToken(code), {
      token: created.token,
      userId: session.user.id,
      state,
      redirectUri
    })
  } catch (error) {
    await SessionDB.revoke(app.id, hashToken(created.token))
    throw error
  }

  await slideSession(session)
  const location = `${redirectUri}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`
  return redirectTo(location, 303)
}

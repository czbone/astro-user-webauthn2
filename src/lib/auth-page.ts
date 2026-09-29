import type { AstroCookies } from 'astro'
import {
  resolveSessionFromCookies,
  type ResolveSessionFromCookiesOptions,
  type ResolvedSession
} from '@/server/auth/session'

export async function getPageSession(
  cookies: AstroCookies,
  options?: ResolveSessionFromCookiesOptions
): Promise<ResolvedSession | null> {
  return resolveSessionFromCookies(cookies, options)
}

export function redirectForAuth(
  session: ResolvedSession | null,
  options?: {
    requireAdmin?: boolean
    allowWithoutPasskey?: boolean
  }
): string | null {
  if (!session) return '/login'

  if (session.user.mustSetupPasskey && !options?.allowWithoutPasskey) {
    return '/setup-passkey'
  }

  if (options?.requireAdmin && session.user.role !== 'admin') {
    return '/posts'
  }

  return null
}

import type { AstroCookies } from 'astro'
import { canManageUsers } from '@/lib/user-role'
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
    requireUserManager?: boolean
    allowWithoutPasskey?: boolean
  }
): string | null {
  if (!session) return '/login'

  if (session.user.mustSetupPasskey && !options?.allowWithoutPasskey) {
    return '/setup-passkey'
  }

  if (options?.requireAdmin && session.user.role !== 'admin') {
    return '/devices'
  }

  if (options?.requireUserManager && !canManageUsers(session.user.role)) {
    return '/devices'
  }

  return null
}

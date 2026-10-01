import { authServerOrigin } from '@/server/auth/app-registration'

const SAFE_METHODS = new Set(['GET', 'HEAD'])

/**
 * 開発時に localhost など別ホストで開かれた画面を、CSRF 検査と同じオリジンへ戻す。
 * 変更系リクエストはリダイレクトせず、既存のオリジン検査に任せる。
 */
export function redirectToCanonicalHost(
  request: Request,
  canonicalOrigin = authServerOrigin()
): Response | null {
  if (!SAFE_METHODS.has(request.method)) return null

  let current: URL
  let canonical: URL
  try {
    current = new URL(request.url)
    canonical = new URL(canonicalOrigin)
  } catch {
    return null
  }

  if (current.host === canonical.host) return null

  const target = new URL(`${current.pathname}${current.search}`, canonical.origin)
  return Response.redirect(target, 302)
}

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0)
    if (code <= 31 || code === 127) return true
  }
  return false
}
const APP_ID = /^[a-z0-9-]{1,32}$/
const STATE_VALUE = /^[\w.~-]{1,128}$/

export function isAppId(value: string): boolean {
  return APP_ID.test(value)
}

export function isHandoffState(value: string): boolean {
  return STATE_VALUE.test(value)
}

export function isDirectChildHost(host: string, parentDomain: string): boolean {
  const hostname = host.toLowerCase()
  const parent = parentDomain.toLowerCase()
  const suffix = `.${parent}`
  if (!hostname.endsWith(suffix)) return false
  const label = hostname.slice(0, -suffix.length)
  return HOST_LABEL.test(label)
}

export function normalizeOrigin(value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username || url.password || url.search || url.hash) return null
  if (url.pathname !== '/' && url.pathname !== '') return null
  return url.origin
}

export function originSchemeAllowed(origin: string, parentDomain: string): boolean {
  if (parentDomain.toLowerCase() === 'localhost') {
    return origin.startsWith('http://') || origin.startsWith('https://')
  }
  return origin.startsWith('https://')
}

export function normalizeRedirectUri(value: string, origin: string): string | null {
  if (value.includes('?') || value.includes('#')) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.origin !== origin || url.search || url.hash || url.username || url.password) {
    return null
  }
  return `${url.origin}${url.pathname}`
}

export function safeHandoffNext(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/auth/handoff?') || value.startsWith('//')) return null
  if (value.includes('\\') || hasControlCharacter(value)) return null
  let url: URL
  try {
    url = new URL(value, 'http://handoff.local')
  } catch {
    return null
  }
  if (url.origin !== 'http://handoff.local' || url.pathname !== '/auth/handoff') return null
  const app = url.searchParams.get('app')
  const redirectUri = url.searchParams.get('redirect_uri')
  const state = url.searchParams.get('state')
  if (!app || !redirectUri || !state) return null
  if (!isAppId(app) || !isHandoffState(state)) return null
  return `${url.pathname}${url.search}`
}

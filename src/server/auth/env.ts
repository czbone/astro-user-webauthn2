function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback
  if (!value) {
    throw new Error(`${name} is not set`)
  }
  return value
}

export const authEnv = {
  appUrl: () => required('APP_URL', 'http://auth.localhost:3000'),
  rpID: () => required('WEBAUTHN_RP_ID', 'auth.localhost'),
  rpName: () => required('WEBAUTHN_RP_NAME', 'Astro User WebAuthn'),
  origin: () => required('WEBAUTHN_ORIGIN', 'http://auth.localhost:3000'),
  appId: () => required('APP_ID', 'auth'),
  parentDomain: () => required('PARENT_DOMAIN', 'localhost').toLowerCase(),
  mailMode: () => (process.env.MAIL_MODE === 'smtp' ? 'smtp' : 'console') as 'console' | 'smtp',
  isProduction: () => process.env.NODE_ENV === 'production'
}

export const SESSION_COOKIE = '__Host-session'
export const HANDOFF_TTL_SECONDS = 60

const parsedMaxAge = Number.parseInt(process.env.SESSION_MAX_AGE_SECONDS || '', 10)
export const SESSION_MAX_AGE_SECONDS =
  Number.isFinite(parsedMaxAge) && parsedMaxAge > 0 ? parsedMaxAge : 60 * 60 * 24 * 30
export const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_SECONDS * 1000

export const DEVICE_INVITE_TTL_MS = 60 * 60 * 1000
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000
export const MAGIC_LINK_TTL_MS = 60 * 60 * 1000

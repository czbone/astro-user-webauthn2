export const POSITIVE_PERMISSIONS = ['allow'] as const

export type PositivePermission = (typeof POSITIVE_PERMISSIONS)[number]
export type GrantPermission = PositivePermission | 'none'

export function isPositivePermission(value: unknown): value is PositivePermission {
  return value === 'allow'
}

export function readDefaultPermission(
  value: unknown
): { ok: true; value: PositivePermission | null } | { ok: false } {
  if (value === null) return { ok: true, value: null }
  if (isPositivePermission(value)) return { ok: true, value }
  return { ok: false }
}

export function readGrantPermission(value: unknown): GrantPermission | null {
  if (value === 'none') return 'none'
  if (isPositivePermission(value)) return value
  return null
}

export function resolveEffectivePermission(
  app: { defaultPermission: string | null } | null,
  grant: { permission: string } | null
): PositivePermission | null {
  if (!app) return null
  if (grant) {
    return isPositivePermission(grant.permission) ? grant.permission : null
  }
  return isPositivePermission(app.defaultPermission) ? app.defaultPermission : null
}

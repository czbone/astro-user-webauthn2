import type { UserRole } from '@/types/models'

const ROLE_LABEL: Record<UserRole, string> = {
  admin: '管理者',
  manager: 'ユーザー管理者',
  user: '一般ユーザー'
}

const INVITE_ROLES: Record<UserRole, readonly UserRole[]> = {
  admin: ['user', 'manager', 'admin'],
  manager: ['user'],
  user: []
}

const EMAIL_CHANGE_ROLES: Record<UserRole, readonly UserRole[]> = {
  admin: ['user', 'manager', 'admin'],
  manager: ['user', 'manager'],
  user: []
}

export function isUserRole(value: unknown): value is UserRole {
  return value === 'admin' || value === 'manager' || value === 'user'
}

export function parseUserRole(value: unknown): UserRole | null {
  return isUserRole(value) ? value : null
}

export function roleLabel(role: UserRole): string {
  return ROLE_LABEL[role]
}

export function homePathForRole(role: UserRole | undefined): string {
  if (role === 'admin') return '/dashboard'
  if (role === 'manager') return '/admin/users'
  return '/devices'
}

export function canManageUsers(role: UserRole): boolean {
  return role === 'admin' || role === 'manager'
}

export function assignableRoles(actor: UserRole): readonly UserRole[] {
  return INVITE_ROLES[actor]
}

export function canChangeUserEmail(actor: UserRole, targetRole: string): boolean {
  return isUserRole(targetRole) && EMAIL_CHANGE_ROLES[actor].includes(targetRole)
}

export function resolveInviteRole(
  actor: UserRole,
  requested: unknown
): { ok: true; role: UserRole } | { ok: false; status: 400 | 403; error: string } {
  const role = requested === undefined ? 'user' : requested
  if (!isUserRole(role)) {
    return { ok: false, status: 400, error: 'ロールが正しくありません' }
  }
  if (!assignableRoles(actor).includes(role)) {
    return { ok: false, status: 403, error: 'このロールは指定できません' }
  }
  return { ok: true, role }
}

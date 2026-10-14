import { describe, expect, it } from 'vitest'
import {
  assignableRoles,
  canManageUsers,
  homePathForRole,
  parseUserRole,
  resolveInviteRole,
  roleLabel
} from '@/lib/user-role'

describe('user role', () => {
  it('labels the three roles in Japanese', () => {
    expect(roleLabel('admin')).toBe('管理者')
    expect(roleLabel('manager')).toBe('ユーザー管理者')
    expect(roleLabel('user')).toBe('一般ユーザー')
  })

  it('sends each role to its home', () => {
    expect(homePathForRole('admin')).toBe('/dashboard')
    expect(homePathForRole('manager')).toBe('/admin/users')
    expect(homePathForRole('user')).toBe('/devices')
    expect(homePathForRole(undefined)).toBe('/devices')
  })

  it('lets admin and manager manage users', () => {
    expect(canManageUsers('admin')).toBe(true)
    expect(canManageUsers('manager')).toBe(true)
    expect(canManageUsers('user')).toBe(false)
  })

  it('limits who can be invited', () => {
    expect(assignableRoles('admin')).toEqual(['user', 'manager', 'admin'])
    expect(assignableRoles('manager')).toEqual(['user', 'manager'])
    expect(assignableRoles('user')).toEqual([])
  })

  it('defaults an omitted invite role to user and rejects anything else', () => {
    expect(resolveInviteRole('manager', undefined)).toEqual({ ok: true, role: 'user' })
    expect(resolveInviteRole('admin', 'manager')).toEqual({ ok: true, role: 'manager' })
    expect(resolveInviteRole('manager', 'admin')).toEqual({
      ok: false,
      status: 403,
      error: 'このロールは指定できません'
    })
    expect(resolveInviteRole('admin', 'owner')).toEqual({
      ok: false,
      status: 400,
      error: 'ロールが正しくありません'
    })
  })

  it('accepts only the three stored role values', () => {
    expect(parseUserRole('manager')).toBe('manager')
    expect(parseUserRole('owner')).toBeNull()
  })
})

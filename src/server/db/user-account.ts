import type { UserRole } from '@/types/models'
import { prisma } from '@/lib/prisma'

const LAST_ADMIN_ROLE_REASON = '最後の管理者は降格できません'
const LAST_ADMIN_DISABLE_REASON = '最後の管理者は無効化できません'

export type ManagedUser = {
  id: string
  email: string
  name: string
  role: string
  disabledAt: Date | null
}

export type UserAccountResult =
  | { ok: true; user: ManagedUser; revokeSessions: boolean }
  | { ok: false; status: 404 | 409; error: string }

type LockedUser = {
  id: string
  email: string
  name: string
  role: string
  disabledAt: Date | null
}

function isActiveAdmin(user: { role: string; disabledAt: Date | null }): boolean {
  return user.role === 'admin' && user.disabledAt === null
}

function toManagedUser(
  user: LockedUser,
  role = user.role,
  disabledAt = user.disabledAt
): ManagedUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role,
    disabledAt
  }
}

export async function changeUserRole(input: {
  actorId: string
  targetId: string
  role: UserRole
}): Promise<UserAccountResult> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<LockedUser[]>`
      SELECT id, email, name, role, "disabledAt"
      FROM "User"
      WHERE id = ${input.targetId} OR (role = 'admin' AND "disabledAt" IS NULL)
      FOR UPDATE
    `
    const target = rows.find((row) => row.id === input.targetId)
    if (!target) {
      return { ok: false, status: 404, error: 'ユーザーが見つかりません' }
    }
    if (target.role === input.role) {
      return { ok: true, user: toManagedUser(target), revokeSessions: false }
    }

    const removingActiveAdmin = isActiveAdmin(target) && input.role !== 'admin'
    const activeAdminCount = rows.filter((row) => isActiveAdmin(row)).length
    if (removingActiveAdmin && activeAdminCount <= 1) {
      await tx.roleChange.create({
        data: {
          actorId: input.actorId,
          targetId: input.targetId,
          fromRole: target.role,
          toRole: input.role,
          success: false,
          reason: LAST_ADMIN_ROLE_REASON
        }
      })
      return { ok: false, status: 409, error: LAST_ADMIN_ROLE_REASON }
    }

    await tx.user.update({
      where: { id: input.targetId },
      data: { role: input.role }
    })
    await tx.roleChange.create({
      data: {
        actorId: input.actorId,
        targetId: input.targetId,
        fromRole: target.role,
        toRole: input.role,
        success: true
      }
    })
    return {
      ok: true,
      user: toManagedUser(target, input.role),
      revokeSessions: false
    }
  })
}

export async function setUserDisabled(input: {
  targetId: string
  disabled: boolean
}): Promise<UserAccountResult> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<LockedUser[]>`
      SELECT id, email, name, role, "disabledAt"
      FROM "User"
      WHERE id = ${input.targetId} OR (role = 'admin' AND "disabledAt" IS NULL)
      FOR UPDATE
    `
    const target = rows.find((row) => row.id === input.targetId)
    if (!target) {
      return { ok: false, status: 404, error: 'ユーザーが見つかりません' }
    }

    const currentlyDisabled = target.disabledAt !== null
    if (currentlyDisabled === input.disabled) {
      return { ok: true, user: toManagedUser(target), revokeSessions: input.disabled }
    }

    if (input.disabled && isActiveAdmin(target)) {
      const activeAdminCount = rows.filter((row) => isActiveAdmin(row)).length
      if (activeAdminCount <= 1) {
        return { ok: false, status: 409, error: LAST_ADMIN_DISABLE_REASON }
      }
    }

    const disabledAt = input.disabled ? new Date() : null
    await tx.user.update({
      where: { id: input.targetId },
      data: { disabledAt }
    })
    return {
      ok: true,
      user: toManagedUser(target, target.role, disabledAt),
      revokeSessions: input.disabled
    }
  })
}

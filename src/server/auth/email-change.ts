import { canChangeUserEmail } from '@/lib/user-role'
import type { UserRole } from '@/types/models'
import { EMAIL_CHANGE_TTL_MS } from '@/server/auth/env'
import { sendEmailChangeNoticeMail, sendEmailChangeRequestMail } from '@/server/auth/mail'
import { checkRateLimit } from '@/server/auth/rate-limit'
import { generateToken, hashToken } from '@/server/auth/tokens'
import { consumeEmailChangeReauth } from '@/server/auth/webauthn'
import {
  EmailChangeDB,
  InviteDB,
  MagicLinkDB,
  PasswordResetDB,
  SessionDB,
  UserDB
} from '@/server/db'

const WINDOW_MS = 15 * 60 * 1000

function isPrismaError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === code
  )
}

export type EmailChangeFailure = {
  ok: false
  status: 400 | 403 | 404 | 409 | 429
  error: string
}

function normalizeEmail(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
}

export async function requestEmailChange(input: {
  actorRole: UserRole
  userId: string
  email: unknown
  ip: string
}): Promise<{ ok: true } | EmailChangeFailure> {
  const email = normalizeEmail(input.email)
  const limited = await checkRateLimit(`emailchg:${input.ip}:${input.userId}`, 5, WINDOW_MS)
  if (!limited.ok) {
    return {
      ok: false,
      status: 429,
      error: '試行回数が多すぎます。しばらくしてから再試行してください'
    }
  }
  if (!email) {
    return { ok: false, status: 400, error: 'メールアドレスは必須です' }
  }

  const user = await UserDB.findById(input.userId)
  if (!user) {
    return { ok: false, status: 404, error: 'ユーザーが見つかりません' }
  }
  if (!canChangeUserEmail(input.actorRole, user.role)) {
    return { ok: false, status: 403, error: 'このユーザーのメールアドレスは変更できません' }
  }
  if (user.email === email) {
    return { ok: false, status: 400, error: '現在のメールアドレスと同じです' }
  }

  const existing = await UserDB.findByEmail(email)
  if (existing) {
    return { ok: false, status: 409, error: 'このメールアドレスは既に登録されています' }
  }
  const holder = await EmailChangeDB.findByEmail(email)
  if (holder && holder.userId !== user.id) {
    return { ok: false, status: 409, error: 'このメールアドレスは変更手続き中です' }
  }

  await EmailChangeDB.invalidatePendingForUser(user.id)
  const token = generateToken()
  await EmailChangeDB.create(
    user.id,
    email,
    hashToken(token),
    new Date(Date.now() + EMAIL_CHANGE_TTL_MS)
  )
  await sendEmailChangeRequestMail({
    to: email,
    name: user.name,
    token
  })
  return { ok: true }
}

export async function markEmailChangeReceived(input: {
  token: string
  ip: string
}): Promise<{ ok: true } | EmailChangeFailure> {
  const limited = await checkRateLimit(`emailchg-verify:${input.ip}`, 10, WINDOW_MS)
  if (!limited.ok) {
    return {
      ok: false,
      status: 429,
      error: '試行回数が多すぎます。しばらくしてから再試行してください'
    }
  }
  if (!input.token) {
    return { ok: false, status: 400, error: 'トークンが必要です' }
  }

  const record = await EmailChangeDB.markVerified(hashToken(input.token))
  if (!record) {
    return { ok: false, status: 400, error: '確認リンクが無効または期限切れです' }
  }
  return { ok: true }
}

export async function commitEmailChange(input: {
  actorRole: UserRole
  actorUserId: string
  targetUserId: string
  ip: string
}): Promise<{ ok: true; email: string; selfRevoked: boolean } | EmailChangeFailure> {
  const limited = await checkRateLimit(
    `emailchg-commit:${input.ip}:${input.actorUserId}`,
    10,
    WINDOW_MS
  )
  if (!limited.ok) {
    return {
      ok: false,
      status: 429,
      error: '試行回数が多すぎます。しばらくしてから再試行してください'
    }
  }
  if (!(await consumeEmailChangeReauth(input.actorUserId))) {
    return { ok: false, status: 403, error: 'メールアドレスの確定には再認証が必要です' }
  }

  const pending = await EmailChangeDB.findForUser(input.targetUserId)
  if (!pending?.verifiedAt) {
    return { ok: false, status: 400, error: '新しいメールアドレスの受信確認が済んでいません' }
  }

  const user = await UserDB.findById(input.targetUserId)
  if (!user) {
    return { ok: false, status: 404, error: 'ユーザーが見つかりません' }
  }
  if (!canChangeUserEmail(input.actorRole, user.role)) {
    return { ok: false, status: 403, error: 'このユーザーのメールアドレスは変更できません' }
  }

  const taken = await UserDB.findByEmail(pending.email)
  if (taken && taken.id !== user.id) {
    return { ok: false, status: 409, error: 'このメールアドレスは既に登録されています' }
  }
  const holder = await EmailChangeDB.findByEmail(pending.email)
  if (holder && holder.userId !== user.id) {
    return { ok: false, status: 409, error: 'このメールアドレスは変更手続き中です' }
  }

  const previousEmail = user.email
  if (previousEmail !== pending.email) {
    try {
      await UserDB.updateEmail(user.id, pending.email)
    } catch (error) {
      if (isPrismaError(error, 'P2002')) {
        return { ok: false, status: 409, error: 'このメールアドレスは既に登録されています' }
      }
      throw error
    }
  }

  await SessionDB.revokeAllForUser(user.id)
  await InviteDB.invalidatePendingForUser(user.id)
  await PasswordResetDB.invalidatePendingForUser(user.id)
  await MagicLinkDB.invalidatePendingForUser(user.id)
  await EmailChangeDB.invalidatePendingForUser(user.id)

  try {
    await sendEmailChangeNoticeMail({ to: previousEmail, name: user.name })
  } catch (error) {
    console.error('メールアドレス変更の通知に失敗しました:', error)
  }

  return {
    ok: true,
    email: pending.email,
    selfRevoked: input.actorUserId === user.id
  }
}

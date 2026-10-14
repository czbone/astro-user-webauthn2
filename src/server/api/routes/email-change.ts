import { Hono } from 'hono'
import type { AuthenticationResponseJSON } from '@simplewebauthn/server'
import { canChangeUserEmail } from '@/lib/user-role'
import { commitEmailChange, requestEmailChange } from '@/server/auth/email-change'
import { clearSessionCookieOnContext } from '@/server/auth/cookie'
import { createEmailChangeReauthOptions, verifyEmailChangeReauth } from '@/server/auth/webauthn'
import { EmailChangeDB, UserDB } from '@/server/db'
import { requireUserManager } from '@/server/middleware/auth'
import type { AppVariables } from '@/server/middleware/types'

const emailChanges = new Hono<{ Variables: AppVariables }>()

emailChanges.use('*', requireUserManager)

function clientIp(header: string | undefined): string {
  return header || 'local'
}

emailChanges.get('/', async (c) => {
  try {
    const actorRole = c.get('user').role
    const pending = await EmailChangeDB.list()
    const targets = await Promise.all(pending.map((record) => UserDB.findById(record.userId)))
    return c.json(
      pending
        .filter((_, index) => {
          const target = targets[index]
          return target != null && canChangeUserEmail(actorRole, target.role)
        })
        .map((record) => ({
          userId: record.userId,
          email: record.email,
          createdAt: record.createdAt,
          verifiedAt: record.verifiedAt
        })),
      200
    )
  } catch (error) {
    console.error('メールアドレス変更の一覧エラー:', error)
    return c.json({ error: 'メールアドレス変更の取得に失敗しました' }, 500)
  }
})

emailChanges.post('/', async (c) => {
  try {
    const body = await c.req.json()
    const result = await requestEmailChange({
      actorRole: c.get('user').role,
      userId: String(body.userId || ''),
      email: body.email,
      ip: clientIp(c.req.header('x-forwarded-for'))
    })
    if (!result.ok) {
      return c.json({ error: result.error }, result.status)
    }
    return c.json({ ok: true }, 200)
  } catch (error) {
    console.error('メールアドレス変更の申請エラー:', error)
    return c.json({ error: 'メールアドレス変更の申請に失敗しました' }, 500)
  }
})

emailChanges.post('/reauth/options', async (c) => {
  try {
    const options = await createEmailChangeReauthOptions(c.get('user').id)
    return c.json({ options }, 200)
  } catch (error) {
    console.error('メールアドレス変更の再認証オプションエラー:', error)
    return c.json({ error: '再認証の開始に失敗しました' }, 500)
  }
})

emailChanges.post('/reauth/verify', async (c) => {
  try {
    const body = await c.req.json()
    const response = body.response as AuthenticationResponseJSON
    if (!response) {
      return c.json({ error: '認証レスポンスが必要です' }, 400)
    }
    await verifyEmailChangeReauth(c.get('user').id, response)
    return c.json({ ok: true }, 200)
  } catch (error) {
    console.error('メールアドレス変更の再認証検証エラー:', error)
    return c.json({ error: '再認証に失敗しました' }, 401)
  }
})

emailChanges.post('/:userId/commit', async (c) => {
  try {
    const result = await commitEmailChange({
      actorRole: c.get('user').role,
      actorUserId: c.get('user').id,
      targetUserId: c.req.param('userId'),
      ip: clientIp(c.req.header('x-forwarded-for'))
    })
    if (!result.ok) {
      return c.json({ error: result.error }, result.status)
    }
    if (result.selfRevoked) {
      clearSessionCookieOnContext(c)
    }
    return c.json({ ok: true, email: result.email, selfRevoked: result.selfRevoked }, 200)
  } catch (error) {
    console.error('メールアドレス変更の確定エラー:', error)
    return c.json({ error: 'メールアドレスの確定に失敗しました' }, 500)
  }
})

export default emailChanges

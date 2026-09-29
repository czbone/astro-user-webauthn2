import { Hono } from 'hono'
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server'
import { DEVICE_INVITE_TTL_MS } from '@/server/auth/env'
import { sendDeviceInviteMail } from '@/server/auth/mail'
import { generateToken, hashToken } from '@/server/auth/tokens'
import {
  consumeReauth,
  createReauthOptions,
  createRegistrationOptions,
  verifyReauth,
  verifyRegistration
} from '@/server/auth/webauthn'
import { CredentialDB, InviteDB, UserDB } from '@/server/db'
import {
  loadSession,
  requireAuth,
  requirePasskey,
  slideSessionAfterAuth
} from '@/server/middleware/auth'
import type { AppVariables } from '@/server/middleware/types'

const devices = new Hono<{ Variables: AppVariables }>()

devices.post('/register/options', async (c) => {
  try {
    const body = await c.req.json()
    const token = String(body.token || '')
    if (!token) {
      return c.json({ error: '招待トークンが必要です' }, 400)
    }

    const invite = await InviteDB.findValidByTokenHash(hashToken(token))
    if (!invite) {
      return c.json({ error: '招待が無効または期限切れです' }, 400)
    }

    const user = await UserDB.findById(invite.userId)
    if (!user) {
      return c.json({ error: '招待が無効または期限切れです' }, 400)
    }

    const options = await createRegistrationOptions(user.id, user.email, user.name)
    return c.json({ options, email: user.email, name: user.name }, 200)
  } catch (error) {
    console.error('デバイス登録オプションエラー:', error)
    return c.json({ error: 'デバイス登録の開始に失敗しました' }, 500)
  }
})

devices.post('/register/verify', async (c) => {
  try {
    const body = await c.req.json()
    const token = String(body.token || '')
    const response = body.response as RegistrationResponseJSON

    if (!token || !response) {
      return c.json({ error: '招待トークンと登録レスポンスが必要です' }, 400)
    }

    const tokenHash = hashToken(token)
    const invite = await InviteDB.findValidByTokenHash(tokenHash)
    if (!invite) {
      return c.json({ error: '招待が無効または期限切れです' }, 400)
    }

    const deviceName = CredentialDB.normalizeDeviceName(body.deviceName)
    if (!deviceName) {
      return c.json({ error: 'デバイス名は必須です' }, 400)
    }
    if (await CredentialDB.existsByUserIdAndDeviceName(invite.userId, deviceName)) {
      return c.json({ error: '同じデバイス名は既に登録されています' }, 400)
    }

    await verifyRegistration(invite.userId, response, deviceName)
    await InviteDB.markUsed(tokenHash)

    return c.json({ ok: true }, 200)
  } catch (error) {
    console.error('デバイス登録検証エラー:', error)
    return c.json({ error: 'デバイス登録に失敗しました' }, 400)
  }
})

devices.use('*', loadSession, slideSessionAfterAuth)

devices.get('/', requireAuth, requirePasskey, async (c) => {
  try {
    const user = c.get('user')
    const list = await CredentialDB.listByUserId(user.id)
    return c.json(
      list.map((item) => ({
        id: item.id,
        deviceName: item.deviceName,
        createdAt: item.createdAt,
        lastUsedAt: item.lastUsedAt
      })),
      200
    )
  } catch (error) {
    console.error('デバイス一覧取得エラー:', error)
    return c.json({ error: 'デバイス一覧の取得に失敗しました' }, 500)
  }
})

devices.delete('/:id', requireAuth, requirePasskey, async (c) => {
  try {
    const user = c.get('user')
    const id = c.req.param('id')
    const count = await CredentialDB.countForUser(user.id)
    if (count <= 1) {
      return c.json(
        { error: '最後のパスキーは削除できません。ログインできないときの復旧を利用してください。' },
        400
      )
    }

    const result = await CredentialDB.deleteForUser(id, user.id)
    if (result.count === 0) {
      return c.json({ error: 'デバイスが見つかりません' }, 404)
    }
    return c.json({ ok: true }, 200)
  } catch (error) {
    console.error('デバイス削除エラー:', error)
    return c.json({ error: 'デバイスの削除に失敗しました' }, 500)
  }
})

devices.post('/reauth/options', requireAuth, requirePasskey, async (c) => {
  try {
    const user = c.get('user')
    const options = await createReauthOptions(user.id)
    return c.json({ options }, 200)
  } catch (error) {
    console.error('再認証オプションエラー:', error)
    return c.json({ error: '再認証の開始に失敗しました' }, 500)
  }
})

devices.post('/reauth/verify', requireAuth, requirePasskey, async (c) => {
  try {
    const user = c.get('user')
    const body = await c.req.json()
    const response = body.response as AuthenticationResponseJSON
    if (!response) {
      return c.json({ error: '認証レスポンスが必要です' }, 400)
    }
    await verifyReauth(user.id, response)
    return c.json({ ok: true }, 200)
  } catch (error) {
    console.error('再認証検証エラー:', error)
    return c.json({ error: '再認証に失敗しました' }, 401)
  }
})

devices.post('/invite', requireAuth, requirePasskey, async (c) => {
  try {
    const user = c.get('user')
    if (!(await consumeReauth(user.id))) {
      return c.json({ error: 'デバイス追加には再認証が必要です' }, 403)
    }

    const dbUser = await UserDB.findById(user.id)
    if (!dbUser) {
      return c.json({ error: 'ユーザーが見つかりません' }, 404)
    }

    await InviteDB.invalidatePendingForUser(user.id)
    const token = generateToken()
    await InviteDB.create(user.id, hashToken(token), new Date(Date.now() + DEVICE_INVITE_TTL_MS))

    await sendDeviceInviteMail({
      to: dbUser.email,
      name: dbUser.name,
      token
    })

    return c.json({ ok: true, message: '招待メールを送信しました' }, 200)
  } catch (error) {
    console.error('デバイス招待エラー:', error)
    return c.json({ error: 'デバイス招待の送信に失敗しました' }, 500)
  }
})

export default devices

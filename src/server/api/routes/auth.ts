import { Hono } from 'hono'
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server'
import { PASSWORD_RESET_TTL_MS, authEnv } from '@/server/auth/env'
import { issueInviteMagicLink } from '@/server/auth/magic-link'
import { sendPasswordResetMail } from '@/server/auth/mail'
import { hashPassword, verifyPassword } from '@/server/auth/password'
import { checkRateLimit } from '@/server/auth/rate-limit'
import {
  clearSessionCookieOnContext,
  createSession,
  getSessionTokenFromRequest,
  setSessionCookieOnContext
} from '@/server/auth/session'
import { generateToken, hashToken } from '@/server/auth/tokens'
import {
  createAuthenticationOptions,
  createRegistrationOptions,
  verifyAuthentication,
  verifyRegistration
} from '@/server/auth/webauthn'
import {
  CredentialDB,
  InviteDB,
  MagicLinkDB,
  PasswordResetDB,
  SessionDB,
  UserDB
} from '@/server/db'
import { loadSession, requireAuth, slideSessionAfterAuth } from '@/server/middleware/auth'
import type { AppVariables } from '@/server/middleware/types'

const auth = new Hono<{ Variables: AppVariables }>()

auth.use('*', loadSession, slideSessionAfterAuth)

auth.get('/me', async (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ user: null }, 200)
  }
  return c.json({ user }, 200)
})

auth.post('/login/password', async (c) => {
  try {
    const body = await c.req.json()
    const email = String(body.email || '')
      .trim()
      .toLowerCase()
    const password = String(body.password || '')
    const ip = c.req.header('x-forwarded-for') || 'local'
    const limited = await checkRateLimit(`pwd:${ip}:${email}`, 10, 15 * 60 * 1000)
    if (!limited.ok) {
      return c.json({ error: '試行回数が多すぎます。しばらくしてから再試行してください' }, 429)
    }

    if (!email || !password) {
      return c.json({ error: 'メールアドレスとパスワードは必須です' }, 400)
    }

    const user = await UserDB.findByEmail(email)
    if (!user || !(await verifyPassword(password, user.password))) {
      return c.json({ error: 'メールアドレスまたはパスワードが正しくありません' }, 401)
    }

    const credentialCount = await UserDB.countCredentials(user.id)
    if (credentialCount > 0) {
      return c.json(
        {
          error:
            'このアカウントはパスキーでログインしてください。ログインできないときはアカウント復旧を行ってください。'
        },
        403
      )
    }

    const { token } = await createSession(user.id)
    setSessionCookieOnContext(c, token)

    return c.json(
      {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          hasPasskey: false,
          mustSetupPasskey: true
        }
      },
      200
    )
  } catch (error) {
    console.error('パスワードログインエラー:', error)
    return c.json({ error: 'ログインに失敗しました' }, 500)
  }
})

auth.post('/login/method', async (c) => {
  try {
    const body = await c.req.json()
    const email = String(body.email || '')
      .trim()
      .toLowerCase()
    const ip = c.req.header('x-forwarded-for') || 'local'
    const limited = await checkRateLimit(`method:${ip}:${email}`, 30, 15 * 60 * 1000)
    if (!limited.ok) {
      return c.json({ error: '試行回数が多すぎます' }, 429)
    }
    if (!email) {
      return c.json({ error: 'メールアドレスは必須です' }, 400)
    }

    const user = await UserDB.findByEmail(email)
    if (!user) {
      return c.json({ error: 'ログインに失敗しました' }, 401)
    }

    const credentialCount = await UserDB.countCredentials(user.id)
    if (credentialCount > 0) {
      const result = await createAuthenticationOptions(email)
      return c.json({ method: 'passkey', options: result.options }, 200)
    }

    return c.json({ method: 'magic' }, 200)
  } catch (error) {
    console.error('ログイン方式判定エラー:', error)
    return c.json({ error: 'ログインに失敗しました' }, 500)
  }
})

auth.post('/login/passkey/options', async (c) => {
  try {
    const body = await c.req.json()
    const email = String(body.email || '')
      .trim()
      .toLowerCase()
    if (!email) {
      return c.json({ error: 'メールアドレスは必須です' }, 400)
    }

    const result = await createAuthenticationOptions(email)
    return c.json({ options: result.options, method: 'passkey' }, 200)
  } catch (error) {
    console.error('パスキーオプション生成エラー:', error)
    return c.json({ error: 'パスキー認証の開始に失敗しました' }, 500)
  }
})

auth.post('/login/passkey/verify', async (c) => {
  try {
    const body = await c.req.json()
    const response = body.response as AuthenticationResponseJSON
    if (!response) {
      return c.json({ error: '認証レスポンスが必要です' }, 400)
    }

    const { userId } = await verifyAuthentication(response)
    const user = await UserDB.findById(userId)
    if (!user) {
      return c.json({ error: 'ユーザーが見つかりません' }, 404)
    }

    const { token } = await createSession(user.id)
    setSessionCookieOnContext(c, token)

    return c.json(
      {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          hasPasskey: true,
          mustSetupPasskey: false
        }
      },
      200
    )
  } catch (error) {
    console.error('パスキー検証エラー:', error)
    return c.json({ error: 'パスキー認証に失敗しました' }, 401)
  }
})

auth.post('/passkey/register/options', requireAuth, async (c) => {
  try {
    const user = c.get('user')
    const credentialCount = await UserDB.countCredentials(user.id)
    if (credentialCount > 0) {
      return c.json({ error: '追加のパスキーはデバイス招待から登録してください' }, 403)
    }

    const options = await createRegistrationOptions(user.id, user.email, user.name)
    return c.json({ options }, 200)
  } catch (error) {
    console.error('パスキー登録オプションエラー:', error)
    return c.json({ error: 'パスキー登録の開始に失敗しました' }, 500)
  }
})

auth.post('/passkey/register/verify', requireAuth, async (c) => {
  try {
    const user = c.get('user')
    const credentialCount = await UserDB.countCredentials(user.id)
    if (credentialCount > 0) {
      return c.json({ error: '追加のパスキーはデバイス招待から登録してください' }, 403)
    }

    const body = await c.req.json()
    const response = body.response as RegistrationResponseJSON
    if (!response) {
      return c.json({ error: '登録レスポンスが必要です' }, 400)
    }

    const deviceName = CredentialDB.normalizeDeviceName(body.deviceName)
    if (!deviceName) {
      return c.json({ error: 'デバイス名は必須です' }, 400)
    }
    if (await CredentialDB.existsByUserIdAndDeviceName(user.id, deviceName)) {
      return c.json({ error: '同じデバイス名は既に登録されています' }, 400)
    }

    await verifyRegistration(user.id, response, deviceName)
    return c.json({ ok: true }, 200)
  } catch (error) {
    console.error('パスキー登録検証エラー:', error)
    return c.json({ error: 'パスキー登録に失敗しました' }, 400)
  }
})

auth.post('/password-reset/request', async (c) => {
  const generic = {
    message: '入力されたメールアドレスにアカウントがある場合、再設定手順を送信しました'
  }

  try {
    const body = await c.req.json()
    const email = String(body.email || '')
      .trim()
      .toLowerCase()
    const ip = c.req.header('x-forwarded-for') || 'local'
    const limited = await checkRateLimit(`reset:${ip}:${email}`, 5, 15 * 60 * 1000)
    if (!limited.ok) {
      return c.json(generic, 200)
    }

    if (!email) {
      return c.json(generic, 200)
    }

    const user = await UserDB.findByEmail(email)
    if (user) {
      await PasswordResetDB.invalidatePendingForUser(user.id)
      const token = generateToken()
      await PasswordResetDB.create(
        user.id,
        hashToken(token),
        new Date(Date.now() + PASSWORD_RESET_TTL_MS)
      )
      await sendPasswordResetMail({
        to: user.email,
        name: user.name,
        token
      })
    }

    return c.json(generic, 200)
  } catch (error) {
    console.error('パスワード再設定リクエストエラー:', error)
    return c.json(generic, 200)
  }
})

auth.post('/password-reset/confirm', async (c) => {
  try {
    const body = await c.req.json()
    const token = String(body.token || '')
    const password = String(body.password || '')

    if (!token || password.length < 8) {
      return c.json({ error: 'トークンと8文字以上のパスワードが必要です' }, 400)
    }

    const tokenHash = hashToken(token)
    const reset = await PasswordResetDB.findValidByTokenHash(tokenHash)
    if (!reset) {
      return c.json({ error: '再設定リンクが無効または期限切れです' }, 400)
    }

    const passwordHash = await hashPassword(password)
    await UserDB.updatePassword(reset.userId, passwordHash)
    await CredentialDB.deleteAllForUser(reset.userId)
    await SessionDB.revokeAllForUser(reset.userId)
    await InviteDB.invalidatePendingForUser(reset.userId)
    await PasswordResetDB.invalidatePendingForUser(reset.userId)
    await MagicLinkDB.invalidatePendingForUser(reset.userId)

    const { token: sessionToken } = await createSession(reset.userId)
    setSessionCookieOnContext(c, sessionToken)

    return c.json({ ok: true, redirectTo: '/setup-passkey' }, 200)
  } catch (error) {
    console.error('パスワード再設定確定エラー:', error)
    return c.json({ error: 'パスワード再設定に失敗しました' }, 500)
  }
})

auth.post('/magic/consume', async (c) => {
  try {
    const body = await c.req.json()
    const token = String(body.token || '')
    const ip = c.req.header('x-forwarded-for') || 'local'
    const limited = await checkRateLimit(`magic:${ip}`, 10, 15 * 60 * 1000)
    if (!limited.ok) {
      return c.json({ error: '試行回数が多すぎます。しばらくしてから再試行してください' }, 429)
    }

    if (!token) {
      return c.json({ error: 'トークンが必要です' }, 400)
    }

    const tokenHash = hashToken(token)
    const pending = await MagicLinkDB.findValidByTokenHash(tokenHash)
    if (!pending) {
      return c.json({ error: 'ログイン用リンクが無効または期限切れです' }, 400)
    }

    const credentialCount = await UserDB.countCredentials(pending.userId)
    if (credentialCount > 0) {
      return c.json({ error: 'このリンクは使えません' }, 400)
    }

    const record = await MagicLinkDB.consume(tokenHash)
    if (!record) {
      return c.json({ error: 'ログイン用リンクが無効または期限切れです' }, 400)
    }

    const { token: sessionToken } = await createSession(record.userId)
    setSessionCookieOnContext(c, sessionToken)

    return c.json({ ok: true, redirectTo: '/setup-passkey' }, 200)
  } catch (error) {
    console.error('マジックリンク消費エラー:', error)
    return c.json({ error: 'ログインに失敗しました' }, 500)
  }
})

auth.post('/magic/resend', async (c) => {
  const generic = {
    message:
      '入力されたメールアドレスにアカウントがあり、パスキー未設定の場合、ログイン用リンクを送信しました'
  }

  try {
    const body = await c.req.json()
    const email = String(body.email || '')
      .trim()
      .toLowerCase()
    const ip = c.req.header('x-forwarded-for') || 'local'
    const limited = await checkRateLimit(`magic-resend:${ip}:${email}`, 5, 15 * 60 * 1000)
    if (!limited.ok) {
      return c.json(generic, 200)
    }

    if (!email) {
      return c.json(generic, 200)
    }

    const user = await UserDB.findByEmail(email)
    if (user && (await UserDB.countCredentials(user.id)) === 0) {
      await issueInviteMagicLink({
        userId: user.id,
        email: user.email,
        name: user.name,
        revokeSessions: true
      })
    }

    return c.json(generic, 200)
  } catch (error) {
    console.error('マジックリンク再送エラー:', error)
    return c.json(generic, 200)
  }
})

auth.post('/logout-all', requireAuth, async (c) => {
  try {
    const user = c.get('user')
    await SessionDB.revokeAllForUser(user.id)
    clearSessionCookieOnContext(c)
    return c.json({ ok: true }, 200)
  } catch (error) {
    console.error('全ログアウトエラー:', error)
    return c.json({ error: 'ログアウトに失敗しました' }, 500)
  }
})

auth.post('/logout', requireAuth, async (c) => {
  try {
    const token = getSessionTokenFromRequest(c)
    if (token) {
      await SessionDB.revoke(authEnv.appId(), hashToken(token))
    }
    clearSessionCookieOnContext(c)
    return c.json({ ok: true }, 200)
  } catch (error) {
    console.error('ログアウトエラー:', error)
    return c.json({ error: 'ログアウトに失敗しました' }, 500)
  }
})

export default auth

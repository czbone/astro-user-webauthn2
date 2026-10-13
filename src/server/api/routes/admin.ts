import { Hono } from 'hono'
import { validateAppDetails, validateParticipatingApp } from '@/server/auth/app-registration'
import { authEnv } from '@/server/auth/env'
import { issueInviteMagicLink } from '@/server/auth/magic-link'
import { hashPassword } from '@/server/auth/password'
import { generateToken } from '@/server/auth/tokens'
import { readDefaultPermission, readGrantPermission } from '@/server/auth/permissions'
import { AppDB, AppGrantDB, UserDB } from '@/server/db'
import type { AppRecord } from '@/server/db/app'
import { loadSession, requireAdmin, slideSessionAfterAuth } from '@/server/middleware/auth'
import type { AppVariables } from '@/server/middleware/types'

const admin = new Hono<{ Variables: AppVariables }>()

admin.use('*', loadSession, requireAdmin, slideSessionAfterAuth)

admin.get('/stats', async (c) => {
  try {
    const [userCount, adminCount] = await Promise.all([UserDB.count(), UserDB.countAdmins()])

    return c.json(
      {
        userCount,
        adminCount
      },
      200
    )
  } catch (error) {
    console.error('統計取得エラー:', error)
    return c.json({ error: '統計の取得に失敗しました' }, 500)
  }
})

admin.get('/users', async (c) => {
  try {
    const users = await UserDB.list()
    return c.json(users, 200)
  } catch (error) {
    console.error('ユーザー一覧取得エラー:', error)
    return c.json({ error: 'ユーザー一覧の取得に失敗しました' }, 500)
  }
})

admin.post('/users', async (c) => {
  try {
    const body = await c.req.json()
    const email = String(body.email || '')
      .trim()
      .toLowerCase()
    const name = String(body.name || '').trim()
    const role = body.role === 'admin' ? 'admin' : 'user'

    if (!email || !name) {
      return c.json({ error: 'メールアドレスと名前は必須です' }, 400)
    }

    const existing = await UserDB.findByEmail(email)
    if (existing) {
      return c.json({ error: 'このメールアドレスは既に登録されています' }, 409)
    }

    const passwordHash = await hashPassword(generateToken())
    const user = await UserDB.create({
      email,
      name,
      role,
      password: passwordHash
    })

    await issueInviteMagicLink({
      userId: user.id,
      email: user.email,
      name: user.name,
      revokeSessions: false
    })

    return c.json(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt
      },
      201
    )
  } catch (error) {
    console.error('ユーザー招待エラー:', error)
    return c.json({ error: 'ユーザーの招待に失敗しました' }, 500)
  }
})

function isPrismaError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === code
  )
}

function readRedirectUris(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return null
  return value
}

function serializeApp(app: AppRecord) {
  return {
    id: app.id,
    name: app.name,
    origin: app.origin,
    redirectUris: app.redirectUris,
    defaultPermission: app.defaultPermission,
    isAuthServer: app.id === authEnv.appId(),
    createdAt: app.createdAt,
    updatedAt: app.updatedAt
  }
}

admin.get('/apps', async (c) => {
  try {
    const apps = await AppDB.list()
    return c.json(apps.map(serializeApp), 200)
  } catch (error) {
    console.error('アプリ一覧取得エラー:', error)
    return c.json({ error: 'アプリ一覧の取得に失敗しました' }, 500)
  }
})

admin.post('/apps', async (c) => {
  try {
    const body = await c.req.json()
    const redirectUris = readRedirectUris(body.redirectUris)
    if (!redirectUris) {
      return c.json({ error: '戻り先 URL の形式が正しくありません' }, 400)
    }
    const validated = validateParticipatingApp({
      id: String(body.id || ''),
      name: String(body.name || ''),
      origin: String(body.origin || ''),
      redirectUris
    })
    if (!validated.ok) {
      return c.json({ error: validated.error }, 400)
    }
    if (!Object.prototype.hasOwnProperty.call(body, 'defaultPermission')) {
      return c.json({ error: '既定の権限は必須です' }, 400)
    }
    const defaultPermission = readDefaultPermission(body.defaultPermission)
    if (!defaultPermission.ok) {
      return c.json({ error: '既定の権限が正しくありません' }, 400)
    }

    const app = await AppDB.create({
      ...validated.value,
      defaultPermission: defaultPermission.value
    })
    return c.json(serializeApp(app), 201)
  } catch (error) {
    if (isPrismaError(error, 'P2002')) {
      return c.json({ error: '同じ ID またはオリジンのアプリが既にあります' }, 409)
    }
    console.error('アプリ登録エラー:', error)
    return c.json({ error: 'アプリの登録に失敗しました' }, 500)
  }
})

admin.patch('/apps/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const existing = await AppDB.findById(id)
    if (!existing) {
      return c.json({ error: 'アプリが見つかりません' }, 404)
    }

    const body = await c.req.json()
    if ('id' in body || 'origin' in body) {
      return c.json({ error: 'アプリ ID とオリジンは変更できません' }, 400)
    }
    const redirectUris = readRedirectUris(body.redirectUris)
    if (!redirectUris) {
      return c.json({ error: '戻り先 URL の形式が正しくありません' }, 400)
    }
    const validated = validateAppDetails(existing.origin, {
      name: String(body.name || ''),
      redirectUris
    })
    if (!validated.ok) {
      return c.json({ error: validated.error }, 400)
    }

    const details: {
      name: string
      redirectUris: string[]
      defaultPermission?: string | null
    } = validated.value
    if (Object.prototype.hasOwnProperty.call(body, 'defaultPermission')) {
      if (id === authEnv.appId()) {
        return c.json({ error: '認証サーバーの既定権限は設定できません' }, 400)
      }
      const defaultPermission = readDefaultPermission(body.defaultPermission)
      if (!defaultPermission.ok) {
        return c.json({ error: '既定の権限が正しくありません' }, 400)
      }
      details.defaultPermission = defaultPermission.value
    }

    const app = await AppDB.updateDetails(id, details)
    return c.json(serializeApp(app), 200)
  } catch (error) {
    console.error('アプリ更新エラー:', error)
    return c.json({ error: 'アプリの更新に失敗しました' }, 500)
  }
})

admin.delete('/apps/:id', async (c) => {
  try {
    const id = c.req.param('id')
    if (id === authEnv.appId()) {
      return c.json({ error: '認証サーバーは削除できません' }, 400)
    }
    const existing = await AppDB.findById(id)
    if (!existing) {
      return c.json({ error: 'アプリが見つかりません' }, 404)
    }
    await AppDB.delete(id)
    return c.json({ ok: true }, 200)
  } catch (error) {
    console.error('アプリ削除エラー:', error)
    return c.json({ error: 'アプリの削除に失敗しました' }, 500)
  }
})

admin.get('/grants', async (c) => {
  try {
    const grants = await AppGrantDB.list()
    return c.json(
      grants.filter((grant) => grant.appId !== authEnv.appId()),
      200
    )
  } catch (error) {
    console.error('権限一覧取得エラー:', error)
    return c.json({ error: '権限一覧の取得に失敗しました' }, 500)
  }
})

admin.put('/grants', async (c) => {
  try {
    const body = await c.req.json()
    const userId = String(body.userId || '')
    const appId = String(body.appId || '')
    const permission = readGrantPermission(body.permission)
    if (!userId || !appId || !permission) {
      return c.json({ error: 'ユーザー、アプリ、権限が必要です' }, 400)
    }
    if (appId === authEnv.appId()) {
      return c.json({ error: '認証サーバーへの権限は設定できません' }, 400)
    }

    const user = await UserDB.findById(userId)
    const app = await AppDB.findById(appId)
    if (!user || !app) {
      return c.json({ error: 'ユーザーまたはアプリが見つかりません' }, 404)
    }

    const grant = await AppGrantDB.upsert(userId, appId, permission)
    return c.json(grant, 200)
  } catch (error) {
    console.error('権限更新エラー:', error)
    return c.json({ error: '権限の更新に失敗しました' }, 500)
  }
})

admin.delete('/grants/:userId/:appId', async (c) => {
  try {
    const appId = c.req.param('appId')
    if (appId === authEnv.appId()) {
      return c.json({ error: '認証サーバーへの権限は設定できません' }, 400)
    }
    const deleted = await AppGrantDB.delete(c.req.param('userId'), appId)
    if (!deleted) {
      return c.json({ error: '権限が見つかりません' }, 404)
    }
    return c.json({ ok: true }, 200)
  } catch (error) {
    console.error('権限削除エラー:', error)
    return c.json({ error: '権限の削除に失敗しました' }, 500)
  }
})

export default admin

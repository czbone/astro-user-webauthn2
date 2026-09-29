import 'dotenv/config'
import { prisma } from '../src/lib/prisma'
import { hashPassword } from '../src/server/auth/password'
import { isAppId, isDirectChildHost, normalizeOrigin } from '../src/server/auth/app-host'

const DEFAULT_ADMIN_EMAIL = 'admin@example.com'
const DEFAULT_ADMIN_PASSWORD = 'admin-change-me'

async function upsertAuthApp() {
  const id = process.env.APP_ID || 'auth'
  if (!isAppId(id)) {
    throw new Error('APP_ID は小文字・数字・ハイフンの 1〜32 文字です')
  }

  const origin = normalizeOrigin(process.env.WEBAUTHN_ORIGIN || 'http://auth.localhost:3000')
  const parentDomain = (process.env.PARENT_DOMAIN || 'localhost').toLowerCase()
  const rpId = process.env.WEBAUTHN_RP_ID || 'auth.localhost'
  if (!origin) {
    throw new Error('WEBAUTHN_ORIGIN がオリジンとして解釈できません')
  }
  const host = new URL(origin).hostname
  if (host !== rpId || !isDirectChildHost(host, parentDomain)) {
    throw new Error(
      '認証サーバーのホストは PARENT_DOMAIN の直下であり、WEBAUTHN_RP_ID と一致する必要があります'
    )
  }

  const name = process.env.WEBAUTHN_RP_NAME || '認証サーバー'
  const app = await prisma.app.upsert({
    where: { id },
    create: {
      id,
      name,
      origin,
      redirectUris: []
    },
    update: {
      name,
      origin
    }
  })
  console.log('認証サーバーのアプリを用意しました:', { id: app.id, origin: app.origin })
}

async function main() {
  console.log('初期データの挿入を開始します...')
  await upsertAuthApp()

  const existing = await prisma.user.count()
  if (existing > 0) {
    console.log(`User が既に ${existing} 件あるため管理者の作成をスキップします`)
    return
  }

  const email = (process.env.SEED_ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).toLowerCase()
  const password = process.env.SEED_ADMIN_PASSWORD
  const isProduction = process.env.NODE_ENV === 'production'

  if (isProduction && (!password || password === DEFAULT_ADMIN_PASSWORD)) {
    throw new Error(
      '本番では SEED_ADMIN_PASSWORD に既定値（admin-change-me）以外を設定してください'
    )
  }

  const resolvedPassword = password || DEFAULT_ADMIN_PASSWORD
  const passwordHash = await hashPassword(resolvedPassword)

  const admin = await prisma.user.create({
    data: {
      email,
      name: 'Administrator',
      role: 'admin',
      password: passwordHash
    }
  })

  console.log('管理者を作成しました:', {
    id: admin.id,
    email: admin.email,
    role: admin.role
  })
  console.log('AppGrant は自動では付与しません')
  console.log('初期パスワードは SEED_ADMIN_PASSWORD を参照してください')
  console.log('初期データの挿入が完了しました')
}

main()
  .catch((e) => {
    console.error('エラーが発生しました:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

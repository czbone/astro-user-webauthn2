import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { isAppId, isDirectChildHost } from '@/server/auth/app-host'
import { isDbLogLevel } from '@/server/db-log'

export type EnvIssue = {
  level: 'error' | 'warn'
  name: string
  message: string
}

const REQUIRED_IN_PRODUCTION = [
  'DATABASE_URL',
  'REDIS_URL',
  'APP_URL',
  'WEBAUTHN_RP_ID',
  'WEBAUTHN_ORIGIN',
  'APP_ID',
  'PARENT_DOMAIN'
] as const

const DEVELOPMENT_DEFAULTS: Record<string, string[]> = {
  REDIS_URL: ['redis://localhost:6379', 'redis://localhost:6379/'],
  APP_URL: ['http://auth.localhost:3000', 'http://auth.localhost:3000/'],
  WEBAUTHN_ORIGIN: ['http://auth.localhost:3000', 'http://auth.localhost:3000/'],
  WEBAUTHN_RP_ID: ['auth.localhost'],
  PARENT_DOMAIN: ['localhost']
}

const DEFAULT_SEED_PASSWORD = 'admin-change-me'

function isDevelopmentDefault(name: string, value: string): boolean {
  const defaults = DEVELOPMENT_DEFAULTS[name]
  if (!defaults) return false
  return defaults.includes(value) || defaults.includes(value.replace(/\/$/, ''))
}

function parseHttpUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

const WEBAUTHN_ORIGIN_VARS = [
  'APP_URL',
  'WEBAUTHN_ORIGIN',
  'WEBAUTHN_RP_ID',
  'APP_ID',
  'PARENT_DOMAIN'
] as const

function collectWebAuthnOriginIssues(
  appUrl: string,
  webauthnOrigin: string,
  rpId: string,
  appId: string,
  parentDomain: string
): EnvIssue[] {
  const issues: EnvIssue[] = []
  const app = parseHttpUrl(appUrl)
  const origin = parseHttpUrl(webauthnOrigin)

  if (!app) {
    issues.push({
      level: 'error',
      name: 'APP_URL',
      message: `APP_URL が URL として解釈できません: ${appUrl}`
    })
  }
  if (!origin) {
    issues.push({
      level: 'error',
      name: 'WEBAUTHN_ORIGIN',
      message: `WEBAUTHN_ORIGIN が URL として解釈できません: ${webauthnOrigin}`
    })
  }
  if (!app || !origin) {
    return issues
  }

  if (app.origin !== origin.origin) {
    issues.push({
      level: 'error',
      name: 'WEBAUTHN_ORIGIN',
      message: `WEBAUTHN_ORIGIN (${origin.origin}) と APP_URL (${app.origin}) の origin が一致しません`
    })
  }

  if (rpId !== origin.hostname) {
    issues.push({
      level: 'error',
      name: 'WEBAUTHN_RP_ID',
      message: `WEBAUTHN_RP_ID (${rpId}) が WEBAUTHN_ORIGIN のホスト (${origin.hostname}) と一致しません`
    })
  }

  if (origin.protocol !== 'https:') {
    issues.push({
      level: 'error',
      name: 'WEBAUTHN_ORIGIN',
      message: `本番の WEBAUTHN_ORIGIN は https である必要があります: ${webauthnOrigin}`
    })
  }

  if (!isAppId(appId)) {
    issues.push({
      level: 'error',
      name: 'APP_ID',
      message: `APP_ID は小文字・数字・ハイフンの 1〜32 文字です: ${appId}`
    })
  }

  if (!isDirectChildHost(rpId, parentDomain)) {
    issues.push({
      level: 'error',
      name: 'WEBAUTHN_RP_ID',
      message: `WEBAUTHN_RP_ID (${rpId}) は PARENT_DOMAIN (${parentDomain}) の直下のサブドメインである必要があります`
    })
  }

  return issues
}

export function collectEnvIssues(
  env: Record<string, string | undefined>,
  production: boolean
): EnvIssue[] {
  const issues: EnvIssue[] = []

  if (!env.NODE_ENV) {
    issues.push({
      level: 'warn',
      name: 'NODE_ENV',
      message: 'NODE_ENV が未設定です。本番では production を設定してください'
    })
  }

  for (const name of REQUIRED_IN_PRODUCTION) {
    const value = env[name]?.trim()
    if (!value) {
      issues.push({
        level: production ? 'error' : 'warn',
        name,
        message: `${name} が設定されていません`
      })
      continue
    }

    if (production && isDevelopmentDefault(name, value)) {
      issues.push({
        level: 'error',
        name,
        message: `${name} が開発用の値（${value}）のままです`
      })
    }
  }

  if (production) {
    const blocked = new Set(
      issues
        .filter(
          (issue) =>
            issue.level === 'error' &&
            (WEBAUTHN_ORIGIN_VARS as readonly string[]).includes(issue.name)
        )
        .map((issue) => issue.name)
    )
    const appUrl = env.APP_URL?.trim()
    const webauthnOrigin = env.WEBAUTHN_ORIGIN?.trim()
    const rpId = env.WEBAUTHN_RP_ID?.trim()
    const appId = env.APP_ID?.trim()
    const parentDomain = env.PARENT_DOMAIN?.trim()
    if (
      appUrl &&
      webauthnOrigin &&
      rpId &&
      appId &&
      parentDomain &&
      !blocked.has('APP_URL') &&
      !blocked.has('WEBAUTHN_ORIGIN') &&
      !blocked.has('WEBAUTHN_RP_ID') &&
      !blocked.has('APP_ID') &&
      !blocked.has('PARENT_DOMAIN')
    ) {
      issues.push(...collectWebAuthnOriginIssues(appUrl, webauthnOrigin, rpId, appId, parentDomain))
    }
  }

  if (env.MAIL_MODE === 'smtp') {
    if (!env.SMTP_HOST?.trim() || !env.SMTP_FROM?.trim()) {
      issues.push({
        level: production ? 'error' : 'warn',
        name: 'SMTP',
        message: 'MAIL_MODE=smtp のときは SMTP_HOST と SMTP_FROM が必要です'
      })
    }
  }

  const dbLogLevel = env.DB_LOG_LEVEL?.trim()
  if (dbLogLevel && !isDbLogLevel(dbLogLevel)) {
    issues.push({
      level: production ? 'error' : 'warn',
      name: 'DB_LOG_LEVEL',
      message: `DB_LOG_LEVEL の値が不正です: ${dbLogLevel}（silent / error / warn / info / query）`
    })
  }

  if (env.RUN_SEED === 'true' && production) {
    const password = env.SEED_ADMIN_PASSWORD
    if (!password || password === DEFAULT_SEED_PASSWORD) {
      issues.push({
        level: 'error',
        name: 'SEED_ADMIN_PASSWORD',
        message: '本番では SEED_ADMIN_PASSWORD に既定値（admin-change-me）以外を設定してください'
      })
    }
  }

  return issues
}

function shouldSkipValidation(): boolean {
  return process.env.VITEST === 'true' || process.env.npm_lifecycle_event === 'build'
}

function isDirectRun(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  return resolve(fileURLToPath(import.meta.url)) === resolve(entry)
}

export function validateRuntimeEnv(
  env: Record<string, string | undefined> = process.env
): EnvIssue[] {
  if (shouldSkipValidation()) {
    return []
  }

  const production = env.NODE_ENV === 'production'
  const issues = collectEnvIssues(env, production)

  for (const issue of issues) {
    const line = `[env] ${issue.message}`
    if (issue.level === 'error') {
      console.error(line)
    } else {
      console.warn(line)
    }
  }

  if (production && issues.some((issue) => issue.level === 'error')) {
    console.error('[env] 本番起動に必要な環境変数が不足しているため終了します')
    process.exit(1)
  }

  return issues
}

if (isDirectRun()) {
  validateRuntimeEnv()
}

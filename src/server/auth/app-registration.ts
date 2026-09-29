import {
  isAppId,
  isDirectChildHost,
  normalizeOrigin,
  normalizeRedirectUri,
  originSchemeAllowed
} from '@/server/auth/app-host'
import { authEnv } from '@/server/auth/env'

export type ParticipatingAppInput = {
  id: string
  name: string
  origin: string
  redirectUris: string[]
}

export type ValidParticipatingApp = {
  id: string
  name: string
  origin: string
  redirectUris: string[]
}

export function authServerOrigin(): string {
  return normalizeOrigin(authEnv.origin()) ?? authEnv.origin()
}

export function authServerHost(): string {
  return new URL(authServerOrigin()).hostname
}

function cleanName(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > 80) return null
  return trimmed
}

function cleanRedirectUris(values: string[], origin: string): string[] | null {
  const cleaned: string[] = []
  for (const value of values) {
    const normalized = normalizeRedirectUri(value.trim(), origin)
    if (!normalized || cleaned.includes(normalized)) return null
    cleaned.push(normalized)
  }
  return cleaned
}

export function validateParticipatingApp(
  input: ParticipatingAppInput
): { ok: true; value: ValidParticipatingApp } | { ok: false; error: string } {
  if (!isAppId(input.id)) {
    return { ok: false, error: 'アプリ ID は小文字・数字・ハイフンの 1〜32 文字です' }
  }
  if (input.id === authEnv.appId()) {
    return { ok: false, error: '認証サーバーと同じアプリ ID は使えません' }
  }

  const name = cleanName(input.name)
  if (!name) {
    return { ok: false, error: '表示名は 1〜80 文字です' }
  }

  const origin = normalizeOrigin(input.origin.trim())
  if (!origin) {
    return { ok: false, error: 'オリジンの形式が正しくありません' }
  }
  if (!originSchemeAllowed(origin, authEnv.parentDomain())) {
    return { ok: false, error: '本番のオリジンは https である必要があります' }
  }

  const host = new URL(origin).hostname
  if (!isDirectChildHost(host, authEnv.parentDomain())) {
    return { ok: false, error: 'ホストは親ドメインの直下のサブドメインである必要があります' }
  }
  if (host === authServerHost()) {
    return { ok: false, error: '認証サーバーと同じホストは登録できません' }
  }

  const redirectUris = cleanRedirectUris(input.redirectUris, origin)
  if (!redirectUris) {
    return {
      ok: false,
      error: '戻り先 URL はアプリのオリジンと一致し、クエリとフラグメントは使えません'
    }
  }

  return { ok: true, value: { id: input.id, name, origin, redirectUris } }
}

export function validateAppDetails(
  origin: string,
  input: { name: string; redirectUris: string[] }
): { ok: true; value: { name: string; redirectUris: string[] } } | { ok: false; error: string } {
  const name = cleanName(input.name)
  if (!name) {
    return { ok: false, error: '表示名は 1〜80 文字です' }
  }
  const redirectUris = cleanRedirectUris(input.redirectUris, origin)
  if (!redirectUris) {
    return {
      ok: false,
      error: '戻り先 URL はアプリのオリジンと一致し、クエリとフラグメントは使えません'
    }
  }
  return { ok: true, value: { name, redirectUris } }
}

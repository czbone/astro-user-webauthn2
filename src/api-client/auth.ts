import { apiFetch, readJson } from './http'
import type { AuthUser } from '@/types/models'

class AuthFetch {
  async me() {
    const res = await apiFetch('/auth/me')
    if (!res) return null
    return readJson<{ user: AuthUser | null }>(res)
  }

  async loginMethod(email: string) {
    const res = await apiFetch('/auth/login/method', {
      method: 'POST',
      body: JSON.stringify({ email })
    })
    if (!res) return null
    return {
      response: res,
      data: await readJson<{ method: string; options?: unknown; error?: string }>(res)
    }
  }

  async loginPassword(email: string, password: string) {
    const res = await apiFetch('/auth/login/password', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    })
    if (!res) return null
    return { response: res, data: await readJson<{ user?: AuthUser; error?: string }>(res) }
  }

  async loginPasskeyVerify(response: unknown) {
    const res = await apiFetch('/auth/login/passkey/verify', {
      method: 'POST',
      body: JSON.stringify({ response })
    })
    if (!res) return null
    return { response: res, data: await readJson<{ user?: AuthUser; error?: string }>(res) }
  }

  async passkeyRegisterOptions() {
    const res = await apiFetch('/auth/passkey/register/options', { method: 'POST', body: '{}' })
    if (!res) return null
    return { response: res, data: await readJson<{ options?: unknown; error?: string }>(res) }
  }

  async passkeyRegisterVerify(response: unknown, deviceName: string) {
    const res = await apiFetch('/auth/passkey/register/verify', {
      method: 'POST',
      body: JSON.stringify({ response, deviceName })
    })
    if (!res) return null
    return { response: res, data: await readJson<{ ok?: boolean; error?: string }>(res) }
  }

  async passwordResetRequest(email: string) {
    const res = await apiFetch('/auth/password-reset/request', {
      method: 'POST',
      body: JSON.stringify({ email })
    })
    if (!res) return null
    return { response: res, data: await readJson<{ message?: string }>(res) }
  }

  async passwordResetConfirm(token: string, password: string) {
    const res = await apiFetch('/auth/password-reset/confirm', {
      method: 'POST',
      body: JSON.stringify({ token, password })
    })
    if (!res) return null
    return {
      response: res,
      data: await readJson<{ ok?: boolean; redirectTo?: string; error?: string }>(res)
    }
  }

  async magicConsume(token: string) {
    const res = await apiFetch('/auth/magic/consume', {
      method: 'POST',
      body: JSON.stringify({ token })
    })
    if (!res) return null
    return {
      response: res,
      data: await readJson<{ ok?: boolean; redirectTo?: string; error?: string }>(res)
    }
  }

  async magicResend(email: string) {
    const res = await apiFetch('/auth/magic/resend', {
      method: 'POST',
      body: JSON.stringify({ email })
    })
    if (!res) return null
    return { response: res, data: await readJson<{ message?: string }>(res) }
  }

  async logout() {
    const res = await apiFetch('/auth/logout', { method: 'POST', body: '{}' })
    if (!res) return null
    return { response: res, data: await readJson<{ ok?: boolean; error?: string }>(res) }
  }

  async logoutAll() {
    const res = await apiFetch('/auth/logout-all', { method: 'POST', body: '{}' })
    if (!res) return null
    return { response: res, data: await readJson<{ ok?: boolean; error?: string }>(res) }
  }
}

export default new AuthFetch()

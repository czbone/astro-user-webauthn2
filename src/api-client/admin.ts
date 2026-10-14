import type { UserRole } from '@/types/models'
import { apiFetch, readJson } from './http'

class AdminFetch {
  async getStats() {
    const res = await apiFetch('/admin/stats')
    if (!res) return null
    return {
      response: res,
      data: await readJson<{
        userCount: number
        adminCount: number
        error?: string
      }>(res)
    }
  }

  async getUsers() {
    const res = await apiFetch('/admin/users')
    if (!res) return null
    return { response: res, data: await readJson<unknown>(res) }
  }

  async listEmailChanges() {
    const res = await apiFetch('/admin/email-changes')
    if (!res) return null
    return {
      response: res,
      data: await readJson<
        | { userId: string; email: string; createdAt: string; verifiedAt: string | null }[]
        | { error?: string }
      >(res)
    }
  }

  async requestEmailChange(input: { userId: string; email: string }) {
    const res = await apiFetch('/admin/email-changes', {
      method: 'POST',
      body: JSON.stringify(input)
    })
    if (!res) return null
    return { response: res, data: await readJson<{ ok?: boolean; error?: string }>(res) }
  }

  async emailChangeReauthOptions() {
    const res = await apiFetch('/admin/email-changes/reauth/options', {
      method: 'POST',
      body: '{}'
    })
    if (!res) return null
    return { response: res, data: await readJson<{ options?: unknown; error?: string }>(res) }
  }

  async emailChangeReauthVerify(response: unknown) {
    const res = await apiFetch('/admin/email-changes/reauth/verify', {
      method: 'POST',
      body: JSON.stringify({ response })
    })
    if (!res) return null
    return { response: res, data: await readJson<{ ok?: boolean; error?: string }>(res) }
  }

  async commitEmailChange(userId: string) {
    const res = await apiFetch(`/admin/email-changes/${encodeURIComponent(userId)}/commit`, {
      method: 'POST',
      body: '{}'
    })
    if (!res) return null
    return {
      response: res,
      data: await readJson<{ ok?: boolean; email?: string; selfRevoked?: boolean; error?: string }>(
        res
      )
    }
  }

  async createUser(input: { email: string; name: string; role: UserRole }) {
    const res = await apiFetch('/admin/users', {
      method: 'POST',
      body: JSON.stringify(input)
    })
    if (!res) return null
    return { response: res, data: await readJson<{ error?: string }>(res) }
  }

  async getApps() {
    const res = await apiFetch('/admin/apps')
    if (!res) return null
    return { response: res, data: await readJson<unknown>(res) }
  }

  async createApp(input: {
    id: string
    name: string
    origin: string
    redirectUris: string[]
    defaultPermission: 'admin' | 'user' | null
  }) {
    const res = await apiFetch('/admin/apps', {
      method: 'POST',
      body: JSON.stringify(input)
    })
    if (!res) return null
    return { response: res, data: await readJson<{ error?: string }>(res) }
  }

  async updateApp(
    id: string,
    input: { name: string; redirectUris: string[]; defaultPermission?: 'admin' | 'user' | null }
  ) {
    const res = await apiFetch(`/admin/apps/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input)
    })
    if (!res) return null
    return { response: res, data: await readJson<{ error?: string }>(res) }
  }

  async deleteApp(id: string) {
    const res = await apiFetch(`/admin/apps/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!res) return null
    return { response: res, data: await readJson<{ error?: string }>(res) }
  }

  async getGrants() {
    const res = await apiFetch('/admin/grants')
    if (!res) return null
    return { response: res, data: await readJson<unknown>(res) }
  }

  async saveGrant(input: { userId: string; appId: string; permission: 'admin' | 'user' | 'none' }) {
    const res = await apiFetch('/admin/grants', {
      method: 'PUT',
      body: JSON.stringify(input)
    })
    if (!res) return null
    return { response: res, data: await readJson<{ error?: string }>(res) }
  }

  async deleteGrant(userId: string, appId: string) {
    const res = await apiFetch(
      `/admin/grants/${encodeURIComponent(userId)}/${encodeURIComponent(appId)}`,
      { method: 'DELETE' }
    )
    if (!res) return null
    return { response: res, data: await readJson<{ error?: string }>(res) }
  }
}

export default new AdminFetch()

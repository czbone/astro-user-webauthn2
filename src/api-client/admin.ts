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
        postCount: number
        publishedPostCount: number
        error?: string
      }>(res)
    }
  }

  async getUsers() {
    const res = await apiFetch('/admin/users')
    if (!res) return null
    return { response: res, data: await readJson<unknown>(res) }
  }

  async createUser(input: { email: string; name: string; role: 'admin' | 'user' }) {
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

  async createApp(input: { id: string; name: string; origin: string; redirectUris: string[] }) {
    const res = await apiFetch('/admin/apps', {
      method: 'POST',
      body: JSON.stringify(input)
    })
    if (!res) return null
    return { response: res, data: await readJson<{ error?: string }>(res) }
  }

  async updateApp(id: string, input: { name: string; redirectUris: string[] }) {
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

  async saveGrant(input: { userId: string; appId: string; permission: 'admin' | 'user' }) {
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

import { apiFetch, readJson } from './http'
import type { DeviceCredential } from '@/types/models'

class DeviceFetch {
  async list() {
    const res = await apiFetch('/devices')
    if (!res) return null
    return { response: res, data: await readJson<DeviceCredential[] | { error?: string }>(res) }
  }

  async remove(id: string) {
    const res = await apiFetch(`/devices/${id}`, { method: 'DELETE' })
    if (!res) return null
    return { response: res, data: await readJson<{ ok?: boolean; error?: string }>(res) }
  }

  async reauthOptions() {
    const res = await apiFetch('/devices/reauth/options', { method: 'POST', body: '{}' })
    if (!res) return null
    return { response: res, data: await readJson<{ options?: unknown; error?: string }>(res) }
  }

  async reauthVerify(response: unknown) {
    const res = await apiFetch('/devices/reauth/verify', {
      method: 'POST',
      body: JSON.stringify({ response })
    })
    if (!res) return null
    return { response: res, data: await readJson<{ ok?: boolean; error?: string }>(res) }
  }

  async invite() {
    const res = await apiFetch('/devices/invite', { method: 'POST', body: '{}' })
    if (!res) return null
    return {
      response: res,
      data: await readJson<{ ok?: boolean; message?: string; error?: string }>(res)
    }
  }

  async registerOptions(token: string) {
    const res = await apiFetch('/devices/register/options', {
      method: 'POST',
      body: JSON.stringify({ token })
    })
    if (!res) return null
    return {
      response: res,
      data: await readJson<{ options?: unknown; email?: string; name?: string; error?: string }>(
        res
      )
    }
  }

  async registerVerify(token: string, response: unknown, deviceName: string) {
    const res = await apiFetch('/devices/register/verify', {
      method: 'POST',
      body: JSON.stringify({ token, response, deviceName })
    })
    if (!res) return null
    return { response: res, data: await readJson<{ ok?: boolean; error?: string }>(res) }
  }
}

export default new DeviceFetch()

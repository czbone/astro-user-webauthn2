export const API_BASE = '/api'

export async function apiFetch(path: string, init?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(`${API_BASE}${path}`, {
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {})
      },
      ...init
    })
  } catch (error) {
    console.error('API通信エラー:', error)
    return null
  }
}

export async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T
  } catch {
    return null
  }
}

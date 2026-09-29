import { apiFetch, readJson } from './http'
import type { Post } from '@/types/models'

class PostFetch {
  async getPosts() {
    const res = await apiFetch('/posts')
    if (!res) return null
    return { response: res, data: await readJson<Post[] | { error?: string }>(res) }
  }

  async createPost(input: { title: string; content?: string; published?: boolean }) {
    const res = await apiFetch('/posts', {
      method: 'POST',
      body: JSON.stringify(input)
    })
    if (!res) return null
    return { response: res, data: await readJson<Post | { error?: string }>(res) }
  }

  async updatePost(
    id: string,
    input: { title?: string; content?: string | null; published?: boolean }
  ) {
    const res = await apiFetch(`/posts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input)
    })
    if (!res) return null
    return { response: res, data: await readJson<Post | { error?: string }>(res) }
  }

  async deletePost(id: string) {
    const res = await apiFetch(`/posts/${id}`, { method: 'DELETE' })
    if (!res) return null
    return { response: res, data: await readJson<{ message?: string; error?: string }>(res) }
  }
}

export default new PostFetch()

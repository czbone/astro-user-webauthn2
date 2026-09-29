import { useEffect, useState } from 'react'
import PostFetch from '@/api-client/posts'
import type { Post } from '@/types/models'

type Props = {
  currentUserId: string
}

export default function PostsSection({ currentUserId }: Props) {
  const [posts, setPosts] = useState<Post[]>([])
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [published, setPublished] = useState(false)
  const [loading, setLoading] = useState(false)

  async function load() {
    const result = await PostFetch.getPosts()
    if (!result || !result.response.ok || !Array.isArray(result.data)) {
      alert((result?.data as { error?: string })?.error || '投稿の取得に失敗しました')
      return
    }
    setPosts(result.data)
  }

  useEffect(() => {
    void load()
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const result = await PostFetch.createPost({ title, content, published })
      if (!result || !result.response.ok) {
        alert((result?.data as { error?: string })?.error || '投稿の作成に失敗しました')
        return
      }
      setTitle('')
      setContent('')
      setPublished(false)
      await load()
    } finally {
      setLoading(false)
    }
  }

  async function togglePublished(post: Post) {
    const result = await PostFetch.updatePost(post.id, { published: !post.published })
    if (!result || !result.response.ok) {
      alert((result?.data as { error?: string })?.error || '更新に失敗しました')
      return
    }
    await load()
  }

  async function handleDelete(id: string) {
    if (!confirm('この投稿を削除しますか？')) return
    const result = await PostFetch.deletePost(id)
    if (!result || !result.response.ok) {
      alert(result?.data?.error || '削除に失敗しました')
      return
    }
    await load()
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleCreate} className="rounded-lg bg-white p-6 shadow">
        <h2 className="mb-4 text-xl font-semibold text-gray-900">新規投稿</h2>
        <div className="mb-3">
          <label className="mb-1 block text-sm text-gray-700">タイトル</label>
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>
        <div className="mb-3">
          <label className="mb-1 block text-sm text-gray-700">本文</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            className="w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>
        <label className="mb-4 flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={published}
            onChange={(e) => setPublished(e.target.checked)}
          />
          公開する
        </label>
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-gray-800 px-4 py-2 text-white hover:bg-gray-700 disabled:opacity-50"
        >
          作成
        </button>
      </form>

      <div className="rounded-lg bg-white p-6 shadow">
        <h2 className="mb-4 text-xl font-semibold text-gray-900">投稿一覧</h2>
        <ul className="space-y-4">
          {posts.map((post) => {
            const owned = post.authorId === currentUserId
            return (
              <li key={post.id} className="rounded border border-gray-200 p-4">
                <div className="mb-2 flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-medium text-gray-900">{post.title}</h3>
                    <p className="text-sm text-gray-500">
                      {post.author.name} / {post.published ? '公開' : '下書き'}
                    </p>
                  </div>
                  {owned && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => togglePublished(post)}
                        className="rounded border px-2 py-1 text-sm"
                      >
                        {post.published ? '非公開にする' : '公開する'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(post.id)}
                        className="rounded border border-red-300 px-2 py-1 text-sm text-red-700"
                      >
                        削除
                      </button>
                    </div>
                  )}
                </div>
                {post.content && (
                  <p className="whitespace-pre-wrap text-gray-700">{post.content}</p>
                )}
              </li>
            )
          })}
          {posts.length === 0 && <li className="text-sm text-gray-500">投稿がありません</li>}
        </ul>
      </div>
    </div>
  )
}

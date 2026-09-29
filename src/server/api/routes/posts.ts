import { Hono } from 'hono'
import { PostDB } from '@/server/db'
import {
  loadSession,
  requireAppGrant,
  requireAuth,
  requirePasskey,
  slideSessionAfterAuth
} from '@/server/middleware/auth'
import type { AppVariables } from '@/server/middleware/types'

function isPrismaError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === code
  )
}

const posts = new Hono<{ Variables: AppVariables }>()

posts.use('*', loadSession, requireAuth, requirePasskey, requireAppGrant, slideSessionAfterAuth)

posts.get('/', async (c) => {
  try {
    const user = c.get('user')
    const result = await PostDB.listForViewer({
      id: user.id,
      permission: c.get('appPermission')
    })
    return c.json(result, 200)
  } catch (error) {
    console.error('投稿取得エラー:', error)
    return c.json({ error: '投稿の取得に失敗しました' }, 500)
  }
})

posts.post('/', async (c) => {
  try {
    const user = c.get('user')
    const body = await c.req.json()
    const title = String(body.title || '').trim()
    const content = body.content != null ? String(body.content) : null
    const published = Boolean(body.published)

    if (!title) {
      return c.json({ error: 'タイトルは必須です' }, 400)
    }

    const post = await PostDB.create({
      title,
      content,
      published,
      authorId: user.id
    })

    return c.json(post, 201)
  } catch (error) {
    console.error('投稿作成エラー:', error)
    return c.json({ error: '投稿の作成に失敗しました' }, 500)
  }
})

posts.get('/:id', async (c) => {
  try {
    const user = c.get('user')
    const post = await PostDB.getByIdForViewer(c.req.param('id'), {
      id: user.id,
      permission: c.get('appPermission')
    })
    if (!post) {
      return c.json({ error: '投稿が見つかりません' }, 404)
    }
    return c.json(post, 200)
  } catch (error) {
    console.error('投稿詳細取得エラー:', error)
    return c.json({ error: '投稿の取得に失敗しました' }, 500)
  }
})

posts.patch('/:id', async (c) => {
  try {
    const user = c.get('user')
    const body = await c.req.json()
    const post = await PostDB.updateOwned(c.req.param('id'), user.id, {
      ...(body.title !== undefined && { title: String(body.title) }),
      ...(body.content !== undefined && { content: body.content }),
      ...(body.published !== undefined && { published: Boolean(body.published) })
    })

    if (!post) {
      return c.json({ error: '投稿が見つからないか、編集権限がありません' }, 404)
    }

    return c.json(post, 200)
  } catch (error: unknown) {
    if (isPrismaError(error, 'P2025')) {
      return c.json({ error: '投稿が見つかりません' }, 404)
    }
    console.error('投稿更新エラー:', error)
    return c.json({ error: '投稿の更新に失敗しました' }, 500)
  }
})

posts.delete('/:id', async (c) => {
  try {
    const user = c.get('user')
    const ok = await PostDB.deleteOwned(c.req.param('id'), user.id)
    if (!ok) {
      return c.json({ error: '投稿が見つからないか、削除権限がありません' }, 404)
    }
    return c.json({ message: '投稿を削除しました' }, 200)
  } catch (error: unknown) {
    if (isPrismaError(error, 'P2025')) {
      return c.json({ error: '投稿が見つかりません' }, 404)
    }
    console.error('投稿削除エラー:', error)
    return c.json({ error: '投稿の削除に失敗しました' }, 500)
  }
})

export default posts

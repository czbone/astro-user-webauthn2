import { useEffect, useState } from 'react'
import AdminFetch from '@/api-client/admin'

type PositivePermission = 'admin' | 'user'
type DefaultPermission = PositivePermission | null
type GrantPermission = PositivePermission | 'none'

type AppRow = {
  id: string
  name: string
  origin: string
  redirectUris: string[]
  defaultPermission: string | null
  isAuthServer: boolean
}

type UserRow = {
  id: string
  email: string
  name: string
}

type GrantRow = {
  id: string
  userId: string
  appId: string
  permission: string
}

const ADMIN_DEFAULT_CONFIRM = '個別の例外がない現在および今後の全利用者に管理者権限が適用される'

function lines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function parseDefaultChoice(value: string): DefaultPermission | undefined {
  if (value === 'null') return null
  if (value === 'user' || value === 'admin') return value
  return undefined
}

function encodeDefaultChoice(value: string | null): string {
  if (value === 'user' || value === 'admin') return value
  return 'null'
}

function grantLabel(permission: string): string {
  if (permission === 'admin') return '管理者'
  if (permission === 'user') return '利用者'
  if (permission === 'none') return '利用不可'
  return permission
}

function confirmAdminDefault(current: string | null, next: DefaultPermission): boolean {
  if (next !== 'admin' || current === 'admin') return true
  return confirm(ADMIN_DEFAULT_CONFIRM)
}

export default function AdminAppsSection() {
  const [apps, setApps] = useState<AppRow[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [grants, setGrants] = useState<GrantRow[]>([])
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [origin, setOrigin] = useState('')
  const [redirectUris, setRedirectUris] = useState('')
  const [defaultPermission, setDefaultPermission] = useState('')
  const [grantUserId, setGrantUserId] = useState('')
  const [grantAppId, setGrantAppId] = useState('')
  const [permission, setPermission] = useState<GrantPermission>('user')
  const [loading, setLoading] = useState(false)

  async function load() {
    const [appResult, userResult, grantResult] = await Promise.all([
      AdminFetch.getApps(),
      AdminFetch.getUsers(),
      AdminFetch.getGrants()
    ])
    if (!appResult?.response.ok || !Array.isArray(appResult.data)) {
      alert((appResult?.data as { error?: string })?.error || 'アプリ一覧の取得に失敗しました')
      return
    }
    if (!userResult?.response.ok || !Array.isArray(userResult.data)) {
      alert((userResult?.data as { error?: string })?.error || 'ユーザー一覧の取得に失敗しました')
      return
    }
    if (!grantResult?.response.ok || !Array.isArray(grantResult.data)) {
      alert((grantResult?.data as { error?: string })?.error || '権限一覧の取得に失敗しました')
      return
    }
    setApps(appResult.data as AppRow[])
    setUsers(userResult.data as UserRow[])
    setGrants(grantResult.data as GrantRow[])
  }

  useEffect(() => {
    void load()
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const choice = parseDefaultChoice(defaultPermission)
    if (choice === undefined) {
      alert('既定の権限を選択してください')
      return
    }
    if (!confirmAdminDefault(null, choice)) return
    setLoading(true)
    try {
      const result = await AdminFetch.createApp({
        id,
        name,
        origin,
        redirectUris: lines(redirectUris),
        defaultPermission: choice
      })
      if (!result || !result.response.ok) {
        alert(result?.data?.error || 'アプリの登録に失敗しました')
        return
      }
      setId('')
      setName('')
      setOrigin('')
      setRedirectUris('')
      setDefaultPermission('')
      await load()
    } finally {
      setLoading(false)
    }
  }

  async function handleUpdate(
    app: AppRow,
    next: { name: string; redirectUris: string; defaultPermission?: DefaultPermission }
  ) {
    const result = await AdminFetch.updateApp(app.id, {
      name: next.name,
      redirectUris: lines(next.redirectUris),
      ...(next.defaultPermission !== undefined ? { defaultPermission: next.defaultPermission } : {})
    })
    if (!result || !result.response.ok) {
      alert(result?.data?.error || 'アプリの更新に失敗しました')
      return
    }
    await load()
  }

  async function handleDelete(appId: string) {
    if (!confirm('このアプリを削除しますか？')) return
    const result = await AdminFetch.deleteApp(appId)
    if (!result || !result.response.ok) {
      alert(result?.data?.error || 'アプリの削除に失敗しました')
      return
    }
    await load()
  }

  async function handleGrant(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const result = await AdminFetch.saveGrant({
        userId: grantUserId,
        appId: grantAppId,
        permission
      })
      if (!result || !result.response.ok) {
        alert(result?.data?.error || '権限の保存に失敗しました')
        return
      }
      await load()
    } finally {
      setLoading(false)
    }
  }

  async function handleDeleteGrant(userId: string, appId: string) {
    const result = await AdminFetch.deleteGrant(userId, appId)
    if (!result || !result.response.ok) {
      alert(result?.data?.error || '権限の削除に失敗しました')
      return
    }
    await load()
  }

  const grantApps = apps.filter((app) => !app.isAuthServer)

  return (
    <div className="space-y-8">
      <form onSubmit={handleCreate} className="rounded-lg bg-white p-6 shadow">
        <h2 className="mb-4 text-xl font-semibold text-gray-900">アプリを登録</h2>
        <div className="mb-3 grid gap-3 md:grid-cols-2">
          <label className="block text-sm text-gray-700">
            アプリ ID
            <input
              required
              value={id}
              onChange={(e) => setId(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm text-gray-700">
            表示名
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm text-gray-700 md:col-span-2">
            オリジン
            <input
              required
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              placeholder="https://app.example.com"
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm text-gray-700 md:col-span-2">
            戻り先 URL（1行に1件）
            <textarea
              value={redirectUris}
              onChange={(e) => setRedirectUris(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm text-gray-700 md:col-span-2">
            既定の権限
            <select
              required
              value={defaultPermission}
              onChange={(e) => setDefaultPermission(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            >
              <option value="">選択</option>
              <option value="null">個別に付与した人だけ</option>
              <option value="user">全利用者に利用者権限</option>
              <option value="admin">全利用者に管理者権限</option>
            </select>
          </label>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-gray-800 px-4 py-2 text-white hover:bg-gray-700 disabled:opacity-50"
        >
          登録
        </button>
      </form>

      <section className="space-y-4">
        {apps.map((app) => (
          <AppEditor key={app.id} app={app} onUpdate={handleUpdate} onDelete={handleDelete} />
        ))}
      </section>

      <form onSubmit={handleGrant} className="rounded-lg bg-white p-6 shadow">
        <h2 className="mb-4 text-xl font-semibold text-gray-900">利用権限</h2>
        <div className="mb-3 grid gap-3 md:grid-cols-3">
          <label className="block text-sm text-gray-700">
            ユーザー
            <select
              required
              value={grantUserId}
              onChange={(e) => setGrantUserId(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            >
              <option value="">選択</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}（{user.email}）
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-gray-700">
            アプリ
            <select
              required
              value={grantAppId}
              onChange={(e) => setGrantAppId(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            >
              <option value="">選択</option>
              {grantApps.map((app) => (
                <option key={app.id} value={app.id}>
                  {app.name}（{app.id}）
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-gray-700">
            権限
            <select
              value={permission}
              onChange={(e) => {
                const value = e.target.value
                setPermission(value === 'admin' || value === 'none' ? value : 'user')
              }}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            >
              <option value="user">利用者</option>
              <option value="admin">管理者</option>
              <option value="none">利用不可</option>
            </select>
          </label>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-gray-800 px-4 py-2 text-white hover:bg-gray-700 disabled:opacity-50"
        >
          保存
        </button>
        <ul className="mt-4 space-y-2">
          {grants.map((grant) => {
            const user = users.find((item) => item.id === grant.userId)
            const app = apps.find((item) => item.id === grant.appId)
            return (
              <li
                key={grant.id}
                className="flex items-center justify-between text-sm text-gray-800"
              >
                <span>
                  {user?.email ?? grant.userId} / {app?.name ?? grant.appId} /{' '}
                  {grantLabel(grant.permission)}
                </span>
                <button
                  type="button"
                  onClick={() => void handleDeleteGrant(grant.userId, grant.appId)}
                  className="text-red-700 underline"
                >
                  削除
                </button>
              </li>
            )
          })}
        </ul>
      </form>
    </div>
  )
}

function AppEditor({
  app,
  onUpdate,
  onDelete
}: {
  app: AppRow
  onUpdate: (
    app: AppRow,
    next: { name: string; redirectUris: string; defaultPermission?: DefaultPermission }
  ) => Promise<void>
  onDelete: (appId: string) => Promise<void>
}) {
  const [name, setName] = useState(app.name)
  const [redirectUris, setRedirectUris] = useState(app.redirectUris.join('\n'))
  const [defaultChoice, setDefaultChoice] = useState(encodeDefaultChoice(app.defaultPermission))

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (app.isAuthServer) {
      void onUpdate(app, { name, redirectUris })
      return
    }
    const nextDefault = parseDefaultChoice(defaultChoice)
    if (nextDefault === undefined) return
    if (!confirmAdminDefault(app.defaultPermission, nextDefault)) return
    void onUpdate(app, { name, redirectUris, defaultPermission: nextDefault })
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg bg-white p-6 shadow">
      <h2 className="mb-1 text-lg font-semibold text-gray-900">{app.id}</h2>
      <p className="mb-3 text-sm text-gray-600">{app.origin}</p>
      <div className="mb-3 grid gap-3 md:grid-cols-2">
        <label className="block text-sm text-gray-700">
          表示名
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="block text-sm text-gray-700">
          戻り先 URL
          <textarea
            value={redirectUris}
            onChange={(e) => setRedirectUris(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
        {app.isAuthServer ? (
          <p className="text-sm text-gray-700 md:col-span-2">既定の権限: 対象外</p>
        ) : (
          <label className="block text-sm text-gray-700 md:col-span-2">
            既定の権限
            <select
              required
              value={defaultChoice}
              onChange={(e) => setDefaultChoice(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            >
              <option value="null">個別に付与した人だけ</option>
              <option value="user">全利用者に利用者権限</option>
              <option value="admin">全利用者に管理者権限</option>
            </select>
          </label>
        )}
      </div>
      <div className="flex gap-3">
        <button
          type="submit"
          className="rounded bg-gray-800 px-4 py-2 text-white hover:bg-gray-700"
        >
          更新
        </button>
        <button
          type="button"
          onClick={() => void onDelete(app.id)}
          className="rounded border border-red-700 px-4 py-2 text-red-700"
        >
          削除
        </button>
      </div>
    </form>
  )
}

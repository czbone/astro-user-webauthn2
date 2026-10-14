import { useEffect, useState } from 'react'
import AdminEmailChangeSection from '@/components/AdminEmailChangeSection'
import AdminFetch from '@/api-client/admin'
import {
  assignableRoles,
  canChangeUserEmail,
  canManageUsers,
  isUserRole,
  roleLabel
} from '@/lib/user-role'
import type { UserRole } from '@/types/models'

type UserRow = {
  id: string
  email: string
  name: string
  role: string
  createdAt: string
  credentialCount: number
}

export default function AdminUsersSection({ actorRole }: { actorRole: UserRole }) {
  const roles = assignableRoles(actorRole)
  const [users, setUsers] = useState<UserRow[]>([])
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<UserRole>('user')
  const [loading, setLoading] = useState(false)

  async function load() {
    const result = await AdminFetch.getUsers()
    if (!result || !result.response.ok || !Array.isArray(result.data)) {
      alert((result?.data as { error?: string })?.error || 'ユーザー一覧の取得に失敗しました')
      return
    }
    setUsers(result.data as UserRow[])
  }

  useEffect(() => {
    void load()
  }, [])

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const result = await AdminFetch.createUser({ email, name, role })
      if (!result || !result.response.ok) {
        alert(result?.data?.error || '招待に失敗しました')
        return
      }
      setEmail('')
      setName('')
      setRole('user')
      alert('ユーザーを作成し、ログイン用リンクをメール送信しました')
      await load()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleInvite} className="rounded-lg bg-white p-6 shadow">
        <h2 className="mb-4 text-xl font-semibold text-gray-900">ユーザーを招待</h2>
        <div className="mb-3 grid gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm text-gray-700">メールアドレス</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-700">名前</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2"
            />
          </div>
        </div>
        <div className="mb-4">
          <label className="mb-1 block text-sm text-gray-700">ロール</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            className="rounded border border-gray-300 px-3 py-2"
          >
            {roles.map((value) => (
              <option key={value} value={value}>
                {roleLabel(value)}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-gray-800 px-4 py-2 text-white hover:bg-gray-700 disabled:opacity-50"
        >
          ログイン用リンクを送って招待
        </button>
      </form>

      {canManageUsers(actorRole) && (
        <AdminEmailChangeSection
          users={users.filter((user) => canChangeUserEmail(actorRole, user.role))}
          onChanged={load}
        />
      )}

      <div className="rounded-lg bg-white p-6 shadow">
        <h2 className="mb-4 text-xl font-semibold text-gray-900">ユーザー一覧</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b text-gray-600">
                <th className="py-2 pr-4">名前</th>
                <th className="py-2 pr-4">メール</th>
                <th className="py-2 pr-4">ロール</th>
                <th className="py-2">パスキー</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-gray-100">
                  <td className="py-2 pr-4">{user.name}</td>
                  <td className="py-2 pr-4">{user.email}</td>
                  <td className="py-2 pr-4">
                    {isUserRole(user.role) ? roleLabel(user.role) : user.role}
                  </td>
                  <td className="py-2">{user.credentialCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

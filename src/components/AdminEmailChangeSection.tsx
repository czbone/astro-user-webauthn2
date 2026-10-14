import { useEffect, useState } from 'react'
import { startAuthentication } from '@simplewebauthn/browser'
import AdminFetch from '@/api-client/admin'

type UserRow = {
  id: string
  email: string
  name: string
}

type PendingChange = {
  userId: string
  email: string
  createdAt: string
  verifiedAt: string | null
}

export default function AdminEmailChangeSection({
  users,
  onChanged
}: {
  users: UserRow[]
  onChanged: () => Promise<void>
}) {
  const [pending, setPending] = useState<PendingChange[]>([])
  const [userId, setUserId] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)

  async function loadPending() {
    const result = await AdminFetch.listEmailChanges()
    if (!result || !result.response.ok || !Array.isArray(result.data)) {
      alert((result?.data as { error?: string })?.error || '変更申請の取得に失敗しました')
      return
    }
    setPending(result.data)
  }

  useEffect(() => {
    void loadPending()
  }, [])

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const result = await AdminFetch.requestEmailChange({ userId, email })
      if (!result || !result.response.ok) {
        alert(result?.data?.error || '確認メールの送信に失敗しました')
        return
      }
      setEmail('')
      alert('確認メールを送信しました。受信確認のあと、パスキーで確定してください。')
      await loadPending()
    } finally {
      setLoading(false)
    }
  }

  async function handleCommit(targetUserId: string) {
    setLoading(true)
    try {
      const optionsResult = await AdminFetch.emailChangeReauthOptions()
      if (!optionsResult || !optionsResult.response.ok || !optionsResult.data?.options) {
        alert(optionsResult?.data?.error || '再認証の開始に失敗しました')
        return
      }

      const assertion = await startAuthentication({
        optionsJSON: optionsResult.data.options as Parameters<
          typeof startAuthentication
        >[0]['optionsJSON']
      })

      const verifyResult = await AdminFetch.emailChangeReauthVerify(assertion)
      if (!verifyResult || !verifyResult.response.ok) {
        alert(verifyResult?.data?.error || '再認証に失敗しました')
        return
      }

      const commitResult = await AdminFetch.commitEmailChange(targetUserId)
      if (!commitResult || !commitResult.response.ok) {
        alert(commitResult?.data?.error || 'メールアドレスの確定に失敗しました')
        return
      }
      if (commitResult.data?.selfRevoked) {
        window.location.href = '/login'
        return
      }
      alert('メールアドレスを変更しました。対象ユーザーは新しいアドレスでログインし直します。')
      await onChanged()
      await loadPending()
    } catch (error) {
      console.error(error)
      alert('操作がキャンセルされたか失敗しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-lg bg-white p-6 shadow">
      <h2 className="mb-2 text-xl font-semibold text-gray-900">メールアドレスを変更</h2>
      <p className="mb-4 text-sm text-gray-600">
        新しいアドレスへ確認メールを送ります。受信確認のあと、あなたのパスキーで確定するとアドレスが変わり、そのユーザーの全セッションが切れます。
      </p>
      <form onSubmit={handleRequest} className="mb-6 grid gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm text-gray-700">ユーザー</label>
          <select
            required
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2"
          >
            <option value="">選択してください</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}（{user.email}）
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm text-gray-700">新しいメールアドレス</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>
        <div className="md:col-span-2">
          <button
            type="submit"
            disabled={loading}
            className="rounded bg-gray-800 px-4 py-2 text-white hover:bg-gray-700 disabled:opacity-50"
          >
            確認メールを送る
          </button>
        </div>
      </form>

      <h3 className="mb-2 text-sm font-semibold text-gray-800">手続き中</h3>
      {pending.length === 0 ? (
        <p className="text-sm text-gray-500">手続き中の変更はありません</p>
      ) : (
        <ul className="divide-y divide-gray-100 text-sm">
          {pending.map((item) => {
            const user = users.find((row) => row.id === item.userId)
            return (
              <li
                key={item.userId}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div>
                  <p className="font-medium text-gray-900">
                    {user?.name || 'ユーザー'} → {item.email}
                  </p>
                  <p className="text-gray-500">{item.verifiedAt ? '受信済み' : '受信確認待ち'}</p>
                </div>
                {item.verifiedAt && (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void handleCommit(item.userId)}
                    className="rounded bg-gray-800 px-3 py-2 text-white hover:bg-gray-700 disabled:opacity-50"
                  >
                    再認証して確定
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

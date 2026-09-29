import { useState } from 'react'
import AuthFetch from '@/api-client/auth'

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const result = await AuthFetch.passwordResetRequest(email)
      setMessage(
        result?.data?.message ||
          '入力されたメールアドレスにアカウントがある場合、再設定手順を送信しました'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-md rounded-lg bg-white p-6 shadow">
      <h2 className="mb-4 text-xl font-semibold text-gray-900">ログインできないとき</h2>
      <p className="mb-4 text-sm text-gray-600">
        パスキーでログインできない場合の復旧です。完了すると、登録済みのパスキーはすべて無効になります。
      </p>
      {message ? (
        <p className="text-sm text-gray-800">{message}</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
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
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-gray-800 px-4 py-2 text-white hover:bg-gray-700 disabled:opacity-50"
          >
            復旧メールを送信
          </button>
        </form>
      )}
      <p className="mt-6 text-center text-sm">
        <a href="/login" className="text-gray-700 underline">
          ログインに戻る
        </a>
      </p>
    </div>
  )
}

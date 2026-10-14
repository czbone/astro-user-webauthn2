import { useState } from 'react'
import AuthFetch from '@/api-client/auth'

type Props = {
  token: string
}

export default function EmailChangeVerifyForm({ token }: Props) {
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function handleVerify() {
    setLoading(true)
    try {
      const result = await AuthFetch.verifyEmailChange(token)
      if (!result || !result.response.ok) {
        alert(result?.data?.error || '確認リンクが無効です')
        return
      }
      setDone(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-md rounded-lg bg-white p-6 shadow">
      <h2 className="mb-2 text-xl font-semibold text-gray-900">メールアドレスの確認</h2>
      {done ? (
        <p className="text-sm text-gray-700">
          受信を確認しました。メールアドレスは、管理者が確定するまで変わりません。このページではログインしません。
        </p>
      ) : (
        <>
          <p className="mb-4 text-sm text-gray-600">
            このアドレスでメールを受け取れることを確認します。ボタンを押してもログインせず、メールアドレスはまだ変わりません。
          </p>
          <button
            type="button"
            disabled={loading}
            onClick={() => void handleVerify()}
            className="w-full rounded bg-gray-800 px-4 py-2 text-white hover:bg-gray-700 disabled:opacity-50"
          >
            受信を確認する
          </button>
        </>
      )}
    </div>
  )
}

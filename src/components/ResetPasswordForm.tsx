import { useState } from 'react'
import AuthFetch from '@/api-client/auth'

type Props = {
  token: string
}

function PasswordField({
  id,
  label,
  value,
  onChange
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const [visible, setVisible] = useState(false)

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm text-gray-700">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          required
          minLength={8}
          autoComplete="new-password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? `${label}を隠す` : `${label}を表示`}
          aria-pressed={visible}
          className="shrink-0 rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          {visible ? '隠す' : '表示'}
        </button>
      </div>
    </div>
  )
}

export default function ResetPasswordForm({ token }: Props) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) {
      alert('パスワードは8文字以上にしてください')
      return
    }
    if (password !== confirm) {
      alert('パスワードが一致しません')
      return
    }

    setLoading(true)
    try {
      const result = await AuthFetch.passwordResetConfirm(token, password)
      if (!result || !result.response.ok) {
        alert(result?.data?.error || 'パスワード再設定に失敗しました')
        return
      }
      window.location.href = result.data?.redirectTo || '/setup-passkey'
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-md rounded-lg bg-white p-6 shadow">
      <h2 className="mb-2 text-xl font-semibold text-gray-900">復旧用のパスワードを設定</h2>
      <p className="mb-4 text-sm text-red-700">
        注意:
        この操作を完了すると、登録済みのパスキーはすべて無効になります。ここで決めたパスワードは、パスキー再登録までの一時的な入場手段です。
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <PasswordField
          id="new-password"
          label="新しいパスワード"
          value={password}
          onChange={setPassword}
        />
        <PasswordField id="confirm-password" label="確認" value={confirm} onChange={setConfirm} />
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-gray-800 px-4 py-2 text-white hover:bg-gray-700 disabled:opacity-50"
        >
          復旧して続行
        </button>
      </form>
    </div>
  )
}

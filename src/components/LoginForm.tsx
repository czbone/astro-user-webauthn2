import { useState } from 'react'
import { startAuthentication } from '@simplewebauthn/browser'
import AuthFetch from '@/api-client/auth'

export default function LoginForm({ next }: { next?: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [step, setStep] = useState<'email' | 'magic' | 'passkey'>('email')
  const [passkeyOptions, setPasskeyOptions] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const [resendMessage, setResendMessage] = useState('')

  async function handleContinue(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const result = await AuthFetch.loginMethod(email)
      if (!result || !result.response.ok) {
        alert(result?.data?.error || 'ログインに失敗しました')
        return
      }

      if (result.data?.method === 'passkey' && result.data.options) {
        setPasskeyOptions(result.data.options)
        setStep('passkey')
        return
      }

      setResendMessage('')
      setStep('magic')
    } finally {
      setLoading(false)
    }
  }

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const result = await AuthFetch.loginPassword(email, password)
      if (!result || !result.response.ok) {
        alert(result?.data?.error || 'ログインに失敗しました')
        return
      }
      window.location.href = '/setup-passkey'
    } finally {
      setLoading(false)
    }
  }

  async function handleResend() {
    setLoading(true)
    try {
      const result = await AuthFetch.magicResend(email)
      setResendMessage(
        result?.data?.message ||
          '入力されたメールアドレスにアカウントがあり、パスキー未設定の場合、ログイン用リンクを送信しました'
      )
    } finally {
      setLoading(false)
    }
  }

  async function handlePasskeyLogin() {
    if (!passkeyOptions) return
    setLoading(true)
    try {
      const assertion = await startAuthentication({
        optionsJSON: passkeyOptions as Parameters<typeof startAuthentication>[0]['optionsJSON']
      })
      const result = await AuthFetch.loginPasskeyVerify(assertion)
      if (!result || !result.response.ok) {
        alert(result?.data?.error || 'パスキー認証に失敗しました')
        return
      }
      if (next) {
        window.location.href = next
        return
      }
      const role = result.data?.user?.role
      window.location.href = role === 'admin' ? '/dashboard' : '/posts'
    } catch (error) {
      console.error(error)
      alert('パスキー認証がキャンセルされたか失敗しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-md rounded-lg bg-white p-6 shadow">
      <h2 className="mb-4 text-xl font-semibold text-gray-900">ログイン</h2>

      {step === 'email' && (
        <form onSubmit={handleContinue} className="space-y-4">
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
            続行
          </button>
        </form>
      )}

      {step === 'magic' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">{email}</p>
          <p className="text-sm text-gray-700">
            招待メールのリンクを開いてログインしてください。届いていない、または期限切れの場合は再送できます。復旧でパスワードを設定済みの場合は、下のパスワードでもログインできます。
          </p>
          {resendMessage ? (
            <p className="text-sm text-gray-800">{resendMessage}</p>
          ) : (
            <button
              type="button"
              disabled={loading}
              onClick={() => void handleResend()}
              className="w-full rounded bg-gray-800 px-4 py-2 text-white hover:bg-gray-700 disabled:opacity-50"
            >
              ログイン用リンクを再送
            </button>
          )}
          <form onSubmit={handlePasswordLogin} className="space-y-4 border-t border-gray-200 pt-4">
            <p className="text-sm text-gray-600">初期管理者、または復旧で設定したパスワード</p>
            <div>
              <label className="mb-1 block text-sm text-gray-700">パスワード</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded bg-gray-800 px-4 py-2 text-white hover:bg-gray-700 disabled:opacity-50"
            >
              パスワードでログイン
            </button>
          </form>
          <button
            type="button"
            onClick={() => setStep('email')}
            className="w-full text-sm text-gray-600 underline"
          >
            戻る
          </button>
        </div>
      )}

      {step === 'passkey' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">{email}</p>
          <p className="text-sm text-gray-700">このアカウントはパスキーでログインします。</p>
          <button
            type="button"
            disabled={loading}
            onClick={() => void handlePasskeyLogin()}
            className="w-full rounded bg-gray-800 px-4 py-2 text-white hover:bg-gray-700 disabled:opacity-50"
          >
            パスキーでログイン
          </button>
          <button
            type="button"
            onClick={() => setStep('email')}
            className="w-full text-sm text-gray-600 underline"
          >
            戻る
          </button>
        </div>
      )}

      <p className="mt-6 text-center text-sm">
        <a href="/forgot-password" className="text-gray-700 underline">
          ログインできないとき
        </a>
      </p>
    </div>
  )
}

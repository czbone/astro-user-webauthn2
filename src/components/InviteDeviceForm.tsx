import { useState } from 'react'
import { startRegistration } from '@simplewebauthn/browser'
import DeviceFetch from '@/api-client/devices'

const DEFAULT_DEVICE_NAME = '自分のノートPC'

type Props = {
  token: string
}

export default function InviteDeviceForm({ token }: Props) {
  const [deviceName, setDeviceName] = useState(DEFAULT_DEVICE_NAME)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function handleRegister() {
    const name = deviceName.trim()
    if (!name) {
      alert('デバイス名は必須です')
      return
    }

    setLoading(true)
    try {
      const optionsResult = await DeviceFetch.registerOptions(token)
      if (!optionsResult || !optionsResult.response.ok || !optionsResult.data?.options) {
        alert(optionsResult?.data?.error || '招待が無効です')
        return
      }

      const attestation = await startRegistration({
        optionsJSON: optionsResult.data.options as Parameters<
          typeof startRegistration
        >[0]['optionsJSON']
      })

      const verifyResult = await DeviceFetch.registerVerify(token, attestation, name)
      if (!verifyResult || !verifyResult.response.ok) {
        alert(verifyResult?.data?.error || 'デバイス登録に失敗しました')
        return
      }

      setDone(true)
    } catch (error) {
      console.error(error)
      alert('パスキー登録がキャンセルされたか失敗しました')
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md rounded-lg bg-white p-6 shadow">
        <h2 className="mb-2 text-xl font-semibold text-gray-900">登録完了</h2>
        <p className="mb-4 text-sm text-gray-600">このデバイスのパスキーを登録しました。</p>
        <a href="/login" className="text-gray-800 underline">
          ログインへ
        </a>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md rounded-lg bg-white p-6 shadow">
      <h2 className="mb-2 text-xl font-semibold text-gray-900">デバイスにパスキーを登録</h2>
      <p className="mb-4 text-sm text-gray-600">
        招待リンクから新しいデバイスのパスキーを登録します。
      </p>
      <div className="mb-4">
        <label htmlFor="device-name" className="mb-1 block text-sm text-gray-700">
          デバイス名
        </label>
        <input
          id="device-name"
          type="text"
          required
          value={deviceName}
          onChange={(e) => setDeviceName(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
        />
      </div>
      <button
        type="button"
        disabled={loading}
        onClick={handleRegister}
        className="w-full rounded bg-gray-800 px-4 py-2 text-white hover:bg-gray-700 disabled:opacity-50"
      >
        パスキーを登録
      </button>
    </div>
  )
}

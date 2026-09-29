import { useEffect, useState } from 'react'
import { startAuthentication } from '@simplewebauthn/browser'
import DeviceFetch from '@/api-client/devices'
import type { DeviceCredential } from '@/types/models'

export default function DeviceManager() {
  const [devices, setDevices] = useState<DeviceCredential[]>([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  async function load() {
    const result = await DeviceFetch.list()
    if (!result || !result.response.ok || !Array.isArray(result.data)) {
      alert((result?.data as { error?: string })?.error || 'デバイス一覧の取得に失敗しました')
      return
    }
    setDevices(result.data)
  }

  useEffect(() => {
    void load()
  }, [])

  async function handleInvite() {
    setLoading(true)
    setMessage('')
    try {
      const optionsResult = await DeviceFetch.reauthOptions()
      if (!optionsResult || !optionsResult.response.ok || !optionsResult.data?.options) {
        alert(optionsResult?.data?.error || '再認証の開始に失敗しました')
        return
      }

      const assertion = await startAuthentication({
        optionsJSON: optionsResult.data.options as Parameters<
          typeof startAuthentication
        >[0]['optionsJSON']
      })

      const verifyResult = await DeviceFetch.reauthVerify(assertion)
      if (!verifyResult || !verifyResult.response.ok) {
        alert(verifyResult?.data?.error || '再認証に失敗しました')
        return
      }

      const inviteResult = await DeviceFetch.invite()
      if (!inviteResult || !inviteResult.response.ok) {
        alert(inviteResult?.data?.error || '招待メールの送信に失敗しました')
        return
      }

      setMessage(inviteResult.data?.message || '招待メールを送信しました')
    } catch (error) {
      console.error(error)
      alert('操作がキャンセルされたか失敗しました')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('このパスキーを削除しますか？')) return
    const result = await DeviceFetch.remove(id)
    if (!result || !result.response.ok) {
      alert(result?.data?.error || '削除に失敗しました')
      return
    }
    await load()
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-white p-6 shadow">
        <h2 className="mb-2 text-xl font-semibold text-gray-900">登録済みデバイス</h2>
        <ul className="divide-y divide-gray-200">
          {devices.map((device) => (
            <li key={device.id} className="flex items-center justify-between py-3">
              <div>
                <p className="font-medium text-gray-900">{device.deviceName || '名称未設定'}</p>
                <p className="text-sm text-gray-500">
                  登録: {new Date(device.createdAt).toLocaleString('ja-JP')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(device.id)}
                className="rounded border border-red-300 px-3 py-1 text-sm text-red-700 hover:bg-red-50"
              >
                削除
              </button>
            </li>
          ))}
          {devices.length === 0 && (
            <li className="py-3 text-sm text-gray-500">デバイスがありません</li>
          )}
        </ul>
      </div>

      <div className="rounded-lg bg-white p-6 shadow">
        <h3 className="mb-2 text-lg font-semibold text-gray-900">デバイスを追加</h3>
        <p className="mb-4 text-sm text-gray-600">
          再認証のあと、登録済みメールアドレスへ招待リンクを送信します（1時間有効）。
        </p>
        <button
          type="button"
          disabled={loading}
          onClick={handleInvite}
          className="rounded bg-gray-800 px-4 py-2 text-white hover:bg-gray-700 disabled:opacity-50"
        >
          再認証して招待メールを送る
        </button>
        {message && <p className="mt-3 text-sm text-green-700">{message}</p>}
      </div>
    </div>
  )
}

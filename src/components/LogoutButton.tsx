import AuthFetch from '@/api-client/auth'

export default function LogoutButton() {
  async function handleLogout() {
    const result = await AuthFetch.logout()
    if (!result || !result.response.ok) {
      alert(result?.data?.error || 'ログアウトに失敗しました')
      return
    }
    window.location.href = '/login'
  }

  async function handleLogoutAll() {
    const result = await AuthFetch.logoutAll()
    if (!result || !result.response.ok) {
      alert(result?.data?.error || 'ログアウトに失敗しました')
      return
    }
    window.location.href = '/login'
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => void handleLogout()}
        className="rounded px-3 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700 hover:text-white"
      >
        ログアウト
      </button>
      <button
        type="button"
        onClick={() => void handleLogoutAll()}
        className="rounded px-3 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700 hover:text-white"
      >
        すべてのアプリからログアウト
      </button>
    </div>
  )
}

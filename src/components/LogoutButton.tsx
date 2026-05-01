import { useAuth } from '@/context/AuthContext'

export function LogoutButton() {
  const { logout, isLoading } = useAuth()

  const handleLogout = async () => {
    try {
      await logout()
    } catch (err) {
      console.error('Logout failed:', err)
    }
  }

  return (
    <button
      onClick={handleLogout}
      disabled={isLoading}
      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded font-medium disabled:opacity-50"
    >
      {isLoading ? 'Logging out...' : 'Log Out'}
    </button>
  )
}

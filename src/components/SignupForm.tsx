import { useState } from 'react'
import { useAuth } from '@/context/AuthContext'

export function SignupForm() {
  const { signup, isLoading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    try {
      await signup(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-sm mx-auto p-6">
      <h2 className="text-2xl font-bold">Create Account</h2>

      {error && <div className="bg-red-100 text-red-700 p-3 rounded">{error}</div>}

      <div>
        <label className="block text-sm font-medium mb-1">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full px-3 py-2 border rounded dark:bg-gray-800 dark:border-gray-700"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Password (min 8 chars)</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          className="w-full px-3 py-2 border rounded dark:bg-gray-800 dark:border-gray-700"
        />
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded font-medium disabled:opacity-50"
      >
        {isLoading ? 'Creating...' : 'Sign Up'}
      </button>
    </form>
  )
}

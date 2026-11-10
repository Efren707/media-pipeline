import { useState, type FormEvent } from 'react'
import { authenticate, RequestError } from './api'
import { signupProblem, type Session } from './session'

const MESSAGES: Record<string, string> = {
  INVALID_REQUEST:
    'Usernames are 3–32 letters, digits, or underscores; passwords are 8–72 characters.',
}

export function AuthForm({
  onSession,
  notice,
  initialMode = 'login',
}: {
  onSession: (session: Session) => void
  notice?: string | null
  initialMode?: 'login' | 'signup'
}) {
  const [mode, setMode] = useState(initialMode)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const signingUp = mode === 'signup'

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const problem = signingUp ? signupProblem(username, password) : null
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    setBusy(true)
    try {
      onSession(await authenticate(mode, username, password))
    } catch (e) {
      setError(
        e instanceof RequestError
          ? (MESSAGES[e.code] ?? e.message)
          : 'Could not reach the server. Is the backend running?',
      )
    } finally {
      setBusy(false)
    }
  }

  function switchMode() {
    setMode(signingUp ? 'login' : 'signup')
    setError(null)
  }

  return (
    <main>
      <h1>Media Pipeline</h1>
      <p className="muted">
        {signingUp
          ? 'Create an account to upload images.'
          : 'Log in to upload and see your images.'}
      </p>
      {notice && <p className="notice">{notice}</p>}

      <form onSubmit={handleSubmit} className="auth">
        <label>
          Username
          <input
            name="username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={busy}
            required
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete={signingUp ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            required
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? 'Please wait…' : signingUp ? 'Sign up' : 'Log in'}
        </button>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </form>

      <p className="muted">
        {signingUp ? 'Already have an account?' : 'New here?'}{' '}
        <button type="button" className="link" onClick={switchMode} disabled={busy}>
          {signingUp ? 'Log in' : 'Create an account'}
        </button>
      </p>
    </main>
  )
}

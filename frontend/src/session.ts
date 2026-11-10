// The logged-in user's access token (Phase 7). Kept in sessionStorage, so it lasts until the tab
// closes; if storage is blocked (private mode, tests) it still works for the page's lifetime.

export interface Session {
  accessToken: string
  expiresAt: string
  user: { id: string; username: string }
}

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const KEY = 'mp.session'

function browserStorage(): KeyValueStorage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

function isSession(value: unknown): value is Session {
  const s = value as Session | null
  return (
    typeof s?.accessToken === 'string' &&
    typeof s.expiresAt === 'string' &&
    typeof s.user?.id === 'string' &&
    typeof s.user?.username === 'string'
  )
}

export class SessionStore {
  private current: Session | null | undefined
  private readonly storage: KeyValueStorage | null
  private readonly now: () => number

  constructor(storage: KeyValueStorage | null = browserStorage(), now: () => number = Date.now) {
    this.storage = storage
    this.now = now
  }

  /** The current session, or null if there is none or it has expired. */
  get(): Session | null {
    if (this.current === undefined) this.current = this.read()
    if (this.current && Date.parse(this.current.expiresAt) <= this.now()) this.clear()
    return this.current
  }

  save(session: Session): void {
    this.current = session
    try {
      this.storage?.setItem(KEY, JSON.stringify(session))
    } catch {
      // Storage full or blocked: keep the in-memory copy.
    }
  }

  clear(): void {
    this.current = null
    try {
      this.storage?.removeItem(KEY)
    } catch {
      // Nothing to clean up.
    }
  }

  private read(): Session | null {
    try {
      const parsed: unknown = JSON.parse(this.storage?.getItem(KEY) ?? 'null')
      return isSession(parsed) ? parsed : null
    } catch {
      return null
    }
  }
}

export const sessionStore = new SessionStore()

export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,32}$/

/** Mirrors the backend's signup rules for a friendly message; the backend enforces them. */
export function signupProblem(username: string, password: string): string | null {
  if (!USERNAME_PATTERN.test(username)) {
    return 'Usernames are 3–32 letters, digits, or underscores.'
  }
  if (password.length < 8 || password.length > 72) {
    return 'Passwords are 8–72 characters.'
  }
  return null
}

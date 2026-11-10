import { describe, expect, it } from 'vitest'
import { SessionStore, signupProblem, type Session } from './session'

const NOW = Date.parse('2026-11-09T12:00:00Z')

const session: Session = {
  accessToken: 'token-123',
  expiresAt: '2026-11-09T13:00:00Z',
  user: { id: '3f2b8c1e-9d4a-4e2b-8f61-0c7d5a9e1b42', username: 'alice' },
}

function memoryStorage() {
  const items = new Map<string, string>()
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  }
}

describe('SessionStore', () => {
  it('saves, reloads in a new store, and clears', () => {
    const storage = memoryStorage()
    new SessionStore(storage, () => NOW).save(session)

    const reloaded = new SessionStore(storage, () => NOW)
    expect(reloaded.get()).toEqual(session)

    reloaded.clear()
    expect(reloaded.get()).toBeNull()
    expect(new SessionStore(storage, () => NOW).get()).toBeNull()
  })

  it('drops an expired session', () => {
    const storage = memoryStorage()
    new SessionStore(storage, () => NOW).save(session)

    const later = new SessionStore(storage, () => Date.parse('2026-11-09T13:00:00Z'))
    expect(later.get()).toBeNull()
    expect(storage.items.size).toBe(0)
  })

  it('ignores corrupt or incomplete stored data', () => {
    const storage = memoryStorage()
    storage.setItem('mp.session', 'not json')
    expect(new SessionStore(storage, () => NOW).get()).toBeNull()

    storage.setItem('mp.session', JSON.stringify({ accessToken: 'x' }))
    expect(new SessionStore(storage, () => NOW).get()).toBeNull()
  })

  it('still works in memory when storage is unavailable', () => {
    const store = new SessionStore(null, () => NOW)
    store.save(session)
    expect(store.get()).toEqual(session)
  })
})

describe('signupProblem', () => {
  it('accepts names and passwords the backend accepts', () => {
    expect(signupProblem('Alice_01', 'long-enough')).toBeNull()
  })

  it.each([
    ['al', 'long-enough'],
    ['al ice', 'long-enough'],
    ['a'.repeat(33), 'long-enough'],
    ['alice', 'short'],
    ['alice', 'x'.repeat(73)],
  ])('rejects %s / %s', (username, password) => {
    expect(signupProblem(username, password)).not.toBeNull()
  })
})

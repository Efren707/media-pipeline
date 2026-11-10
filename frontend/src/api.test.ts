import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticate, getJob, RequestError, setUnauthorizedHandler } from './api'
import { sessionStore } from './session'

const tokenResponse = {
  tokenType: 'Bearer',
  accessToken: 'token-123',
  expiresAt: '2999-01-01T00:00:00Z',
  user: { id: '3f2b8c1e-9d4a-4e2b-8f61-0c7d5a9e1b42', username: 'alice' },
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('api auth handling', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    sessionStore.clear()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
    setUnauthorizedHandler(() => {})
  })

  it('logs in, stores the session, and sends the token afterwards', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, tokenResponse))
    const session = await authenticate('login', 'alice', 'correct-horse-battery')

    expect(session.user.username).toBe('alice')
    expect(sessionStore.get()?.accessToken).toBe('token-123')
    const [path, init] = fetchMock.mock.calls[0]
    expect(path).toBe('/api/auth/login')
    expect(new Headers(init?.headers).has('Authorization')).toBe(false)

    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: { code: 'JOB_NOT_FOUND' } }))
    await expect(getJob('job-1')).rejects.toBeInstanceOf(RequestError)
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get('Authorization')).toBe(
      'Bearer token-123',
    )
  })

  it('clears the session and notifies the app when a logged-in request gets 401', async () => {
    sessionStore.save(tokenResponse)
    const unauthorized = vi.fn()
    setUnauthorizedHandler(unauthorized)
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'Log in to continue.' } }),
    )

    await expect(getJob('job-1')).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(unauthorized).toHaveBeenCalledOnce()
    expect(sessionStore.get()).toBeNull()
  })

  it('reports wrong credentials without treating them as an expired session', async () => {
    const unauthorized = vi.fn()
    setUnauthorizedHandler(unauthorized)
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, {
        error: { code: 'INVALID_CREDENTIALS', message: 'Wrong username or password.' },
      }),
    )

    await expect(authenticate('login', 'alice', 'wrong-password')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: 'Wrong username or password.',
    })
    expect(unauthorized).not.toHaveBeenCalled()
    expect(sessionStore.get()).toBeNull()
  })
})

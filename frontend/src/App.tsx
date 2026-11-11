import { useEffect, useState, type FormEvent } from 'react'
import {
  ACCEPTED_TYPES,
  listJobs,
  logout,
  MAX_UPLOAD_BYTES,
  RequestError,
  setUnauthorizedHandler,
  uploadImage,
  type JobStatusResponse,
} from './api'
import { AuthForm } from './AuthForm'
import { galleryEntries, galleryStatus, type TrackedJob } from './gallery'
import { JobCard } from './JobCard'
import { sessionStore, type Session } from './session'

const SEARCH_DEBOUNCE_MS = 300

export default function App() {
  const [session, setSession] = useState<Session | null>(() => sessionStore.get())
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setSession(null)
      setNotice('Your session expired. Log in again.')
    })
    return () => setUnauthorizedHandler(() => {})
  }, [])

  if (!session) {
    return (
      <AuthForm
        notice={notice}
        onSession={(next) => {
          setNotice(null)
          setSession(next)
        }}
      />
    )
  }

  return (
    <Uploader
      username={session.user.username}
      onLogout={() => {
        logout()
        setSession(null)
      }}
    />
  )
}

/** Remounts on every login, so one user's gallery never shows for the next. */
function Uploader({ username, onLogout }: { username: string; onLogout: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [jobs, setJobs] = useState<TrackedJob[]>([])
  const [query, setQuery] = useState('')
  const [listed, setListed] = useState<JobStatusResponse[]>([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloads, setReloads] = useState(0)

  // Loads the gallery after login, and again (debounced) whenever the search changes.
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(
      async () => {
        setLoading(true)
        setLoadError(null)
        try {
          const page = await listJobs(query, controller.signal)
          setListed(page.items)
          setTruncated(page.truncated)
        } catch (e) {
          if (controller.signal.aborted) return
          setLoadError(e instanceof RequestError ? e.message : 'Could not load your uploads.')
        } finally {
          if (!controller.signal.aborted) setLoading(false)
        }
      },
      query.trim() ? SEARCH_DEBOUNCE_MS : 0,
    )
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, reloads])

  const entries = galleryEntries(jobs, listed, query)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!file) return
    setError(null)

    // Quick checks for a friendly message; the backend and Validate Lambda enforce the real rules.
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Choose a JPEG, PNG, or WebP image.')
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError('Images must be 10 MB or smaller.')
      return
    }

    setBusy(true)
    try {
      const jobId = await uploadImage(file)
      setJobs((current) => [{ jobId, fileName: file.name }, ...current])
      setFile(null)
      ;(event.target as HTMLFormElement).reset()
    } catch (e) {
      setError(e instanceof RequestError ? e.message : 'Upload failed. Is the backend running?')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <nav className="navbar">
        <div className="navbar-inner">
          <span className="brand">Media Pipeline</span>
          <button type="button" className="secondary" onClick={onLogout}>
            Log out
          </button>
        </div>
      </nav>
      <main>
        <h1>Hi, {username}</h1>
        <p className="muted">Upload an image. AWS validates, thumbnails, and classifies it.</p>

        <form onSubmit={handleSubmit} className="upload">
          <input
            type="file"
            accept={ACCEPTED_TYPES.join(',')}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={busy}
          />
          <button type="submit" disabled={!file || busy}>
            {busy ? 'Uploading…' : 'Upload'}
          </button>
        </form>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}

        <section aria-labelledby="gallery-heading" className="gallery">
          <div className="gallery-head">
            <h2 id="gallery-heading">Your uploads</h2>
            <input
              type="search"
              aria-label="Search by label"
              placeholder="Search labels, e.g. cat"
              maxLength={64}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {loadError ? (
            <p role="alert" className="error">
              {loadError}{' '}
              <button type="button" className="link" onClick={() => setReloads((n) => n + 1)}>
                Retry
              </button>
            </p>
          ) : (
            <p role="status" className="muted">
              {galleryStatus({ loading, count: entries.length, query, truncated })}
            </p>
          )}
          <div className="jobs">
            {entries.map((entry) => (
              <JobCard
                key={entry.jobId}
                jobId={entry.jobId}
                fileName={entry.fileName}
                initial={entry.initial}
              />
            ))}
          </div>
        </section>
      </main>
    </>
  )
}

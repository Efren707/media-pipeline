import { useEffect, useState, type FormEvent } from 'react'
import {
  ACCEPTED_TYPES,
  logout,
  MAX_UPLOAD_BYTES,
  RequestError,
  setUnauthorizedHandler,
  uploadImage,
} from './api'
import { AuthForm } from './AuthForm'
import { JobCard } from './JobCard'
import { sessionStore, type Session } from './session'

interface TrackedJob {
  jobId: string
  fileName: string
}

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

/** Remounts on every login, so one user's tracked jobs never show for the next. */
function Uploader({ username, onLogout }: { username: string; onLogout: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [jobs, setJobs] = useState<TrackedJob[]>([])

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
    <main>
      <header className="topbar">
        <h1>Media Pipeline</h1>
        <span className="muted">
          Signed in as <strong>{username}</strong>{' '}
          <button type="button" className="link" onClick={onLogout}>
            Log out
          </button>
        </span>
      </header>
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

      <section aria-label="Uploads" className="jobs">
        {jobs.map((job) => (
          <JobCard key={job.jobId} jobId={job.jobId} fileName={job.fileName} />
        ))}
      </section>
    </main>
  )
}

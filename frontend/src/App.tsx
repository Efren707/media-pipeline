import { useState, type FormEvent } from 'react'
import { ACCEPTED_TYPES, MAX_UPLOAD_BYTES, RequestError, uploadImage } from './api'
import { JobCard } from './JobCard'

interface TrackedJob {
  jobId: string
  fileName: string
}

export default function App() {
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
      <h1>Media Pipeline</h1>
      <p className="muted">Upload an image. It's validated and thumbnailed on AWS.</p>

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

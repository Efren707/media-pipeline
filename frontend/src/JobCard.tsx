import { useEffect, useState } from 'react'
import { getJob, type JobState, type JobStatusResponse } from './api'
import { isSettled } from './jobState'

const POLL_MS = 2000
const GIVE_UP_MS = 2 * 60 * 1000

const STEPS: JobState[] = ['QUEUED', 'VALIDATING', 'READY_FOR_ANALYSIS', 'ANALYZING']

const LABELS: Record<JobState, string> = {
  QUEUED: 'Queued',
  VALIDATING: 'Validating',
  READY_FOR_ANALYSIS: 'Validated',
  ANALYZING: 'Analyzing',
  COMPLETE: 'Complete',
  FLAGGED: 'Flagged',
  FAILED: 'Failed',
}

interface Props {
  jobId: string
  fileName: string
}

export function JobResult({ job }: { job: JobStatusResponse }) {
  if (!job.result) return null

  const flagged = job.state === 'FLAGGED'
  return (
    <section className={`result ${flagged ? 'result-flagged' : ''}`} aria-label="Analysis result">
      <strong>{flagged ? 'Needs review' : 'Analysis complete'}</strong>
      {flagged && job.result.moderation.categories.length > 0 && (
        <p className="moderation">Categories: {job.result.moderation.categories.join(', ')}</p>
      )}
      <ul className="labels">
        {job.result.labels.map((label) => (
          <li key={label.name}>
            <span>{label.name}</span>
            <strong>{Math.round(label.confidence * 100)}%</strong>
          </li>
        ))}
      </ul>
      <small className="muted">Model: {job.result.modelVersion}</small>
    </section>
  )
}

export function JobCard({ jobId, fileName }: Props) {
  const [job, setJob] = useState<JobStatusResponse | null>(null)
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const startedAt = Date.now()

    async function poll() {
      try {
        const next = await getJob(jobId)
        if (stopped) return
        setJob(next)
        // Each poll returns a freshly signed URL; keep the first so the image doesn't reload.
        if (next.thumbnailUrl) setThumbnailUrl((current) => current ?? next.thumbnailUrl)
        if (isSettled(next.state)) return
      } catch {
        // Transient errors (backend restarting, etc.): keep polling until the deadline.
      }
      if (Date.now() - startedAt > GIVE_UP_MS) {
        setTimedOut(true)
        return
      }
      timer = setTimeout(poll, POLL_MS)
    }

    poll()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [jobId])

  const state = job?.state ?? 'QUEUED'
  const failed = state === 'FAILED'
  const reached = isSettled(state) ? STEPS.length - 1 : STEPS.indexOf(state)

  return (
    <article className={`job ${failed ? 'job-failed' : ''}`}>
      <div className="thumb">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt={`Thumbnail of ${fileName}`} />
        ) : (
          <span>…</span>
        )}
      </div>
      <div className="details">
        <strong>{fileName}</strong>
        <code className="muted">{jobId}</code>
        {failed ? (
          <p className="error">
            Failed: {job?.error?.message ?? 'Processing failed.'}{' '}
            {job?.error?.code && <code>({job.error.code})</code>}
          </p>
        ) : (
          <ol className="steps">
            {STEPS.map((step, i) => (
              <li key={step} className={i <= reached ? 'done' : ''}>
                {LABELS[step]}
              </li>
            ))}
          </ol>
        )}
        {job && <JobResult job={job} />}
        {timedOut && !isSettled(state) && (
          <p className="error">
            No progress after 2 minutes. Check the Lambda logs for this job ID.
          </p>
        )}
      </div>
    </article>
  )
}

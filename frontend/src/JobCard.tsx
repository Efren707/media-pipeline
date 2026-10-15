import { useEffect, useState } from 'react'
import { getJob, type JobState, type JobStatusResponse } from './api'

const POLL_MS = 2000
const GIVE_UP_MS = 2 * 60 * 1000

// READY_FOR_ANALYSIS is the end of the line until the Analyze stage exists (Phase 5).
const SETTLED: JobState[] = ['READY_FOR_ANALYSIS', 'COMPLETE', 'FLAGGED', 'FAILED']

const STEPS: JobState[] = ['QUEUED', 'VALIDATING', 'READY_FOR_ANALYSIS']

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
        if (SETTLED.includes(next.state)) return
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
  const reached = STEPS.indexOf(state)

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
        {timedOut && !SETTLED.includes(state) && (
          <p className="error">
            No progress after 2 minutes. Check the Lambda logs for this job ID.
          </p>
        )}
      </div>
    </article>
  )
}

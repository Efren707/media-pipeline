// Types mirror docs/contracts/api/. Keep them in sync when a contract changes.

export type JobState =
  'QUEUED' | 'VALIDATING' | 'READY_FOR_ANALYSIS' | 'ANALYZING' | 'COMPLETE' | 'FLAGGED' | 'FAILED'

export interface ApiError {
  code: string
  message: string
}

export interface CreateUploadResponse {
  jobId: string
  state: 'QUEUED'
  upload: {
    method: 'PUT'
    url: string
    expiresInSeconds: number
    requiredHeaders: Record<string, string>
  }
}

export interface JobStatusResponse {
  schemaVersion: string
  jobId: string
  state: JobState
  thumbnailUrl: string | null
  updatedAt: string
  error: ApiError | null
}

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
// Must match mp.max-upload-bytes in the backend.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

export class RequestError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const error = body?.error as ApiError | undefined
    throw new RequestError(
      error?.code ?? `HTTP_${response.status}`,
      error?.message ?? `The server returned ${response.status}.`,
    )
  }
  return body as T
}

/** Asks the backend for a presigned URL, then PUTs the file straight to S3. */
export async function uploadImage(file: File): Promise<string> {
  const created = await requestJson<CreateUploadResponse>('/api/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType: file.type, sizeBytes: file.size }),
  })

  // Content-Length is signed too; the browser sets it from the file, so it always matches.
  const { method, url, requiredHeaders } = created.upload
  const put = await fetch(url, { method, headers: requiredHeaders, body: file })
  if (!put.ok) {
    throw new RequestError('UPLOAD_FAILED', `Upload to storage failed (HTTP ${put.status}).`)
  }
  return created.jobId
}

export function getJob(jobId: string): Promise<JobStatusResponse> {
  return requestJson<JobStatusResponse>(`/api/jobs/${encodeURIComponent(jobId)}`)
}

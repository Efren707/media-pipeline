import type { JobStatusResponse } from './api'

/** An upload made in this browser session; the server list doesn't know the file name. */
export interface TrackedJob {
  jobId: string
  fileName: string
}

export interface GalleryEntry {
  jobId: string
  fileName?: string
  initial?: JobStatusResponse
}

/**
 * What the gallery shows. Without a search, this session's uploads come first (newest first),
 * followed by every listed job not already shown. With a search, only the server's matches.
 */
export function galleryEntries(
  uploads: TrackedJob[],
  listed: JobStatusResponse[],
  query: string,
): GalleryEntry[] {
  if (query.trim()) {
    return listed.map((job) => ({ jobId: job.jobId, initial: job }))
  }
  const byId = new Map(listed.map((job) => [job.jobId, job]))
  const fresh = uploads.map((u) => ({
    jobId: u.jobId,
    fileName: u.fileName,
    initial: byId.get(u.jobId),
  }))
  const shown = new Set(uploads.map((u) => u.jobId))
  const rest = listed
    .filter((job) => !shown.has(job.jobId))
    .map((job) => ({ jobId: job.jobId, initial: job }))
  return [...fresh, ...rest]
}

/** The live-region text above the gallery. */
export function galleryStatus(opts: {
  loading: boolean
  count: number
  query: string
  truncated: boolean
}): string {
  const query = opts.query.trim()
  if (opts.loading) return query ? `Searching for “${query}”…` : 'Loading your uploads…'
  const plural = opts.count === 1 ? '' : 's'
  let text: string
  if (query) {
    text =
      opts.count === 0
        ? `No images match “${query}”.`
        : `${opts.count} image${plural} match “${query}”.`
  } else {
    text =
      opts.count === 0
        ? 'No uploads yet. Upload an image to get started.'
        : `${opts.count} upload${plural}.`
  }
  return opts.truncated ? `${text} Only 100 of your uploads are searched.` : text
}

/** A card title for a job without a known file name: its top label, else a generic name. */
export function jobTitle(fileName: string | undefined, job: JobStatusResponse | null): string {
  return fileName ?? job?.result?.labels[0]?.name ?? 'Image'
}

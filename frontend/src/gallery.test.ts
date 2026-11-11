import { describe, expect, it } from 'vitest'
import type { JobStatusResponse } from './api'
import { galleryEntries, galleryStatus, jobTitle } from './gallery'

function job(jobId: string, overrides: Partial<JobStatusResponse> = {}): JobStatusResponse {
  return {
    schemaVersion: '1.0',
    jobId,
    state: 'COMPLETE',
    thumbnailUrl: null,
    updatedAt: '2026-11-10T12:00:00Z',
    result: null,
    error: null,
    ...overrides,
  }
}

describe('galleryEntries', () => {
  it('puts this session’s uploads first and does not repeat them from the list', () => {
    const entries = galleryEntries(
      [{ jobId: 'b', fileName: 'dog.jpg' }],
      [job('a'), job('b'), job('c')],
      '',
    )

    expect(entries.map((e) => e.jobId)).toEqual(['b', 'a', 'c'])
    expect(entries[0].fileName).toBe('dog.jpg')
    expect(entries[0].initial?.jobId).toBe('b')
  })

  it('shows only the server’s matches while searching', () => {
    const entries = galleryEntries([{ jobId: 'new', fileName: 'x.png' }], [job('a')], ' cat ')

    expect(entries.map((e) => e.jobId)).toEqual(['a'])
  })
})

describe('galleryStatus', () => {
  it('describes loading, empty, results and search states', () => {
    const base = { loading: false, count: 0, query: '', truncated: false }

    expect(galleryStatus({ ...base, loading: true })).toBe('Loading your uploads…')
    expect(galleryStatus({ ...base, loading: true, query: 'cat' })).toBe('Searching for “cat”…')
    expect(galleryStatus(base)).toMatch(/^No uploads yet/)
    expect(galleryStatus({ ...base, count: 1 })).toBe('1 upload.')
    expect(galleryStatus({ ...base, count: 0, query: ' cat ' })).toBe('No images match “cat”.')
    expect(galleryStatus({ ...base, count: 2, query: 'cat' })).toBe('2 images match “cat”.')
    expect(galleryStatus({ ...base, count: 3, truncated: true })).toBe(
      '3 uploads. Only 100 of your uploads are searched.',
    )
  })
})

describe('jobTitle', () => {
  it('prefers the file name, then the top label', () => {
    const labelled = job('a', {
      result: {
        modelVersion: 'm',
        labels: [{ name: 'tabby cat', confidence: 0.9 }],
        moderation: { verdict: 'SAFE', confidence: 0, categories: [] },
      },
    })

    expect(jobTitle('cat.jpg', labelled)).toBe('cat.jpg')
    expect(jobTitle(undefined, labelled)).toBe('tabby cat')
    expect(jobTitle(undefined, job('b'))).toBe('Image')
    expect(jobTitle(undefined, null)).toBe('Image')
  })
})

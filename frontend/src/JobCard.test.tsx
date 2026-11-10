import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { JobResult } from './JobCard'
import type { JobStatusResponse } from './api'
import { isSettled } from './jobState'

describe('JobCard final-state behavior', () => {
  it('keeps polling while a job is ready for analysis', () => {
    expect(isSettled('READY_FOR_ANALYSIS')).toBe(false)
    expect(isSettled('COMPLETE')).toBe(true)
    expect(isSettled('FLAGGED')).toBe(true)
    expect(isSettled('FAILED')).toBe(true)
  })

  it('renders final labels and the moderation verdict', () => {
    const job: JobStatusResponse = {
      schemaVersion: '1.0',
      jobId: '550e8400-e29b-41d4-a716-446655440000',
      state: 'FLAGGED',
      thumbnailUrl: null,
      updatedAt: '2026-11-09T12:00:00Z',
      error: null,
      result: {
        modelVersion: 'squeezenet1.1-7',
        labels: [{ name: 'rifle', confidence: 0.72 }],
        moderation: { verdict: 'FLAGGED', confidence: 0.72, categories: ['weapons'] },
      },
    }

    const markup = renderToStaticMarkup(<JobResult job={job} />)

    expect(markup).toContain('Needs review')
    expect(markup).toContain('rifle')
    expect(markup).toContain('72%')
    expect(markup).toContain('weapons')
  })
})

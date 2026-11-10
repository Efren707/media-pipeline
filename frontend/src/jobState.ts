import type { JobState } from './api'

const SETTLED: JobState[] = ['COMPLETE', 'FLAGGED', 'FAILED']

export function isSettled(state: JobState) {
  return SETTLED.includes(state)
}

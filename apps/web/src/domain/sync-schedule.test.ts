import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  formatAgo,
  formatIn,
  formatRunDuration,
  nextScheduledSync,
  providerFeed,
  SYNC_CRON
} from '@/domain/sync-schedule'

const now = new Date('2026-10-07T02:19:00.000Z')

describe('sync schedule', () => {
  it('matches the ingestion Worker cron', () => {
    const config = readFileSync(join(process.cwd(), 'wrangler.ingestion.jsonc'), 'utf8')
    expect(config).toContain(`"crons": ["${SYNC_CRON}"]`)
  })

  it('finds the next 15:30 UTC run', () => {
    expect(nextScheduledSync(now).toISOString()).toBe('2026-10-07T15:30:00.000Z')
    expect(nextScheduledSync(new Date('2026-10-07T15:30:00.000Z')).toISOString()).toBe(
      '2026-10-08T15:30:00.000Z'
    )
    expect(nextScheduledSync(new Date('2026-12-31T20:00:00.000Z')).toISOString()).toBe(
      '2027-01-01T15:30:00.000Z'
    )
  })

  it('formats run durations, falling back to now for a running sync', () => {
    const start = new Date('2026-10-06T15:31:00.000Z')
    expect(formatRunDuration(start, new Date('2026-10-06T15:31:02.400Z'), now)).toBe('2s')
    expect(formatRunDuration(start, new Date('2026-10-06T15:33:19.000Z'), now)).toBe('2m 19s')
    expect(formatRunDuration(start, new Date('2026-10-06T15:40:00.000Z'), now)).toBe('9m')
    expect(formatRunDuration(start, new Date('2026-10-06T17:01:00.000Z'), now)).toBe('1h 30m')
    expect(formatRunDuration(new Date('2026-10-07T02:12:00.000Z'), null, now)).toBe('7m')
    expect(formatRunDuration(now, new Date(now.getTime() - 5_000), now)).toBe('0s')
  })

  it('says how long ago and how soon', () => {
    expect(formatAgo(new Date('2026-10-06T15:33:00.000Z'), now)).toBe('10h 46m ago')
    expect(formatIn(new Date('2026-10-07T15:30:00.000Z'), now)).toBe('in 13h 11m')
  })

  it('names each provider feed', () => {
    expect(providerFeed('godaddy')).toBe('Daily inventory file')
    expect(providerFeed('dynadot')).toBe('Auction API')
    expect(providerFeed('namejet')).toBe('Provider sync')
  })
})

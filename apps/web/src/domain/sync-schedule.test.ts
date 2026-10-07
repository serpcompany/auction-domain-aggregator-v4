import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  formatAgo,
  formatIn,
  formatRunDuration,
  nextScheduledSync,
  providerFeed,
  syncSchedule
} from '@/domain/sync-schedule'

const now = new Date('2026-10-07T02:19:00.000Z')

describe('sync schedule', () => {
  it('shows each environment the time its ingestion Worker runs', () => {
    const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8')
    // Top level (local), then env.staging, then env.production, in both files.
    const crons = [...read('wrangler.ingestion.jsonc').matchAll(/"crons": \["([^"]+)"\]/g)].map(
      match => match[1]
    )
    const times = [...read('wrangler.jsonc').matchAll(/"SYNC_TIME_UTC": "([^"]+)"/g)].map(
      match => match[1]
    )
    expect(crons).toHaveLength(3)
    expect(times.map(time => syncSchedule(time).cron)).toEqual(crons)
    // Staging runs after Production, so they never page a provider at once.
    expect(times).toEqual(['15:30', '17:30', '15:30'])
  })

  it('reads HH:MM in UTC and falls back to 15:30', () => {
    expect(syncSchedule('17:30')).toEqual({
      hour: 17,
      minute: 30,
      cron: '30 17 * * *',
      label: 'Daily at 17:30 UTC'
    })
    expect(syncSchedule('07:05').label).toBe('Daily at 07:05 UTC')
    for (const invalid of [undefined, '', '24:00', '9:30', 'noon']) {
      expect(syncSchedule(invalid).label).toBe('Daily at 15:30 UTC')
    }
    expect(nextScheduledSync(now, syncSchedule('17:30')).toISOString()).toBe(
      '2026-10-07T17:30:00.000Z'
    )
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

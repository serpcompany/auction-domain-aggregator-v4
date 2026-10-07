import { compactDuration } from '@/domain/domain-table'

// Each environment's ingestion Worker syncs daily at its own time
// (`wrangler.ingestion.jsonc`, `triggers.crons`): Staging later than
// Production, so the two never page the same provider API at once. The
// website shows the time from its own `SYNC_TIME_UTC` var (`wrangler.jsonc`),
// and a test keeps each environment's pair in step.
export type SyncSchedule = { hour: number; minute: number; cron: string; label: string }

const SYNC_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

// `HH:MM` in UTC; anything else falls back to Production's 15:30.
export function syncSchedule(time?: string): SyncSchedule {
  const match = SYNC_TIME.exec(time ?? '')
  const [hour, minute] = match ? [Number(match[1]), Number(match[2])] : [15, 30]
  const clock = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  return { hour, minute, cron: `${minute} ${hour} * * *`, label: `Daily at ${clock} UTC` }
}

export function nextScheduledSync(now: Date, schedule: SyncSchedule = syncSchedule()) {
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      schedule.hour,
      schedule.minute
    )
  )
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
  return next
}

export function formatRunDuration(startedAt: Date, completedAt: Date | null, now: Date) {
  const milliseconds = (completedAt ?? now).getTime() - startedAt.getTime()
  const seconds = Math.max(0, Math.round(milliseconds / 1_000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3_600) {
    const rest = seconds % 60
    return `${Math.floor(seconds / 60)}m${rest === 0 ? '' : ` ${rest}s`}`
  }
  return compactDuration(milliseconds)
}

export function formatAgo(value: Date, now: Date) {
  return `${compactDuration(Math.max(0, now.getTime() - value.getTime()))} ago`
}

export function formatIn(value: Date, now: Date) {
  return `in ${compactDuration(Math.max(0, value.getTime() - now.getTime()))}`
}

const PROVIDER_FEEDS: Record<string, string> = {
  dynadot: 'Auction API',
  godaddy: 'Daily inventory file'
}

export function providerFeed(provider: string) {
  return PROVIDER_FEEDS[provider] ?? 'Provider sync'
}

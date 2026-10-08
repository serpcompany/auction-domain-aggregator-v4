import { compactDuration } from '@/domain/domain-table'

// Each environment's ingestion Worker syncs on its own Cron Trigger
// (`wrangler.ingestion.jsonc`, `triggers.crons`): Production every provider
// daily, Staging only GoDaddy weekly, since it exists to test deploys and
// needs realistic rather than fresh data. The website shows the schedule
// from its own `SYNC_TIME_UTC` and `SYNC_PROVIDERS` vars (`wrangler.jsonc`),
// and a test keeps each environment's pair in step.
export type SyncSchedule = {
  hour: number
  minute: number
  // 0 (Sunday) to 6 for a weekly schedule; null for a daily one.
  weekday: number | null
  // The providers the schedule syncs; null for every provider.
  providers: readonly string[] | null
  cron: string
  label: string
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
] as const
const SYNC_TIME = /^(?:(Sun|Mon|Tue|Wed|Thu|Fri|Sat) )?([01]\d|2[0-3]):([0-5]\d)$/

// `HH:MM` in UTC, daily, or `Day HH:MM` (`Mon 11:30`), weekly; anything else
// falls back to Production's daily 15:30. `providers` is a comma-separated
// list; without one, every provider is scheduled.
export function syncSchedule(time?: string, providers?: string): SyncSchedule {
  const match = SYNC_TIME.exec(time ?? '')
  const [weekday, hour, minute] = match
    ? [
        match[1] ? WEEKDAYS.indexOf(match[1] as (typeof WEEKDAYS)[number]) : null,
        Number(match[2]),
        Number(match[3])
      ]
    : [null, 15, 30]
  const clock = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  const listed = (providers ?? '')
    .split(',')
    .map(provider => provider.trim())
    .filter(Boolean)
  return {
    hour,
    minute,
    weekday,
    providers: listed.length > 0 ? listed : null,
    cron: `${minute} ${hour} * * ${weekday ?? '*'}`,
    label: weekday === null ? `Daily at ${clock} UTC` : `${WEEKDAY_NAMES[weekday]}s at ${clock} UTC`
  }
}

export function isScheduled(schedule: SyncSchedule, provider: string) {
  return schedule.providers === null || schedule.providers.includes(provider)
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
  while (next <= now || (schedule.weekday !== null && next.getUTCDay() !== schedule.weekday)) {
    next.setUTCDate(next.getUTCDate() + 1)
  }
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

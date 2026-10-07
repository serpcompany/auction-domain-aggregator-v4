import { compactDuration } from '@/domain/domain-table'

// The ingestion Worker's daily Cron Trigger (`wrangler.ingestion.jsonc`,
// `triggers.crons`). A test keeps the two in step.
export const SYNC_CRON = '30 15 * * *'
const SYNC_HOUR_UTC = 15
const SYNC_MINUTE_UTC = 30

export const SYNC_SCHEDULE_LABEL = 'Daily at 15:30 UTC'

export function nextScheduledSync(now: Date) {
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      SYNC_HOUR_UTC,
      SYNC_MINUTE_UTC
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

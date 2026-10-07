// NameSilo's Cloudflare zone answers 403 to requests from Cloudflare Workers
// (issue 104), so a GitHub Actions job (`scripts/record-namesilo.ts`) runs the
// NameSilo adapter from outside Cloudflare, records every `listAuctions`
// response, and uploads the recording to each environment's FEED_PAGES
// bucket. The deployed sync replays a fresh recording instead of calling
// NameSilo. Everything lives under `feed-pages/`, so the bucket's 2-day
// lifecycle rule expires old recordings.
import { z } from 'zod'

import type { FeedPageBucket } from './feed-pages'

export const NAMESILO_RECORDING_PREFIX = 'feed-pages/namesilo-recording/'
export const NAMESILO_RECORDING_MANIFEST = `${NAMESILO_RECORDING_PREFIX}latest.json`
// The job records once a day before Production's sync; Staging's sync the
// next morning replays the same recording.
export const NAMESILO_RECORDING_MAX_AGE_MS = 26 * 60 * 60_000

const manifestSchema = z.object({
  prefix: z.string().regex(/^feed-pages\/namesilo-recording\/[0-9]{14}\/$/),
  recordedAt: z.iso.datetime()
})

export type NamesiloRecordingManifest = z.infer<typeof manifestSchema>

// One object per request, named by what varies between requests. The URL's
// `key` parameter is never part of it.
export function namesiloRecordingKey(prefix: string, url: URL) {
  const params = url.searchParams
  return `${prefix}${params.get('typeId')}-${params.get('statusId')}-${params.get('page')}.json`
}

// The prefix of a recording made at most NAMESILO_RECORDING_MAX_AGE_MS ago,
// or null when there is none to replay.
export async function findNamesiloRecording(bucket: FeedPageBucket, now: Date) {
  const object = await bucket.get(NAMESILO_RECORDING_MANIFEST)
  if (!object) return null
  let manifest: NamesiloRecordingManifest
  try {
    manifest = manifestSchema.parse(JSON.parse(await object.text()))
  } catch {
    return null
  }
  const age = now.getTime() - Date.parse(manifest.recordedAt)
  return age >= 0 && age <= NAMESILO_RECORDING_MAX_AGE_MS ? manifest.prefix : null
}

// A fetch that answers each `listAuctions` request with its recorded
// response. A request the recording lacks answers 404, which the adapter
// reports as `namesilo_http_error`.
export function replayNamesiloRecording(bucket: FeedPageBucket, prefix: string): typeof fetch {
  return async input => {
    const object = await bucket.get(namesiloRecordingKey(prefix, new URL(String(input))))
    if (!object) return new Response(null, { status: 404 })
    return new Response(await object.text(), { headers: { 'content-type': 'application/json' } })
  }
}

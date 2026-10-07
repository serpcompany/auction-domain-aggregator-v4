import {
  NAMESILO_RECORDING_MANIFEST,
  NAMESILO_RECORDING_PREFIX,
  namesiloRecordingKey
} from '../src/server/ingestion/namesilo-recording'
import {
  createNamesiloAdapter,
  NAMESILO_RATE_LIMIT,
  NamesiloProviderError
} from '../src/server/providers/namesilo'
import { createPacer } from '../src/server/providers/rate-limit'

// NameSilo's Cloudflare zone answers 403 to requests from Cloudflare Workers
// (#104). This runs the NameSilo adapter from a GitHub-hosted runner, records
// each `listAuctions` response, and uploads the recording, then its manifest,
// to every R2 bucket named on the command line, where the deployed sync
// replays it. The key and the request URLs are never printed.
//
// Usage: NAMESILO_API_KEY=… CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=…
//   node --import tsx scripts/record-namesilo.ts <bucket>...

const MAX_PAGE_INDEX = 1000
// A transient NameSilo error (a network error, 429, or 5xx) is retried.
const PAGE_ATTEMPTS = 4
const PAGE_RETRY_MS = 30_000
const UPLOAD_ATTEMPTS = 4
const UPLOADS_IN_FLIGHT = 4

function fixedError(message: string): Error {
  const error = new Error(message)
  error.stack = undefined
  return error
}

function required(name: string) {
  const value = process.env[name]
  if (!value) throw fixedError(`recording_missing_${name.toLowerCase()}`)
  return value
}

function pause(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function record(apiKey: string) {
  const responses = new Map<string, string>()
  // Keeps each successful response body, keyed without a prefix.
  const recordingFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    const response = await fetch(url, init)
    const body = await response.text()
    if (response.ok) responses.set(namesiloRecordingKey('', url), body)
    // The body is already decoded, so only the header the adapter reads.
    const retryAfter = response.headers.get('retry-after')
    return new Response(body, {
      status: response.status,
      headers: retryAfter ? { 'retry-after': retryAfter } : {}
    })
  }
  const adapter = createNamesiloAdapter({
    apiKey,
    pacer: createPacer(NAMESILO_RATE_LIMIT.intervalMs),
    fetchImpl: recordingFetch
  })

  let pages = 0
  let records = 0
  for (let pageIndex = 1; pageIndex <= MAX_PAGE_INDEX; pageIndex += 1) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const page = await adapter.fetchPage({ pageIndex })
        pages += 1
        records += page.received
        if (page.isLastPage) return { responses, pages, records }
        break
      } catch (error) {
        const transient = error instanceof NamesiloProviderError && error.transient
        if (!transient || attempt === PAGE_ATTEMPTS) {
          throw fixedError(error instanceof NamesiloProviderError ? error.code : 'recording_failed')
        }
        await pause(PAGE_RETRY_MS * attempt)
      }
    }
  }
  throw fixedError('recording_page_limit_exceeded')
}

async function upload(bucket: string, key: string, body: string) {
  const accountId = required('CLOUDFLARE_ACCOUNT_ID')
  const token = required('CLOUDFLARE_API_TOKEN')
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${key}`,
      {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body
      }
    )
    await response.body?.cancel()
    if (response.ok) return
    const retryable = response.status === 429 || response.status >= 500
    if (!retryable || attempt === UPLOAD_ATTEMPTS) {
      console.error(JSON.stringify({ error: 'recording_upload_failed', status: response.status }))
      throw fixedError('recording_upload_failed')
    }
    await pause(1000 * 2 ** attempt)
  }
}

async function uploadRecording(bucket: string, prefix: string, responses: Map<string, string>) {
  const queue = [...responses]
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      await upload(bucket, `${prefix}${next[0]}`, next[1])
    }
  }
  await Promise.all(Array.from({ length: UPLOADS_IN_FLIGHT }, worker))
}

async function main() {
  const buckets = process.argv.slice(2)
  if (buckets.length === 0) throw fixedError('recording_no_buckets')
  const apiKey = required('NAMESILO_API_KEY')
  required('CLOUDFLARE_ACCOUNT_ID')
  required('CLOUDFLARE_API_TOKEN')

  const recordedAt = new Date()
  const { responses, pages, records } = await record(apiKey)
  const prefix = `${NAMESILO_RECORDING_PREFIX}${recordedAt.toISOString().replace(/\D/g, '').slice(0, 14)}/`
  const manifest = JSON.stringify({ prefix, recordedAt: recordedAt.toISOString() })
  for (const bucket of buckets) {
    await uploadRecording(bucket, prefix, responses)
    // Last, so a sync never finds a manifest whose recording is incomplete.
    await upload(bucket, NAMESILO_RECORDING_MANIFEST, manifest)
  }
  console.log(
    JSON.stringify({ status: 'recorded', pages, records, responses: responses.size, buckets })
  )
}

main().catch((error: unknown) => {
  const code =
    error instanceof Error && /^[a-z]+_[a-z_]+$/.test(error.message)
      ? error.message
      : 'recording_failed'
  console.error(JSON.stringify({ error: code }))
  process.exitCode = 1
})

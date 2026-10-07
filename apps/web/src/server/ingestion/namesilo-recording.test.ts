import { describe, expect, it } from 'vitest'

import type { FeedPageBucket } from './feed-pages'
import {
  findNamesiloRecording,
  NAMESILO_RECORDING_MANIFEST,
  NAMESILO_RECORDING_MAX_AGE_MS,
  namesiloRecordingKey,
  replayNamesiloRecording
} from './namesilo-recording'

const PREFIX = 'feed-pages/namesilo-recording/20261007134500/'
const NOW = new Date('2026-10-07T15:30:00.000Z')

function bucketWith(objects: Record<string, string>): FeedPageBucket {
  return {
    put: async () => undefined,
    async get(key) {
      const value = objects[key]
      return value === undefined
        ? null
        : { size: value.length, text: async () => value, body: new ReadableStream() }
    },
    list: async () => ({ objects: [] }),
    delete: async () => undefined
  }
}

const manifest = (recordedAt: string, prefix = PREFIX) =>
  bucketWith({ [NAMESILO_RECORDING_MANIFEST]: JSON.stringify({ prefix, recordedAt }) })

describe('NameSilo recording', () => {
  it('names a response by its type, status, and page, never its key', () => {
    const url = new URL(
      'https://www.namesilo.com/public/apibatch/listAuctions?version=1&type=json&key=invented-key&typeId=3&statusId=2&page=7&pageSize=500'
    )
    expect(namesiloRecordingKey(PREFIX, url)).toBe(`${PREFIX}3-2-7.json`)
  })

  it('finds a recording no older than 26 hours', async () => {
    const recordedAt = new Date(NOW.getTime() - NAMESILO_RECORDING_MAX_AGE_MS).toISOString()
    await expect(findNamesiloRecording(manifest(recordedAt), NOW)).resolves.toBe(PREFIX)
    await expect(findNamesiloRecording(manifest('2026-10-07T13:45:00.000Z'), NOW)).resolves.toBe(
      PREFIX
    )
  })

  it('ignores a missing, malformed, stale, or future recording', async () => {
    const stale = new Date(NOW.getTime() - NAMESILO_RECORDING_MAX_AGE_MS - 1).toISOString()
    for (const bucket of [
      bucketWith({}),
      bucketWith({ [NAMESILO_RECORDING_MANIFEST]: 'not json' }),
      manifest('2026-10-07T13:45:00.000Z', 'feed-pages/elsewhere/'),
      manifest('yesterday'),
      manifest(stale),
      manifest('2026-10-07T15:30:01.000Z')
    ]) {
      await expect(findNamesiloRecording(bucket, NOW)).resolves.toBeNull()
    }
  })

  it('replays recorded responses and answers 404 for anything unrecorded', async () => {
    const replay = replayNamesiloRecording(
      bucketWith({ [`${PREFIX}1-9-1.json`]: '{"reply":{"code":300,"body":[]}}' }),
      PREFIX
    )
    const recorded = await replay(
      new URL('https://www.namesilo.com/public/apibatch/listAuctions?typeId=1&statusId=9&page=1')
    )
    expect(recorded.status).toBe(200)
    await expect(recorded.json()).resolves.toEqual({ reply: { code: 300, body: [] } })
    const missing = await replay(
      'https://www.namesilo.com/public/apibatch/listAuctions?typeId=3&statusId=2&page=1'
    )
    expect(missing.status).toBe(404)
  })
})

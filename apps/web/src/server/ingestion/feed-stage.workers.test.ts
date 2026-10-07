import { describe, expect, it } from 'vitest'

import { GODADDY_FEED_ENTRY } from '../providers/godaddy'
import { feedErrorCode, stageZippedFeed } from './feed-stage'
import { buildZipFixture } from './zip-fixture'

const text = JSON.stringify({
  meta: {},
  data: Array.from({ length: 2_500 }, (_, index) => ({
    domainName: `cloud-feed-${index}.integration.test`,
    link: `https://www.godaddy.com/domain-auctions/cloud-feed-${index}-${800_000 + index}`,
    auctionType: 'Bid',
    auctionEndTime: '2030-01-01T00:00:00Z',
    price: '$15',
    numberOfBids: 2,
    majesticTf: 5,
    semrushAs: 9
  }))
})

async function stage(body: BodyInit) {
  try {
    await stageZippedFeed({
      url: 'https://feed.invalid/feed.zip',
      entry: GODADDY_FEED_ENTRY,
      field: 'data',
      pageSize: 1_000,
      maxArchiveBytes: 1e8,
      maxDocumentBytes: 1e9,
      timeoutMs: 10_000,
      sink: async () => undefined,
      fetchImpl: (async () => new Response(body)) as typeof fetch
    })
    return 'staged'
  } catch (error) {
    return feedErrorCode(error) ?? 'unknown'
  }
}

// workerd re-creates an error that passes through DecompressionStream, so a staging failure
// raised inside the archive must keep its code there. Node does not, so only workerd proves it.
describe('feed staging error codes in workerd', () => {
  it('reports a connection dropped halfway through a deflated entry', async () => {
    const zip = await buildZipFixture(text, { entry: GODADDY_FEED_ENTRY })
    const dropped = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(zip.slice(0, zip.byteLength / 2))
      },
      pull(controller) {
        controller.error(new Error('connection reset'))
      }
    })
    expect(await stage(dropped)).toBe('feed_download_failed')
  })

  it('rejects a zip64 compressed size in the central directory of a streamed entry', async () => {
    const described = await buildZipFixture(text, {
      entry: GODADDY_FEED_ENTRY,
      dataDescriptor: true
    })
    const view = new DataView(described.buffer)
    const central = view.getUint32(described.byteLength - 22 + 16, true)
    view.setUint32(central + 20, 0xffffffff, true)
    expect(await stage(described)).toBe('feed_unsupported_archive')
  })
})

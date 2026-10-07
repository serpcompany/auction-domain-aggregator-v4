// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { createCsvRowScanner, stageCsvFeed, writeCsvFeedPages } from './feed-csv'
import { FEED_USER_AGENT, FeedError } from './feed-stage'
import { chunkedStream } from './zip-fixture'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function scan(text: string, chunkSize: number, maxRowLength?: number) {
  const rows: string[][] = []
  const scanner = createCsvRowScanner(row => rows.push(row), maxRowLength)
  for (let offset = 0; offset < text.length; offset += chunkSize) {
    scanner.push(text.slice(offset, offset + chunkSize))
  }
  scanner.end()
  return rows
}

function collectingSink() {
  const pages: { page: number; isLastPage: boolean; records: Record<string, string>[] }[] = []
  return {
    pages,
    sink: async (page: number, body: Uint8Array) => {
      const parsed = JSON.parse(decoder.decode(body))
      expect(parsed.page).toBe(page)
      pages.push(parsed)
    }
  }
}

function write(text: string | Uint8Array, options: { pageSize?: number; chunkSize?: number } = {}) {
  const { pages, sink } = collectingSink()
  const bytes = typeof text === 'string' ? encoder.encode(text) : text
  const result = writeCsvFeedPages({
    document: chunkedStream(bytes, options.chunkSize ?? 5),
    pageSize: options.pageSize ?? 2,
    maxBytes: 1e6,
    sink
  })
  return { pages, result }
}

describe('CSV row scanner', () => {
  it('splits quoted and unquoted fields across every chunk boundary', () => {
    const text =
      'a,b,c\r\n' +
      '"x, y","say ""hi""",\n' +
      '\n' +
      '"multi\nline",,"q"\r\n' +
      '"",plain,"Ünïcode"'
    const expected = [
      ['a', 'b', 'c'],
      ['x, y', 'say "hi"', ''],
      ['multi\nline', '', 'q'],
      ['', 'plain', 'Ünïcode']
    ]
    for (let chunkSize = 1; chunkSize <= text.length; chunkSize += 1) {
      expect(scan(text, chunkSize)).toEqual(expected)
    }
  })

  it('ends the last row at the end of input, with or without a line ending', () => {
    expect(scan('a,b\n', 3)).toEqual([['a', 'b']])
    expect(scan('a,b,', 3)).toEqual([['a', 'b', '']])
    expect(scan('"a"', 3)).toEqual([['a']])
    expect(scan('', 3)).toEqual([])
  })

  it('rejects malformed quoting', () => {
    for (const text of ['a"b,c\n', '"a"b,c\n', '"open\n', 'a,"b"c']) {
      expect(() => scan(text, 2)).toThrow(new FeedError('feed_parse_error'))
    }
  })

  it('fails a row longer than the limit before holding it whole', () => {
    expect(scan('abc,de\nfghij\n', 4, 5)).toEqual([['abc', 'de'], ['fghij']])
    expect(() => scan('abc,def\n', 4, 5)).toThrow(new FeedError('feed_too_large'))
    expect(() => scan('"abcdef"\n', 4, 5)).toThrow(new FeedError('feed_too_large'))
  })
})

describe('CSV feed pages', () => {
  it('turns rows into records of their non-empty fields, in marked pages', async () => {
    const { pages, result } = write(
      '﻿name,price,__proto__\nb.example,1.00,\na.example,,x\nc.example,3,\n',
      { chunkSize: 3 }
    )
    await expect(result).resolves.toEqual({ pages: 2, records: 3 })
    expect(pages).toEqual([
      {
        page: 1,
        isLastPage: false,
        records: [
          { name: 'b.example', price: '1.00' },
          JSON.parse('{"name":"a.example","__proto__":"x"}')
        ]
      },
      { page: 2, isLastPage: true, records: [{ name: 'c.example', price: '3' }] }
    ])
  })

  it('marks a full final page last when the file has no final line ending', async () => {
    const { pages, result } = write('name\na.example\nb.example')
    await expect(result).resolves.toEqual({ pages: 1, records: 2 })
    expect(pages.map(page => page.isLastPage)).toEqual([true])

    const single = write('name\na.example\nb.example', { pageSize: 1 })
    await expect(single.result).resolves.toEqual({ pages: 2, records: 2 })
    expect(single.pages.map(page => page.isLastPage)).toEqual([false, true])
  })

  it('decodes characters split across chunks and rejects invalid UTF-8', async () => {
    const { pages, result } = write('name\nbücher.example\n', { chunkSize: 1 })
    await expect(result).resolves.toEqual({ pages: 1, records: 1 })
    expect(pages[0]!.records).toEqual([{ name: 'bücher.example' }])

    const invalid = new Uint8Array([...encoder.encode('name\na'), 0xff, 0x0a])
    await expect(write(invalid).result).rejects.toThrow(new FeedError('feed_parse_error'))
    const truncated = new Uint8Array([...encoder.encode('name\na'), 0xc3])
    await expect(write(truncated).result).rejects.toThrow(new FeedError('feed_parse_error'))
  })

  it('rejects an unusable header, a short row, and a feed without rows', async () => {
    for (const text of ['name,\na,b\n', 'name,name\na,b\n', 'name,price\na\n']) {
      await expect(write(text).result).rejects.toThrow(new FeedError('feed_parse_error'))
    }
    await expect(write('name,price\n').result).rejects.toThrow(new FeedError('feed_empty'))
  })

  it('bounds the document size and maps stream failures', async () => {
    const sink = async () => undefined
    await expect(
      writeCsvFeedPages({
        document: chunkedStream(encoder.encode('name\na.example\nb.example\n'), 4),
        pageSize: 2,
        maxBytes: 10,
        sink
      })
    ).rejects.toThrow(new FeedError('feed_too_large'))
    const cancel = vi.fn()
    const failing = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('reset'))
      },
      cancel
    })
    await expect(
      writeCsvFeedPages({ document: failing, pageSize: 2, maxBytes: 1e6, sink })
    ).rejects.toThrow(new FeedError('feed_download_failed'))
    await expect(
      writeCsvFeedPages({
        document: chunkedStream(encoder.encode(`name\n${'x'.repeat(50)}\n`), 8),
        pageSize: 2,
        maxBytes: 1e6,
        limits: { maxPageBytes: 40 },
        sink
      })
    ).rejects.toThrow(new FeedError('feed_too_large'))
  })
})

describe('CSV feed staging', () => {
  const options = {
    url: 'https://feed.example/sales.csv',
    pageSize: 2,
    maxBytes: 1e6,
    timeoutMs: 1_000
  }

  it('downloads with a User-Agent and stages the pages', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('name\na.example\nb.example\nc.example\nd.example\ne.example\n')
    )
    const { pages, sink } = collectingSink()
    await expect(
      stageCsvFeed({ ...options, sink, fetchImpl: fetchImpl as never })
    ).resolves.toEqual({ pages: 3, records: 5 })
    expect(pages.map(page => page.isLastPage)).toEqual([false, false, true])
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(options.url)
    expect(init.headers).toEqual({ 'user-agent': FEED_USER_AGENT })
  })

  it('maps a failed download to a fixed code', async () => {
    await expect(
      stageCsvFeed({
        ...options,
        sink: async () => undefined,
        fetchImpl: (async () => new Response('nope', { status: 503 })) as never
      })
    ).rejects.toThrow(new FeedError('feed_download_failed'))
  })
})

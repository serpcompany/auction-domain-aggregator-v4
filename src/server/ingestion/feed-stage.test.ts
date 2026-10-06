// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  createJsonArrayScanner,
  createPageWriter,
  FEED_USER_AGENT,
  FeedError,
  feedErrorCode,
  openZipEntry,
  pageBody,
  stageZippedFeed,
  writeFeedPages,
} from './feed-stage';
import { buildZipFixture, chunkedStream } from './zip-fixture';

const ENTRY = 'feed.json';
const decoder = new TextDecoder();

function feedDocument(count: number) {
  return JSON.stringify({
    meta: { title: 'invented', data: ['not records'] },
    data: Array.from({ length: count }, (_, index) => ({
      domainName: `d${index}.example`,
      note: 'braces { } [ ] and "quotes" in strings \\ ok',
    })),
  });
}

async function readText(stream: ReadableStream<Uint8Array>) {
  return new Response(stream).text();
}

function streamOf(bytes: Uint8Array, chunkSize = 64) {
  return chunkedStream(bytes, chunkSize);
}

async function open(bytes: Uint8Array, chunkSize = 64, max = 1_000_000) {
  return openZipEntry(streamOf(bytes, chunkSize), {
    entry: ENTRY,
    maxCompressedBytes: max,
  });
}

function scan(text: string, chunkSize = 1) {
  const bytes = new TextEncoder().encode(text);
  const elements: string[] = [];
  const scanner = createJsonArrayScanner('data', (element) => {
    // Pieces may split a multi-byte character, so join bytes first.
    elements.push(decoder.decode(pageBody(1, true, [element])).slice(39, -2));
  });
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    scanner.push(bytes.subarray(offset, offset + chunkSize));
  }
  scanner.end();
  return elements;
}

function collectingSink() {
  const pages: { page: number; isLastPage: boolean; records: unknown[] }[] = [];
  return {
    pages,
    sink: async (page: number, body: Uint8Array) => {
      const parsed = JSON.parse(decoder.decode(body));
      expect(parsed.page).toBe(page);
      pages.push(parsed);
    },
  };
}

describe('zip entry', () => {
  it('inflates a deflated entry whose size is in the local header', async () => {
    const text = feedDocument(20);
    const zip = await buildZipFixture(text, { entry: ENTRY });
    await expect(readText(await open(zip, 7))).resolves.toBe(text);
  });

  it('reads a stored entry and a zip64 entry', async () => {
    const text = feedDocument(3);
    for (const options of [{ method: 'stored' as const }, { zip64: true }]) {
      const zip = await buildZipFixture(text, { entry: ENTRY, ...options });
      await expect(readText(await open(zip))).resolves.toBe(text);
    }
  });

  it('takes the size of a data-descriptor entry from the central directory', async () => {
    const text = feedDocument(5);
    const small = await buildZipFixture(text, {
      entry: ENTRY,
      dataDescriptor: true,
    });
    await expect(readText(await open(small, 5))).resolves.toBe(text);

    // Larger than the held-back tail, so data is released while streaming.
    const large = 'x'.repeat(300 * 1024);
    const zip = await buildZipFixture(large, {
      entry: ENTRY,
      method: 'stored',
      dataDescriptor: true,
    });
    await expect(readText(await open(zip, 10_000))).resolves.toBe(large);
  });

  it('rejects archives it cannot read with a fixed code', async () => {
    const zip = await buildZipFixture('{}', { entry: ENTRY });
    // Cut off or not a zip at all: a retry may get a whole archive.
    for (const bytes of [
      zip.slice(0, 20),
      zip.slice(0, 32),
      Object.assign(zip.slice(), { 0: 0 }),
    ]) {
      await expect(open(bytes)).rejects.toThrow(
        new FeedError('feed_extract_failed'),
      );
    }
    // Encrypted, or an unsupported method: a retry gets the same archive.
    for (const bytes of [
      Object.assign(zip.slice(), { 6: 1 }),
      Object.assign(zip.slice(), { 8: 12 }),
    ]) {
      await expect(open(bytes)).rejects.toThrow(
        new FeedError('feed_unsupported_archive'),
      );
    }
    await expect(
      openZipEntry(streamOf(zip), {
        entry: 'other.json',
        maxCompressedBytes: 1e6,
      }),
    ).rejects.toThrow(new FeedError('feed_unsupported_archive'));
  });

  it('reports a download that fails while the header is read', async () => {
    const dropped = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new TypeError('connection reset'));
      },
    });
    await expect(
      openZipEntry(dropped, { entry: ENTRY, maxCompressedBytes: 1e6 }),
    ).rejects.toThrow(new FeedError('feed_download_failed'));
  });

  it('rejects zip64 headers without a usable size', async () => {
    const zip = await buildZipFixture('{}', { entry: ENTRY, zip64: true });
    const extraStart = 30 + ENTRY.length;
    // Another extra field id: no zip64 record remains.
    const otherId = zip.slice();
    otherId[extraStart] = 0x99;
    await expect(open(otherId)).rejects.toThrow(
      new FeedError('feed_unsupported_archive'),
    );
    // A compressed size above Number.MAX_SAFE_INTEGER.
    const huge = zip.slice();
    huge.fill(0xff, extraStart + 12, extraStart + 20);
    await expect(open(huge)).rejects.toThrow(
      new FeedError('feed_unsupported_archive'),
    );
  });

  it('reads a streamed zip64 entry, whose header sizes are placeholders, from the central directory', async () => {
    const text = feedDocument(30);
    const zip = await buildZipFixture(text, {
      entry: ENTRY,
      dataDescriptor: true,
      zip64: true,
    });
    // As streaming writers leave it: 0xFFFFFFFF sizes and a zip64 field of 0.
    const view = new DataView(zip.buffer);
    view.setUint32(18, 0xffffffff, true);
    view.setUint32(22, 0xffffffff, true);
    zip.fill(0, 30 + ENTRY.length + 4, 30 + ENTRY.length + 20);
    await expect(readText(await open(zip))).resolves.toBe(text);
  });

  it('rejects zip64 central directory records it does not read', async () => {
    const zip = await buildZipFixture('{"data":[1]}', {
      entry: ENTRY,
      dataDescriptor: true,
    });
    const view = (bytes: Uint8Array) => new DataView(bytes.buffer);
    const endOffset = zip.byteLength - 22;
    const centralOffset = view(zip).getUint32(endOffset + 16, true);
    const zip64Offset = zip.slice();
    view(zip64Offset).setUint32(endOffset + 16, 0xffffffff, true);
    const zip64Size = zip.slice();
    view(zip64Size).setUint32(centralOffset + 20, 0xffffffff, true);
    for (const bytes of [zip64Offset, zip64Size]) {
      await expect(readText(await open(bytes))).rejects.toThrow(
        new FeedError('feed_unsupported_archive'),
      );
    }
  });

  it('skips unrelated extra fields before the zip64 record', async () => {
    const text = '{"data":[1]}';
    const zip = await buildZipFixture(text, { entry: ENTRY, zip64: true });
    const nameEnd = 30 + ENTRY.length;
    const padded = new Uint8Array(zip.byteLength + 8);
    padded.set(zip.subarray(0, nameEnd));
    // A 4-byte unrelated field: id 0x9999, size 4.
    padded.set([0x99, 0x99, 4, 0, 1, 2, 3, 4], nameEnd);
    padded.set(zip.subarray(nameEnd), nameEnd + 8);
    new DataView(padded.buffer).setUint16(28, 28, true);
    await expect(readText(await open(padded))).resolves.toBe(text);
  });

  it('fails a truncated entry and an oversized one', async () => {
    const text = feedDocument(50);
    const zip = await buildZipFixture(text, { entry: ENTRY });
    await expect(
      readText(await open(zip.slice(0, zip.byteLength - 200))),
    ).rejects.toThrow(new FeedError('feed_extract_failed'));
    await expect(open(zip, 64, 10)).rejects.toThrow(
      new FeedError('feed_too_large'),
    );
    const described = await buildZipFixture(text, {
      entry: ENTRY,
      dataDescriptor: true,
    });
    await expect(readText(await open(described, 64, 10))).rejects.toThrow(
      new FeedError('feed_too_large'),
    );
  });

  it('fails a data-descriptor archive without a matching central directory', async () => {
    const zip = await buildZipFixture('{"data":[1]}', {
      entry: ENTRY,
      dataDescriptor: true,
    });
    const view = (bytes: Uint8Array) => new DataView(bytes.buffer);
    const endOffset = zip.byteLength - 22;
    const centralOffset = view(zip).getUint32(endOffset + 16, true);

    const noEnd = zip.slice(0, endOffset);
    const badOffset = zip.slice();
    view(badOffset).setUint32(endOffset + 16, 999_999, true);
    const badSignature = zip.slice();
    badSignature[centralOffset] = 0;
    const notFirst = zip.slice();
    view(notFirst).setUint32(centralOffset + 42, 5, true);
    const tooBig = zip.slice();
    view(tooBig).setUint32(centralOffset + 20, 999_999, true);

    for (const bytes of [noEnd, badOffset, badSignature, notFirst, tooBig]) {
      await expect(readText(await open(bytes))).rejects.toThrow(
        new FeedError('feed_extract_failed'),
      );
    }
  });

  it('handles a header that ends exactly on a chunk boundary', async () => {
    const text = feedDocument(2);
    const zip = await buildZipFixture(text, { entry: ENTRY });
    await expect(readText(await open(zip, 30 + ENTRY.length))).resolves.toBe(
      text,
    );
  });

  it('stops reading the archive when the entry stream is cancelled', async () => {
    for (const method of ['deflate', 'stored'] as const) {
      const zip = await buildZipFixture(feedDocument(200), {
        entry: ENTRY,
        method,
      });
      const cancel = vi.fn();
      const reader = streamOf(zip, 16).getReader();
      const tracked = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const { done, value } = await reader.read();
          if (done) controller.close();
          else controller.enqueue(value);
        },
        cancel,
      });
      const document = await openZipEntry(tracked, {
        entry: ENTRY,
        maxCompressedBytes: 1e6,
      });
      const documentReader = document.getReader();
      await documentReader.read();
      await documentReader.cancel();
      expect(cancel).toHaveBeenCalled();
    }
  });

  it('reports a download that fails mid-archive as a download failure', async () => {
    const zip = await buildZipFixture(feedDocument(200), { entry: ENTRY });
    let sent = false;
    const failing = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) {
          controller.error(new Error('connection reset'));
          return;
        }
        sent = true;
        controller.enqueue(zip.slice(0, 100));
      },
    });
    const document = await openZipEntry(failing, {
      entry: ENTRY,
      maxCompressedBytes: 1e6,
    });
    await expect(
      writeFeedPages({
        document,
        field: 'data',
        pageSize: 3,
        maxBytes: 1e6,
        sink: async () => undefined,
      }),
    ).rejects.toThrow(new FeedError('feed_download_failed'));
  });
});

describe('JSON array scanner', () => {
  it('extracts raw elements across every chunk boundary', () => {
    const elements = [
      { a: 'x{y}[z]"q"\\', b: [1, { c: null }] },
      'a "string" with \\ escapes é',
      -12.5e3,
      true,
      null,
      [],
      {},
    ];
    const text = `\r\n{ "meta" : {"data":[9]}, "count": 3, "flag": false, "s": "x\\"y",
      "data" : [ ${elements.map((element) => JSON.stringify(element)).join(' ,\n ')} ] ,
      "after": [1, 2] }  \n`;
    for (const chunkSize of [1, 2, 3, 7, 1000]) {
      expect(scan(text, chunkSize).map((raw) => JSON.parse(raw))).toEqual(
        elements,
      );
    }
  });

  it('matches only the exact field name', () => {
    expect(scan('{"dat":[1],"datum":[2],"d\\u0061ta":[3],"data":[4]}')).toEqual(
      ['4'],
    );
    expect(scan('{"data":[]}')).toEqual([]);
  });

  it('rejects malformed documents', () => {
    const malformed = [
      '[]',
      '{1:2}',
      '{"a" 1}',
      '{"data":{}}',
      '{"data":[1],"data":[2]}',
      '{"a":1 2}',
      '{"data":[1 2]}',
      '{"data":[1]} x',
      '{}',
      '{"data":[1]',
      '{"data":[,]}',
      '{"data":[1,]}',
      '{"a":]}',
      '{"a":}',
      '{"a"::1}',
      '{"data":[1"]}',
      '{"data":[1{]}',
      '{"data":[{"a":1}',
    ];
    for (const text of malformed) {
      expect(() => scan(text), text).toThrow(new FeedError('feed_parse_error'));
    }
  });
});

describe('page writer', () => {
  const record = (index: number) => [new TextEncoder().encode(String(index))];

  it('marks the last page even when it is full', async () => {
    for (const [count, expected] of [
      [1, [[true, 1]]],
      [3, [[true, 3]]],
      [
        4,
        [
          [false, 3],
          [true, 1],
        ],
      ],
      [
        6,
        [
          [false, 3],
          [true, 3],
        ],
      ],
    ] as const) {
      const { pages, sink } = collectingSink();
      const writer = createPageWriter(3, sink);
      for (let index = 0; index < count; index += 1) {
        const ready = writer.add(record(index));
        if (ready) await writer.flush(ready);
      }
      await expect(writer.finish()).resolves.toEqual({
        pages: expected.length,
        records: count,
      });
      expect(
        pages.map((page) => [page.isLastPage, page.records.length]),
      ).toEqual(expected);
    }
  });

  it('fails an empty feed', async () => {
    const writer = createPageWriter(3, async () => undefined);
    await expect(writer.finish()).rejects.toThrow(new FeedError('feed_empty'));
  });

  it('enforces the page count and page size limits', async () => {
    const write = async (count: number, limits: object) => {
      const writer = createPageWriter(1, async () => undefined, limits);
      for (let index = 0; index < count; index += 1) {
        const ready = writer.add(record(index));
        if (ready) await writer.flush(ready);
      }
      return writer.finish();
    };
    await expect(write(2, { maxPages: 2 })).resolves.toEqual({
      pages: 2,
      records: 2,
    });
    await expect(write(3, { maxPages: 2 })).rejects.toThrow(
      new FeedError('feed_too_large'),
    );
    // `{"page":1,"isLastPage":true,"records":[0]}` is 42 bytes.
    await expect(write(1, { maxPageBytes: 42 })).resolves.toEqual({
      pages: 1,
      records: 1,
    });
    await expect(write(1, { maxPageBytes: 41 })).rejects.toThrow(
      new FeedError('feed_too_large'),
    );
  });

  it('reports a failed page write as retryable', async () => {
    const writer = createPageWriter(3, async () => {
      throw new Error('R2 unavailable');
    });
    writer.add(record(1));
    await expect(writer.finish()).rejects.toThrow(
      new FeedError('feed_page_write_failed'),
    );
  });

  it('writes an empty page body as valid JSON', () => {
    expect(decoder.decode(pageBody(1, true, []))).toBe(
      '{"page":1,"isLastPage":true,"records":[]}',
    );
  });
});

describe('feed pages', () => {
  it('streams the data array into marked pages', async () => {
    const { pages, sink } = collectingSink();
    const document = streamOf(new TextEncoder().encode(feedDocument(7)), 5);
    await expect(
      writeFeedPages({
        document,
        field: 'data',
        pageSize: 3,
        maxBytes: 1e6,
        sink,
      }),
    ).resolves.toEqual({ pages: 3, records: 7 });
    expect(pages.map((page) => page.records.length)).toEqual([3, 3, 1]);
    expect(pages.at(-1)!.isLastPage).toBe(true);
    expect(pages[0]!.records[0]).toEqual({
      domainName: 'd0.example',
      note: 'braces { } [ ] and "quotes" in strings \\ ok',
    });
  });

  it('bounds the document size and maps stream failures', async () => {
    const sink = async () => undefined;
    const bytes = new TextEncoder().encode(feedDocument(7));
    await expect(
      writeFeedPages({
        document: streamOf(bytes),
        field: 'data',
        pageSize: 3,
        maxBytes: 100,
        sink,
      }),
    ).rejects.toThrow(new FeedError('feed_too_large'));

    const failing = (error: Error) =>
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(error);
        },
      });
    await expect(
      writeFeedPages({
        document: failing(new Error('inflate')),
        field: 'data',
        pageSize: 3,
        maxBytes: 1e6,
        sink,
      }),
    ).rejects.toThrow(new FeedError('feed_extract_failed'));
    await expect(
      writeFeedPages({
        document: failing(new FeedError('feed_too_large')),
        field: 'data',
        pageSize: 3,
        maxBytes: 1e6,
        sink,
      }),
    ).rejects.toThrow(new FeedError('feed_too_large'));
    await expect(
      writeFeedPages({
        document: streamOf(new TextEncoder().encode('{"data":[1,]}')),
        field: 'data',
        pageSize: 3,
        maxBytes: 1e6,
        sink,
      }),
    ).rejects.toThrow(new FeedError('feed_parse_error'));
  });

  it('fails a record too large for a page before holding it whole', async () => {
    const encoder = new TextEncoder();
    const record = `{"padding":"${'x'.repeat(200)}"}`;
    // Fed in 16-byte chunks, as decompressed output arrives in many chunks,
    // so the cap only fires if it counts across them.
    const pushChunks = (text: string, cap: number) => {
      const elements: number[] = [];
      const scanner = createJsonArrayScanner(
        'data',
        (element) =>
          elements.push(element.reduce((sum, p) => sum + p.byteLength, 0)),
        cap,
      );
      const bytes = encoder.encode(text);
      for (let offset = 0; offset < bytes.byteLength; offset += 16) {
        scanner.push(bytes.subarray(offset, offset + 16));
      }
      scanner.end();
      return elements;
    };
    expect(() => pushChunks(`{"data":[${record}]}`, 100)).toThrow(
      new FeedError('feed_too_large'),
    );
    // The skipped `meta` member is not capped, and a record at the cap fits.
    const fits = `{"a":"${'y'.repeat(92)}"}`;
    expect(fits.length).toBe(100);
    expect(pushChunks(`{"meta":${record},"data":[${fits},1]}`, 100)).toEqual([
      100, 1,
    ]);

    // `writeFeedPages` passes the page limit to the scanner, so the record
    // fails while it is still arriving, before the download's own failure.
    const truncated = encoder.encode(`{"data":[1,${record}`);
    let offset = 0;
    const arriving = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= truncated.byteLength) {
          controller.error(new FeedError('feed_download_failed'));
          return;
        }
        controller.enqueue(truncated.slice(offset, offset + 16));
        offset += 16;
      },
    });
    await expect(
      writeFeedPages({
        document: arriving,
        field: 'data',
        pageSize: 3,
        maxBytes: 1e6,
        limits: { maxPageBytes: 100 },
        sink: async () => undefined,
      }),
    ).rejects.toThrow(new FeedError('feed_too_large'));
  });

  it('keeps the code of a FeedError that a native stream re-created', async () => {
    // How workerd delivers a FeedError after DecompressionStream: not an
    // instance, but with its name and code.
    const recreated = (code: string) =>
      Object.assign(new Error(code), { name: 'FeedError', code });
    expect(feedErrorCode(new FeedError('feed_empty'))).toBe('feed_empty');
    expect(feedErrorCode(recreated('feed_download_failed'))).toBe(
      'feed_download_failed',
    );
    expect(feedErrorCode(recreated('not_a_feed_code'))).toBeNull();
    expect(feedErrorCode(new Error('feed_empty'))).toBeNull();
    expect(feedErrorCode('feed_empty')).toBeNull();
    expect(feedErrorCode(null)).toBeNull();

    const failing = (error: Error) =>
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(error);
        },
      });
    for (const [error, expected] of [
      [recreated('feed_download_failed'), 'feed_download_failed'],
      [recreated('feed_unsupported_archive'), 'feed_unsupported_archive'],
      [recreated('not_a_feed_code'), 'feed_extract_failed'],
    ] as const) {
      await expect(
        writeFeedPages({
          document: failing(error),
          field: 'data',
          pageSize: 3,
          maxBytes: 1e6,
          sink: async () => undefined,
        }),
      ).rejects.toThrow(new FeedError(expected));
    }
  });
});

describe('zipped feed staging', () => {
  const options = {
    url: 'https://feed.example/feed.zip',
    entry: ENTRY,
    field: 'data',
    pageSize: 4,
    maxArchiveBytes: 1e6,
    maxDocumentBytes: 1e6,
    timeoutMs: 1_000,
  };

  it('downloads with a User-Agent and stages the pages', async () => {
    const zip = await buildZipFixture(feedDocument(9), { entry: ENTRY });
    const fetchImpl = vi.fn(async () => new Response(zip as BodyInit));
    const { pages, sink } = collectingSink();
    await expect(
      stageZippedFeed({ ...options, sink, fetchImpl: fetchImpl as never }),
    ).resolves.toEqual({ pages: 3, records: 9 });
    expect(pages.map((page) => page.isLastPage)).toEqual([false, false, true]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(options.url);
    expect(init.headers).toEqual({ 'user-agent': FEED_USER_AGENT });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('maps download failures to fixed codes', async () => {
    const sink = async () => undefined;
    const cases: [() => Promise<Response>, string][] = [
      [async () => Promise.reject(new Error('dns')), 'feed_download_failed'],
      [
        async () => new Response('nope', { status: 403 }),
        'feed_download_failed',
      ],
      [async () => new Response(null), 'feed_download_failed'],
      [
        async () =>
          new Response('x', { headers: { 'content-length': '2000000' } }),
        'feed_too_large',
      ],
    ];
    for (const [fetchImpl, code] of cases) {
      await expect(
        stageZippedFeed({ ...options, sink, fetchImpl: fetchImpl as never }),
      ).rejects.toThrow(new FeedError(code as never));
    }
  });
});

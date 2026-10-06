// @vitest-environment node
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createPageWriter,
  downloadFeed,
  FeedError,
  serveFeedPages,
  stageZippedFeed,
  writeFeedPages,
} from './file-feed';

const directories: string[] = [];

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'file-feed-test-'));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function readPage(directory: string, page: number) {
  return JSON.parse(
    readFileSync(join(directory, `page-${page}.json`), 'utf8'),
  ) as { page: number; isLastPage: boolean; records: unknown[] };
}

function feedDocument(count: number) {
  return JSON.stringify({
    meta: { title: 'invented', data: ['not records'] },
    data: Array.from({ length: count }, (_, index) => ({
      domainName: `d${index}.example`,
      note: 'braces { } and "quotes" in strings',
    })),
  });
}

describe('feed download', () => {
  it('streams the archive to disk within its byte limit', async () => {
    const directory = temporaryDirectory();
    const destination = join(directory, 'feed.zip');
    await downloadFeed({
      url: 'https://feed.example/feed.zip',
      destination,
      maxBytes: 10,
      timeoutMs: 1_000,
      fetchImpl: (async () => new Response('archive')) as typeof fetch,
    });
    expect(readFileSync(destination, 'utf8')).toBe('archive');
  });

  it('fails with fixed codes', async () => {
    const destination = join(temporaryDirectory(), 'feed.zip');
    const attempt = (fetchImpl: () => Promise<Response>, maxBytes = 10) =>
      downloadFeed({
        url: 'https://feed.example/feed.zip',
        destination,
        maxBytes,
        timeoutMs: 1_000,
        fetchImpl: fetchImpl as typeof fetch,
      });
    await expect(
      attempt(async () => {
        throw new Error('offline');
      }),
    ).rejects.toThrow(new FeedError('feed_download_failed'));
    await expect(
      attempt(async () => new Response(null, { status: 503 })),
    ).rejects.toThrow(new FeedError('feed_download_failed'));
    await expect(attempt(async () => new Response(null))).rejects.toThrow(
      new FeedError('feed_download_failed'),
    );
    await expect(
      attempt(async () => new Response('much too large')),
    ).rejects.toThrow(new FeedError('feed_too_large'));
    await expect(
      attempt(
        async () =>
          new Response(
            new ReadableStream({
              pull(controller) {
                controller.error(new Error('reset'));
              },
            }),
          ),
      ),
    ).rejects.toThrow(new FeedError('feed_download_failed'));
  });
});

describe('page writer', () => {
  it('marks the final page even when the feed fills its last page', async () => {
    const directory = temporaryDirectory();
    const writer = createPageWriter(directory, 2);
    for (const record of [1, 2, 3, 4]) await writer.add(record);
    await expect(writer.finish()).resolves.toEqual({ pages: 2, records: 4 });
    expect(readPage(directory, 1)).toEqual({
      page: 1,
      isLastPage: false,
      records: [1, 2],
    });
    expect(readPage(directory, 2)).toEqual({
      page: 2,
      isLastPage: true,
      records: [3, 4],
    });
  });

  it('writes a short final page after full pages', async () => {
    const directory = temporaryDirectory();
    const writer = createPageWriter(directory, 2);
    for (const record of [1, 2, 3, 4, 5]) await writer.add(record);
    await expect(writer.finish()).resolves.toEqual({ pages: 3, records: 5 });
    expect(readPage(directory, 2).isLastPage).toBe(false);
    expect(readPage(directory, 3)).toMatchObject({
      isLastPage: true,
      records: [5],
    });
  });

  it('writes a single short page and refuses an empty feed', async () => {
    const directory = temporaryDirectory();
    const writer = createPageWriter(directory, 2);
    await writer.add('only');
    await expect(writer.finish()).resolves.toEqual({ pages: 1, records: 1 });
    expect(readPage(directory, 1).isLastPage).toBe(true);

    await expect(createPageWriter(directory, 2).finish()).rejects.toThrow(
      new FeedError('feed_empty'),
    );
  });
});

describe('feed paging', () => {
  it('streams the top-level data array into pages', async () => {
    const directory = join(temporaryDirectory(), 'pages');
    await expect(
      writeFeedPages({
        source: Readable.from([feedDocument(5)]),
        directory,
        pageSize: 2,
        maxBytes: 1_000_000,
      }),
    ).resolves.toEqual({ pages: 3, records: 5 });
    expect(readdirSync(directory).sort()).toEqual([
      'page-1.json',
      'page-2.json',
      'page-3.json',
    ]);
    expect(readPage(directory, 1).records[0]).toEqual({
      domainName: 'd0.example',
      note: 'braces { } and "quotes" in strings',
    });
  });

  it('fails malformed, oversized, and empty documents', async () => {
    const directory = temporaryDirectory();
    const attempt = (text: string, maxBytes = 1_000_000) =>
      writeFeedPages({
        source: Readable.from([text]),
        directory,
        pageSize: 2,
        maxBytes,
      });
    await expect(attempt('{"data":[{"a":')).rejects.toThrow(
      new FeedError('feed_parse_error'),
    );
    await expect(attempt(feedDocument(5), 10)).rejects.toThrow(
      new FeedError('feed_too_large'),
    );
    await expect(attempt('{"meta":{}}')).rejects.toThrow(
      new FeedError('feed_empty'),
    );
  });
});

function fakeUnzip(
  output: string,
  exitCode: number | null,
  spawnError = false,
) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: Readable;
    kill: () => boolean;
  };
  child.stdout = Readable.from(output ? [output] : []);
  child.kill = vi.fn(() => true);
  child.stdout.once('end', () =>
    setImmediate(() =>
      spawnError
        ? child.emit('error', new Error('spawn unzip ENOENT'))
        : child.emit('close', exitCode),
    ),
  );
  return child as unknown as ChildProcess;
}

describe('zipped feed staging', () => {
  const stage = (child: ChildProcess) => {
    const directory = temporaryDirectory();
    const spawnImpl = vi.fn(() => child);
    return {
      spawnImpl,
      directory,
      result: stageZippedFeed({
        archive: '/feeds/feed.zip',
        entry: 'feed.json',
        directory,
        pageSize: 2,
        maxBytes: 1_000_000,
        spawnImpl,
      }),
    };
  };

  it('pages the extracted archive entry', async () => {
    const { result, spawnImpl, directory } = stage(
      fakeUnzip(feedDocument(3), 0),
    );
    await expect(result).resolves.toEqual({ pages: 2, records: 3 });
    expect(spawnImpl).toHaveBeenCalledWith('/feeds/feed.zip', 'feed.json');
    expect(readPage(directory, 2).isLastPage).toBe(true);
  });

  it('reports extraction failures rather than an empty feed', async () => {
    await expect(stage(fakeUnzip(feedDocument(3), 2)).result).rejects.toThrow(
      new FeedError('feed_extract_failed'),
    );
    await expect(stage(fakeUnzip('', 11)).result).rejects.toThrow(
      new FeedError('feed_extract_failed'),
    );
    await expect(stage(fakeUnzip('', null, true)).result).rejects.toThrow(
      new FeedError('feed_extract_failed'),
    );
  });

  it('uses the system unzip by default', async () => {
    // A missing archive fails whether or not `unzip` is installed.
    await expect(
      stageZippedFeed({
        archive: join(temporaryDirectory(), 'missing.zip'),
        entry: 'feed.json',
        directory: temporaryDirectory(),
        pageSize: 2,
        maxBytes: 1_000,
      }),
    ).rejects.toThrow(new FeedError('feed_extract_failed'));
  });

  it('keeps empty and parse failures and stops the extractor', async () => {
    const empty = fakeUnzip('{"data":[]}', 0);
    await expect(stage(empty).result).rejects.toThrow(
      new FeedError('feed_empty'),
    );
    const malformed = fakeUnzip('{"data":[', 0);
    await expect(stage(malformed).result).rejects.toThrow(
      new FeedError('feed_parse_error'),
    );
    expect(malformed.kill).toHaveBeenCalled();
  });
});

describe('loopback page server', () => {
  it('serves page files read-only on 127.0.0.1', async () => {
    const directory = temporaryDirectory();
    const writer = createPageWriter(directory, 2);
    await writer.add({ id: 1 });
    await writer.finish();

    const server = await serveFeedPages(directory);
    try {
      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
      const page = await fetch(new URL('page-1.json', server.url));
      expect(page.status).toBe(200);
      expect(page.headers.get('content-type')).toBe('application/json');
      await expect(page.json()).resolves.toEqual({
        page: 1,
        isLastPage: true,
        records: [{ id: 1 }],
      });
      for (const path of ['page-2.json', 'page-0.json', '../secret', '']) {
        const missing = await fetch(new URL(path, server.url));
        expect(missing.status).toBe(404);
      }
      const post = await fetch(new URL('page-1.json', server.url), {
        method: 'POST',
      });
      expect(post.status).toBe(405);
    } finally {
      await server.close();
    }
  });
});

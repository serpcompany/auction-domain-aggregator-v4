// Node-only staging for providers that publish their inventory as one large
// zipped JSON file instead of a paged API (GoDaddy). The local runner
// downloads the archive, streams the `data` array out of it into numbered page
// files, and serves those pages on a loopback-only HTTP server. The ingestion
// worker then reads them through the provider adapter like any other paged
// source. Nothing here is imported by a Worker.
import { spawn, type ChildProcess } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

import parser from 'stream-json/parser.js';
import pick from 'stream-json/filters/pick.js';
import streamArray from 'stream-json/streamers/stream-array.js';

export type FeedErrorCode =
  | 'feed_download_failed'
  | 'feed_too_large'
  | 'feed_extract_failed'
  | 'feed_parse_error'
  | 'feed_empty';

export class FeedError extends Error {
  readonly code: FeedErrorCode;

  constructor(code: FeedErrorCode) {
    super(code);
    this.name = 'FeedError';
    this.code = code;
    this.stack = undefined;
  }
}

// Fails a stream once more than `maxBytes` have passed through it.
function byteLimit(maxBytes: number, onBytes?: (bytes: number) => void) {
  let bytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.byteLength;
      onBytes?.(bytes);
      callback(
        bytes > maxBytes ? new FeedError('feed_too_large') : null,
        chunk,
      );
    },
  });
}

export async function downloadFeed({
  url,
  destination,
  maxBytes,
  timeoutMs,
  fetchImpl = fetch,
}: {
  url: string;
  destination: string;
  maxBytes: number;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}) {
  const signal = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, { signal });
  } catch {
    throw new FeedError('feed_download_failed');
  }
  if (!response.ok || !response.body) {
    throw new FeedError('feed_download_failed');
  }
  try {
    await pipeline(
      Readable.fromWeb(response.body as WebReadableStream),
      byteLimit(maxBytes),
      createWriteStream(destination, { mode: 0o600 }),
    );
  } catch (error) {
    throw error instanceof FeedError
      ? error
      : new FeedError('feed_download_failed');
  }
}

export type FeedPagesSummary = { pages: number; records: number };

export function pageFileName(page: number) {
  return `page-${page}.json`;
}

// Writes records into page files of `pageSize`. A full page is held back
// until the next record arrives, so the final page is always marked
// `isLastPage` even when the feed size is an exact multiple of the page size.
export function createPageWriter(directory: string, pageSize: number) {
  let current: unknown[] = [];
  let held: unknown[] | null = null;
  let pages = 0;
  let records = 0;

  const write = async (pageRecords: unknown[], isLastPage: boolean) => {
    pages += 1;
    await writeFile(
      join(directory, pageFileName(pages)),
      JSON.stringify({ page: pages, isLastPage, records: pageRecords }),
      { mode: 0o600 },
    );
  };

  return {
    async add(record: unknown) {
      records += 1;
      current.push(record);
      if (current.length < pageSize) return;
      if (held) await write(held, false);
      held = current;
      current = [];
    },
    async finish(): Promise<FeedPagesSummary> {
      if (records === 0) throw new FeedError('feed_empty');
      if (held && current.length > 0) {
        await write(held, false);
        await write(current, true);
      } else {
        await write(held ?? current, true);
      }
      return { pages, records };
    },
  };
}

// Streams the elements of the top-level `data` array out of a JSON document
// into page files, without holding the document in memory.
export async function writeFeedPages({
  source,
  directory,
  pageSize,
  maxBytes,
  onBytes,
}: {
  source: Readable;
  directory: string;
  pageSize: number;
  maxBytes: number;
  onBytes?: (bytes: number) => void;
}) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const writer = createPageWriter(directory, pageSize);
  try {
    await pipeline(
      source,
      byteLimit(maxBytes, onBytes),
      parser.asStream(),
      pick.asStream({ filter: 'data' }),
      streamArray.asStream(),
      async function (items: AsyncIterable<{ value: unknown }>) {
        for await (const { value } of items) await writer.add(value);
      },
    );
  } catch (error) {
    throw error instanceof FeedError
      ? error
      : new FeedError('feed_parse_error');
  }
  return writer.finish();
}

type SpawnUnzip = (archive: string, entry: string) => ChildProcess;

const spawnUnzip: SpawnUnzip = (archive, entry) =>
  spawn('unzip', ['-p', archive, entry], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });

// Extracts one archive entry with the system `unzip` and pages its records.
export async function stageZippedFeed({
  archive,
  entry,
  directory,
  pageSize,
  maxBytes,
  spawnImpl = spawnUnzip,
}: {
  archive: string;
  entry: string;
  directory: string;
  pageSize: number;
  maxBytes: number;
  spawnImpl?: SpawnUnzip;
}) {
  const child = spawnImpl(archive, entry);
  const exited = new Promise<number | null>((resolve) => {
    child.once('error', () => resolve(null));
    child.once('close', (code: number | null) => resolve(code));
  });
  let extractedBytes = 0;
  try {
    const summary = await writeFeedPages({
      source: child.stdout!,
      directory,
      pageSize,
      maxBytes,
      onBytes: (bytes) => {
        extractedBytes = bytes;
      },
    });
    if ((await exited) !== 0) throw new FeedError('feed_extract_failed');
    return summary;
  } catch (error) {
    child.kill();
    const code = await exited;
    // No output plus a failed `unzip` (missing entry, corrupt archive, or no
    // `unzip` binary) is an extraction failure, not a malformed feed.
    if (extractedBytes === 0 && code !== 0) {
      throw new FeedError('feed_extract_failed');
    }
    throw error;
  }
}

const PAGE_PATH = /^\/page-([1-9]\d{0,5})\.json$/;

// Serves page files read-only on 127.0.0.1 at an ephemeral port.
export async function serveFeedPages(directory: string) {
  const server: Server = createServer((request, response) => {
    // Always set on server requests.
    const match = PAGE_PATH.exec(request.url!);
    if (request.method !== 'GET') {
      response.writeHead(405).end();
      return;
    }
    if (!match) {
      response.writeHead(404).end();
      return;
    }
    const stream = createReadStream(
      join(directory, pageFileName(Number(match[1]))),
    );
    stream.once('error', () => response.writeHead(404).end());
    stream.once('open', () => {
      response.writeHead(200, { 'content-type': 'application/json' });
      stream.pipe(response);
    });
  });
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve()),
  );
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

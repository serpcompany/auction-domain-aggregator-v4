// Stages a provider inventory published as one large zipped JSON document
// (GoDaddy's `all_biddable_auctions.json.zip`, about 37 MB zipped and 450 MB
// unzipped) into numbered page files of raw records. Everything is a stream,
// so it runs inside a Worker (workerd) without holding the document in
// memory:
//
//   fetch body -> zip local file header -> DecompressionStream('deflate-raw')
//     -> byte-level scan of the top-level `data` array -> page writer -> sink
//
// Only web-platform APIs are used. Records are copied as raw JSON bytes and
// validated later by the provider adapter, one record at a time.

// `feed_download_failed`, `feed_extract_failed` (a truncated or corrupt
// download) and `feed_page_write_failed` may succeed on a retry; the others
// describe the feed itself and will not.
const FEED_ERROR_CODES = [
  'feed_download_failed',
  'feed_too_large',
  'feed_extract_failed',
  'feed_unsupported_archive',
  'feed_parse_error',
  'feed_empty',
  'feed_page_write_failed',
] as const;

export type FeedErrorCode = (typeof FEED_ERROR_CODES)[number];

export class FeedError extends Error {
  readonly code: FeedErrorCode;

  constructor(code: FeedErrorCode) {
    super(code);
    this.name = 'FeedError';
    this.code = code;
  }
}

// The code of a FeedError, or null for any other error. workerd re-creates an
// error that passes through a native stream such as DecompressionStream, so
// it is no longer a FeedError instance there; its name and code survive.
export function feedErrorCode(error: unknown): FeedErrorCode | null {
  if (typeof error !== 'object' || error === null) return null;
  const { name, code } = error as { name?: unknown; code?: unknown };
  return name === 'FeedError' &&
    (FEED_ERROR_CODES as readonly unknown[]).includes(code)
    ? (code as FeedErrorCode)
    : null;
}

// The FeedError `error` stands for, or a new one with `fallback`.
function asFeedError(error: unknown, fallback: FeedErrorCode) {
  return new FeedError(feedErrorCode(error) ?? fallback);
}

// Cancelling a stream that has already failed rejects; the original failure
// is the one reported.
function ignoreRejection() {
  return undefined;
}

// ---------------------------------------------------------------------------
// Zip entry

const LOCAL_FILE_HEADER = 0x04034b50;
const LOCAL_HEADER_BYTES = 30;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_DATA_DESCRIPTOR = 0x0008;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
const ZIP64_EXTRA = 0x0001;
const ZIP64_MARKER = 0xffffffff;

type ByteReader = {
  // Resolves with at least `count` buffered bytes, or fewer at end of input.
  fill(count: number): Promise<Uint8Array>;
  consume(count: number): void;
  // Yields the remaining input, starting with any buffered bytes.
  rest(): AsyncGenerator<Uint8Array>;
  cancel(): Promise<void>;
};

function byteReader(source: ReadableStream<Uint8Array>): ByteReader {
  const reader = source.getReader();
  let buffered = new Uint8Array(0);
  let ended = false;

  return {
    async fill(count) {
      while (buffered.byteLength < count && !ended) {
        const { done, value } = await reader.read();
        if (done) {
          ended = true;
          break;
        }
        const next = new Uint8Array(buffered.byteLength + value.byteLength);
        next.set(buffered);
        next.set(value, buffered.byteLength);
        buffered = next;
      }
      return buffered;
    },
    consume(count) {
      buffered = buffered.subarray(count);
    },
    async *rest() {
      try {
        if (buffered.byteLength > 0) yield buffered;
        buffered = new Uint8Array(0);
        while (!ended) {
          const { done, value } = await reader.read();
          if (done) break;
          yield value;
        }
      } finally {
        // Stops the download once the entry has been read, or on failure.
        ended = true;
        await reader.cancel().catch(ignoreRejection);
      }
    },
    async cancel() {
      ended = true;
      await reader.cancel().catch(ignoreRejection);
    },
  };
}

type LocalEntry = {
  method: number;
  // Null when the sizes follow the data in a data descriptor.
  compressedSize: number | null;
  headerLength: number;
};

// The zip64 extended-information field of a local header holds the
// uncompressed and then the compressed size, 8 bytes each.
function zip64CompressedSize(extra: Uint8Array) {
  const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  let offset = 0;
  while (offset + 4 <= extra.byteLength) {
    const id = view.getUint16(offset, true);
    const size = view.getUint16(offset + 2, true);
    if (id === ZIP64_EXTRA && size >= 16 && offset + 20 <= extra.byteLength) {
      const value = view.getBigUint64(offset + 12, true);
      return value > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(value);
    }
    offset += 4 + size;
  }
  return null;
}

async function readLocalHeader(
  input: ByteReader,
  entry: string,
): Promise<LocalEntry> {
  const fixed = await input.fill(LOCAL_HEADER_BYTES);
  if (fixed.byteLength < LOCAL_HEADER_BYTES) {
    throw new FeedError('feed_extract_failed');
  }
  const view = new DataView(fixed.buffer, fixed.byteOffset, fixed.byteLength);
  const flags = view.getUint16(6, true);
  const method = view.getUint16(8, true);
  const size = view.getUint32(18, true);
  const nameLength = view.getUint16(26, true);
  const extraLength = view.getUint16(28, true);
  // Anything but a zip (an error page, a cut-off body) may be transient.
  if (view.getUint32(0, true) !== LOCAL_FILE_HEADER) {
    throw new FeedError('feed_extract_failed');
  }
  if (
    flags & FLAG_ENCRYPTED ||
    (method !== METHOD_STORED && method !== METHOD_DEFLATE)
  ) {
    throw new FeedError('feed_unsupported_archive');
  }

  const headerLength = LOCAL_HEADER_BYTES + nameLength + extraLength;
  const header = await input.fill(headerLength);
  if (header.byteLength < headerLength) {
    throw new FeedError('feed_extract_failed');
  }
  const name = new TextDecoder().decode(
    header.subarray(LOCAL_HEADER_BYTES, LOCAL_HEADER_BYTES + nameLength),
  );
  // The archive's first entry must be the expected document.
  if (name !== entry) throw new FeedError('feed_unsupported_archive');
  const extra = header.subarray(LOCAL_HEADER_BYTES + nameLength, headerLength);
  input.consume(headerLength);

  // With a data descriptor, the local header's sizes are not reliable:
  // streaming writers leave them 0, or 0xFFFFFFFF with a zip64 field of 0.
  // The central directory has the real size.
  if (flags & FLAG_DATA_DESCRIPTOR) {
    return { method, compressedSize: null, headerLength };
  }
  let compressedSize: number | null = size;
  if (size === ZIP64_MARKER) {
    compressedSize = zip64CompressedSize(extra);
    if (compressedSize === null) {
      throw new FeedError('feed_unsupported_archive');
    }
  }
  return { method, compressedSize, headerLength };
}

// Yields exactly `limit` bytes of `chunks`, failing if the input ends early.
async function* limitBytes(chunks: AsyncGenerator<Uint8Array>, limit: number) {
  let remaining = limit;
  try {
    for await (const chunk of chunks) {
      if (chunk.byteLength >= remaining) {
        yield chunk.subarray(0, remaining);
        return;
      }
      remaining -= chunk.byteLength;
      yield chunk;
    }
  } finally {
    await chunks.return(undefined);
  }
  throw new FeedError('feed_extract_failed');
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
// Enough for the end record with a maximal comment plus one directory entry.
const ARCHIVE_TAIL_BYTES = 256 * 1024;

// The compressed size of the archive's first entry, read from the central
// directory in the archive's final bytes. `tailOffset` is the archive offset
// of `tail[0]`.
function centralDirectorySize(tail: Uint8Array, tailOffset: number) {
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  for (let end = tail.byteLength - 22; end >= 0; end -= 1) {
    if (view.getUint32(end, true) !== END_OF_CENTRAL_DIRECTORY) continue;
    const offset = view.getUint32(end + 16, true);
    // Zip64 end records and directory sizes are not read. GoDaddy's archive
    // is far below 4 GiB, so it does not need them.
    if (offset === ZIP64_MARKER) {
      throw new FeedError('feed_unsupported_archive');
    }
    const entry = offset - tailOffset;
    if (
      entry < 0 ||
      entry + 46 > end ||
      view.getUint32(entry, true) !== CENTRAL_DIRECTORY_ENTRY ||
      view.getUint32(entry + 42, true) !== 0
    ) {
      break;
    }
    const size = view.getUint32(entry + 20, true);
    if (size === ZIP64_MARKER) throw new FeedError('feed_unsupported_archive');
    return size;
  }
  throw new FeedError('feed_extract_failed');
}

// For an entry whose size follows its data (a data descriptor), yields
// exactly the entry's compressed bytes. The archive's last bytes are held
// back until the download ends, then the central directory they contain
// gives the size. workerd's DecompressionStream rejects any bytes after the
// end of the deflate data, so the descriptor and directory must not reach it.
async function* descriptorEntryBytes(
  chunks: AsyncGenerator<Uint8Array>,
  headerLength: number,
  maxBytes: number,
) {
  let tail = new Uint8Array(0);
  let yielded = 0;
  for await (const chunk of chunks) {
    if (yielded + tail.byteLength + chunk.byteLength > maxBytes) {
      await chunks.return(undefined);
      throw new FeedError('feed_too_large');
    }
    const joined = new Uint8Array(tail.byteLength + chunk.byteLength);
    joined.set(tail);
    joined.set(chunk, tail.byteLength);
    const release = joined.byteLength - ARCHIVE_TAIL_BYTES;
    if (release > 0) {
      yield joined.slice(0, release);
      yielded += release;
      tail = joined.slice(release);
    } else {
      tail = joined;
    }
  }
  const size = centralDirectorySize(tail, headerLength + yielded);
  const remaining = size - yielded;
  if (remaining < 0 || remaining > tail.byteLength) {
    throw new FeedError('feed_extract_failed');
  }
  yield tail.subarray(0, remaining);
}

function streamFrom(chunks: AsyncGenerator<Uint8Array>) {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await chunks.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (error) {
        // A raw error here is the download failing mid-archive.
        controller.error(asFeedError(error, 'feed_download_failed'));
      }
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });
}

// Opens the first entry of a zip archive stream, which must be named
// `entry`, and returns its decompressed bytes. Only the local file header is
// read when it declares the entry's compressed size; otherwise the size comes
// from the central directory at the end of the archive.
export async function openZipEntry(
  archive: ReadableStream<Uint8Array>,
  { entry, maxCompressedBytes }: { entry: string; maxCompressedBytes: number },
): Promise<ReadableStream<Uint8Array>> {
  const input = byteReader(archive);
  let local: LocalEntry;
  try {
    local = await readLocalHeader(input, entry);
  } catch (error) {
    await input.cancel();
    // A raw error is the download failing while the header is read.
    throw asFeedError(error, 'feed_download_failed');
  }
  if (
    local.compressedSize !== null &&
    local.compressedSize > maxCompressedBytes
  ) {
    await input.cancel();
    throw new FeedError('feed_too_large');
  }

  const data = streamFrom(
    local.compressedSize === null
      ? descriptorEntryBytes(
          input.rest(),
          local.headerLength,
          maxCompressedBytes,
        )
      : limitBytes(input.rest(), local.compressedSize),
  );
  if (local.method === METHOD_STORED) return data;
  return data.pipeThrough(
    new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<
      Uint8Array,
      Uint8Array
    >,
  );
}

// ---------------------------------------------------------------------------
// JSON array scanning

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const OPEN_OBJECT = 0x7b;
const CLOSE_OBJECT = 0x7d;
const OPEN_ARRAY = 0x5b;
const CLOSE_ARRAY = 0x5d;
const COMMA = 0x2c;
const COLON = 0x3a;

function isWhitespace(byte: number) {
  return byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09;
}

function isValueDelimiter(byte: number) {
  return (
    isWhitespace(byte) ||
    byte === COMMA ||
    byte === CLOSE_ARRAY ||
    byte === CLOSE_OBJECT
  );
}

type ScannerState =
  | 'root'
  | 'key-or-end'
  | 'key-next'
  | 'key'
  | 'colon'
  | 'field-array'
  | 'member-value'
  | 'in-member'
  | 'after-member'
  | 'item-or-end'
  | 'item-next'
  | 'in-item'
  | 'after-item'
  | 'done';

// A raw JSON value as one or more byte slices of the input chunks.
export type RawElement = Uint8Array[];

// Splits the elements of the top-level object's `field` array out of a JSON
// document delivered in arbitrary byte chunks. JSON's structural characters
// are ASCII and never occur inside a multi-byte UTF-8 sequence, so the input
// is scanned as bytes without decoding. Other members are skipped. The
// scanner checks the document's outer structure and string and bracket
// nesting only; element contents are copied verbatim and fully parsed when
// their page is read, so a malformed element fails that page. An element is
// held until it ends, so one longer than `maxElementBytes` fails the feed.
export function createJsonArrayScanner(
  field: string,
  onElement: (element: RawElement) => void,
  maxElementBytes = Number.POSITIVE_INFINITY,
) {
  const fieldBytes = new TextEncoder().encode(field);
  let state: ScannerState = 'root';
  let fieldSeen = false;
  // Key comparison against `field`.
  let keyMatches = true;
  let keyLength = 0;
  let keyEscaped = false;
  // The value being scanned: a skipped member or a captured element.
  let depth = 0;
  let inString = false;
  let escaped = false;
  let scalar = false;
  let pieces: Uint8Array[] = [];
  let pieceBytes = 0;
  // Position of the next backslash in the current chunk (-1 for none, -2
  // before the first search), so strings without escapes are skipped with
  // one native search each.
  let nextBackslash = -2;

  const fail = (): never => {
    throw new FeedError('feed_parse_error');
  };

  const keep = (piece: Uint8Array) => {
    pieceBytes += piece.byteLength;
    if (pieceBytes > maxElementBytes) throw new FeedError('feed_too_large');
    pieces.push(piece);
  };

  // Starts a value whose first byte is `byte`.
  const beginValue = (byte: number) => {
    depth = 0;
    inString = false;
    escaped = false;
    scalar = false;
    if (byte === OPEN_OBJECT || byte === OPEN_ARRAY) depth = 1;
    else if (byte === QUOTE) inString = true;
    else if (
      byte === CLOSE_OBJECT ||
      byte === CLOSE_ARRAY ||
      byte === COMMA ||
      byte === COLON
    ) {
      fail();
    } else scalar = true;
  };

  // Continues the current value from `start`. Returns the index just past
  // the value, or -1 when the value continues into the next chunk.
  const scanValue = (chunk: Uint8Array, start: number) => {
    const length = chunk.byteLength;
    let index = start;
    while (index < length) {
      if (inString) {
        if (escaped) {
          escaped = false;
          index += 1;
          continue;
        }
        if (nextBackslash !== -1 && nextBackslash < index) {
          nextBackslash = chunk.indexOf(BACKSLASH, index);
        }
        const quote = chunk.indexOf(QUOTE, index);
        if (nextBackslash !== -1 && (quote === -1 || nextBackslash < quote)) {
          escaped = true;
          index = nextBackslash + 1;
          continue;
        }
        if (quote === -1) return -1;
        inString = false;
        index = quote + 1;
        if (depth === 0) return index;
        continue;
      }
      const byte = chunk[index]!;
      if (scalar) {
        if (isValueDelimiter(byte)) return index;
        if (byte === QUOTE || byte === OPEN_OBJECT || byte === OPEN_ARRAY) {
          fail();
        }
      } else if (byte === QUOTE) {
        inString = true;
      } else if (byte === OPEN_OBJECT || byte === OPEN_ARRAY) {
        depth += 1;
      } else if (byte === CLOSE_OBJECT || byte === CLOSE_ARRAY) {
        depth -= 1;
        if (depth === 0) return index + 1;
      }
      index += 1;
    }
    return -1;
  };

  // Continues the current key from `start`. Returns the index just past its
  // closing quote, or -1 when the key continues into the next chunk.
  const scanKey = (chunk: Uint8Array, start: number) => {
    for (let index = start; index < chunk.byteLength; index += 1) {
      const byte = chunk[index]!;
      if (keyEscaped) {
        keyEscaped = false;
      } else if (byte === BACKSLASH) {
        // An escaped key never equals the plain field name.
        keyEscaped = true;
        keyMatches = false;
      } else if (byte === QUOTE) {
        return index + 1;
      } else {
        if (fieldBytes[keyLength] !== byte) keyMatches = false;
        keyLength += 1;
      }
    }
    return -1;
  };

  const push = (chunk: Uint8Array) => {
    const length = chunk.byteLength;
    let index = 0;
    let itemStart = 0;
    nextBackslash = -2;
    while (index < length) {
      if (state === 'in-item' || state === 'in-member') {
        const end = scanValue(chunk, index);
        if (end === -1) {
          if (state === 'in-item') keep(chunk.subarray(itemStart));
          return;
        }
        if (state === 'in-item') {
          keep(chunk.subarray(itemStart, end));
          const element = pieces;
          pieces = [];
          pieceBytes = 0;
          onElement(element);
          state = 'after-item';
        } else {
          state = 'after-member';
        }
        index = end;
        continue;
      }
      if (state === 'key') {
        const end = scanKey(chunk, index);
        if (end === -1) return;
        state = 'colon';
        index = end;
        continue;
      }

      const byte = chunk[index]!;
      if (isWhitespace(byte)) {
        index += 1;
        continue;
      }
      switch (state) {
        case 'root':
          if (byte !== OPEN_OBJECT) fail();
          state = 'key-or-end';
          break;
        case 'key-or-end':
        case 'key-next':
          if (byte === CLOSE_OBJECT && state === 'key-or-end') {
            state = 'done';
            break;
          }
          if (byte !== QUOTE) fail();
          keyMatches = true;
          keyLength = 0;
          keyEscaped = false;
          state = 'key';
          break;
        case 'colon':
          if (byte !== COLON) fail();
          state =
            keyMatches && keyLength === fieldBytes.byteLength
              ? 'field-array'
              : 'member-value';
          break;
        case 'field-array':
          // The field's value must be an array, and the field appear once.
          if (byte !== OPEN_ARRAY || fieldSeen) fail();
          fieldSeen = true;
          state = 'item-or-end';
          break;
        case 'member-value':
          beginValue(byte);
          state = 'in-member';
          break;
        case 'after-member':
          if (byte === COMMA) state = 'key-next';
          else if (byte === CLOSE_OBJECT) state = 'done';
          else fail();
          break;
        case 'item-or-end':
        case 'item-next':
          if (byte === CLOSE_ARRAY && state === 'item-or-end') {
            state = 'after-member';
            break;
          }
          beginValue(byte);
          itemStart = index;
          state = 'in-item';
          break;
        case 'after-item':
          if (byte === COMMA) state = 'item-next';
          else if (byte === CLOSE_ARRAY) state = 'after-member';
          else fail();
          break;
        default:
          // Only whitespace may follow the document.
          fail();
      }
      index += 1;
    }
    // An element that began on this chunk's last byte.
    if (state === 'in-item') keep(chunk.subarray(itemStart));
  };

  return {
    push,
    end() {
      if (state !== 'done' || !fieldSeen) fail();
    },
  };
}

// ---------------------------------------------------------------------------
// Pages

export type FeedPagesSummary = { pages: number; records: number };

// Receives one finished page file. Its body is JSON:
// `{"page":N,"isLastPage":bool,"records":[...raw records]}`.
export type FeedPageSink = (page: number, body: Uint8Array) => Promise<void>;

const encoder = new TextEncoder();
const PAGE_SUFFIX = encoder.encode(']}');
const SEPARATOR = encoder.encode(',');

export function pageBody(
  page: number,
  isLastPage: boolean,
  records: RawElement[],
) {
  const prefix = encoder.encode(
    `{"page":${page},"isLastPage":${isLastPage},"records":[`,
  );
  let length = prefix.byteLength + PAGE_SUFFIX.byteLength;
  for (const record of records) {
    length += SEPARATOR.byteLength;
    for (const piece of record) length += piece.byteLength;
  }
  if (records.length > 0) length -= SEPARATOR.byteLength;
  const body = new Uint8Array(length);
  body.set(prefix);
  let offset = prefix.byteLength;
  records.forEach((record, index) => {
    if (index > 0) {
      body.set(SEPARATOR, offset);
      offset += SEPARATOR.byteLength;
    }
    for (const piece of record) {
      body.set(piece, offset);
      offset += piece.byteLength;
    }
  });
  body.set(PAGE_SUFFIX, offset);
  return body;
}

export type FeedPageLimits = {
  // The adapter's limits for reading pages back. A feed beyond them fails
  // while staging, rather than in every sync that follows.
  maxPages?: number;
  maxPageBytes?: number;
};

// Groups records into pages of `pageSize`. A full page is held back until
// the next record arrives, so the final page is always marked `isLastPage`,
// even when the record count is an exact multiple of the page size.
export function createPageWriter(
  pageSize: number,
  sink: FeedPageSink,
  {
    maxPages = Number.POSITIVE_INFINITY,
    maxPageBytes = Number.POSITIVE_INFINITY,
  }: FeedPageLimits = {},
) {
  let current: RawElement[] = [];
  let held: RawElement[] | null = null;
  let pages = 0;
  let records = 0;

  const write = async (pageRecords: RawElement[], isLastPage: boolean) => {
    pages += 1;
    if (pages > maxPages) throw new FeedError('feed_too_large');
    const body = pageBody(pages, isLastPage, pageRecords);
    if (body.byteLength > maxPageBytes) throw new FeedError('feed_too_large');
    try {
      await sink(pages, body);
    } catch {
      // Writing a page again under the same key is safe, so this is retried.
      throw new FeedError('feed_page_write_failed');
    }
  };

  return {
    // Adds a record and returns a page that is now complete and not last,
    // if any. The caller writes it with `flush` before reading more input,
    // so at most two pages are buffered.
    add(record: RawElement): RawElement[] | null {
      records += 1;
      current.push(record);
      if (current.length < pageSize) return null;
      const ready = held;
      held = current;
      current = [];
      return ready;
    },
    async flush(ready: RawElement[]) {
      await write(ready, false);
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

// Streams the `field` array of a JSON document into page files.
export async function writeFeedPages({
  document,
  field,
  pageSize,
  maxBytes,
  limits = {},
  sink,
}: {
  document: ReadableStream<Uint8Array>;
  field: string;
  pageSize: number;
  maxBytes: number;
  limits?: FeedPageLimits;
  sink: FeedPageSink;
}): Promise<FeedPagesSummary> {
  const writer = createPageWriter(pageSize, sink, limits);
  const ready: RawElement[][] = [];
  const scanner = createJsonArrayScanner(
    field,
    (element) => {
      const page = writer.add(element);
      if (page) ready.push(page);
    },
    // A record that cannot fit in a page fails before it is held whole.
    limits.maxPageBytes,
  );
  const reader = document.getReader();
  let bytes = 0;
  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        // A FeedError from the archive, or corrupt deflate data.
        throw asFeedError(error, 'feed_extract_failed');
      }
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw new FeedError('feed_too_large');
      scanner.push(chunk.value);
      for (const page of ready.splice(0)) await writer.flush(page);
    }
  } catch (error) {
    await reader.cancel().catch(ignoreRejection);
    throw error;
  }
  scanner.end();
  return writer.finish();
}

export const FEED_USER_AGENT = 'auction-domain-aggregator-ingestion/1';

// Downloads a zipped JSON feed and stages the `field` array of its single
// entry into page files.
export async function stageZippedFeed({
  url,
  entry,
  field,
  pageSize,
  maxArchiveBytes,
  maxDocumentBytes,
  limits,
  timeoutMs,
  sink,
  fetchImpl = fetch,
}: {
  url: string;
  entry: string;
  field: string;
  pageSize: number;
  maxArchiveBytes: number;
  maxDocumentBytes: number;
  limits?: FeedPageLimits;
  timeoutMs: number;
  sink: FeedPageSink;
  fetchImpl?: typeof fetch;
}): Promise<FeedPagesSummary> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      // GoDaddy's CDN answers 403 to a request without a User-Agent, which
      // is what a Worker's fetch sends by default.
      headers: { 'user-agent': FEED_USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new FeedError('feed_download_failed');
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(ignoreRejection);
    throw new FeedError('feed_download_failed');
  }
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isSafeInteger(declared) && declared > maxArchiveBytes) {
    await response.body.cancel().catch(ignoreRejection);
    throw new FeedError('feed_too_large');
  }
  const document = await openZipEntry(response.body, {
    entry,
    maxCompressedBytes: maxArchiveBytes,
  });
  return writeFeedPages({
    document,
    field,
    pageSize,
    maxBytes: maxDocumentBytes,
    limits,
    sink,
  });
}

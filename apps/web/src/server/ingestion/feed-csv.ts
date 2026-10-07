// Stages a provider inventory published as one CSV document (Namecheap's
// market sales, about 194 MB and 1.1 million rows) into numbered page files.
// The download is decoded and parsed as a stream:
//
//   fetch body -> TextDecoder -> CSV rows -> JSON records -> page writer -> sink
//
// Each data row becomes a JSON object of its non-empty fields keyed by the
// header row, so the pages share the zipped JSON feed's envelope and the
// provider adapter validates every value, a string, one record at a time.
import {
  createPageWriter,
  downloadFeed,
  FeedError,
  type FeedPageLimits,
  type FeedPageSink,
  type FeedPagesSummary,
  ignoreRejection,
  type RawElement
} from './feed-stage'

type CsvState = 'field-start' | 'unquoted' | 'quoted' | 'closed'

const SPECIAL = /[",\r\n]/g

// Splits RFC 4180 rows out of text delivered in arbitrary chunks: comma-
// separated fields, optionally double-quoted with `""` as an escaped quote,
// and LF or CRLF row endings. A carriage return outside quotes is dropped. A
// quote inside an unquoted field, text after a closing quote, or an
// unterminated quote fails the feed, and so does a row longer than
// `maxRowLength` characters, since a row is held until it ends. Empty lines
// are skipped.
export function createCsvRowScanner(
  onRow: (fields: string[]) => void,
  maxRowLength = Number.POSITIVE_INFINITY
) {
  let state: CsvState = 'field-start'
  let fields: string[] = []
  let field = ''
  let rowLength = 0

  const fail = (): never => {
    throw new FeedError('feed_parse_error')
  }
  const append = (value: string) => {
    rowLength += value.length
    if (rowLength > maxRowLength) throw new FeedError('feed_too_large')
    field += value
  }
  const endField = () => {
    fields.push(field)
    field = ''
    state = 'field-start'
  }
  const endRow = () => {
    endField()
    const row = fields
    fields = []
    rowLength = 0
    if (row.length > 1 || row[0] !== '') onRow(row)
  }

  return {
    push(text: string) {
      let index = 0
      while (index < text.length) {
        if (state === 'quoted') {
          const quote = text.indexOf('"', index)
          if (quote === -1) {
            append(text.slice(index))
            return
          }
          append(text.slice(index, quote))
          state = 'closed'
          index = quote + 1
          continue
        }
        if (text[index] === '"' && (state === 'field-start' || state === 'closed')) {
          // An opening quote, or the second quote of an escaped one.
          if (state === 'closed') append('"')
          state = 'quoted'
          index += 1
          continue
        }
        SPECIAL.lastIndex = index
        const match = SPECIAL.exec(text)
        const end = match ? match.index : text.length
        if (end > index) {
          if (state === 'closed') fail()
          append(text.slice(index, end))
          state = 'unquoted'
        }
        if (!match) return
        index = end + 1
        const special = text[end]
        if (special === '"') fail()
        else if (special === ',') endField()
        else if (special === '\n') endRow()
      }
    },
    end() {
      if (state === 'quoted') fail()
      if (fields.length > 0 || state !== 'field-start') endRow()
    }
  }
}

const encoder = new TextEncoder()

// Streams a CSV document with a header row into page files.
export async function writeCsvFeedPages({
  document,
  pageSize,
  maxBytes,
  limits = {},
  sink
}: {
  document: ReadableStream<Uint8Array>
  pageSize: number
  maxBytes: number
  limits?: FeedPageLimits
  sink: FeedPageSink
}): Promise<FeedPagesSummary> {
  const writer = createPageWriter(pageSize, sink, limits)
  const ready: RawElement[][] = []
  let header: string[] | null = null
  const scanner = createCsvRowScanner(fields => {
    if (!header) {
      if (fields.includes('') || new Set(fields).size !== fields.length) {
        throw new FeedError('feed_parse_error')
      }
      header = fields
      return
    }
    if (fields.length !== header.length) throw new FeedError('feed_parse_error')
    // No prototype, so a column named `__proto__` is an ordinary key.
    const record: Record<string, string> = Object.create(null)
    header.forEach((name, index) => {
      const value = fields[index]
      if (value) record[name] = value
    })
    const page = writer.add([encoder.encode(JSON.stringify(record))])
    if (page) ready.push(page)
    // A row that cannot fit in a page fails before it is held whole.
  }, limits.maxPageBytes)
  // Fatal, so invalid UTF-8 fails the feed instead of becoming U+FFFD.
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const decode = (chunk?: Uint8Array) => {
    try {
      return chunk ? decoder.decode(chunk, { stream: true }) : decoder.decode()
    } catch {
      throw new FeedError('feed_parse_error')
    }
  }

  const reader = document.getReader()
  let bytes = 0
  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await reader.read()
      } catch {
        throw new FeedError('feed_download_failed')
      }
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > maxBytes) throw new FeedError('feed_too_large')
      scanner.push(decode(chunk.value))
      for (const page of ready.splice(0)) await writer.flush(page)
    }
  } catch (error) {
    await reader.cancel().catch(ignoreRejection)
    throw error
  }
  scanner.push(decode())
  scanner.end()
  for (const page of ready.splice(0)) await writer.flush(page)
  return writer.finish()
}

// Downloads a CSV feed and stages its rows into page files.
export async function stageCsvFeed({
  url,
  pageSize,
  maxBytes,
  limits,
  timeoutMs,
  sink,
  fetchImpl
}: {
  url: string
  pageSize: number
  maxBytes: number
  limits?: FeedPageLimits
  timeoutMs: number
  sink: FeedPageSink
  fetchImpl?: typeof fetch
}): Promise<FeedPagesSummary> {
  const document = await downloadFeed({ url, maxBytes, timeoutMs, fetchImpl })
  return writeCsvFeedPages({ document, pageSize, maxBytes, limits, sink })
}

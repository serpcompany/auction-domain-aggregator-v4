import { z } from 'zod'

import { ResponseTooLargeError } from './normalize'
import type { FeedPageSource, NormalizedListing, ProviderPage } from './types'

// Reading back the page files the ingestion Workflow stages from a provider's
// file feed (`src/server/ingestion/feed-stage.ts`). Each adapter supplies its
// limits and maps the failure codes below to its own prefixed provider codes.

export type StagedPageErrorCode =
  | 'invalid_request'
  | 'page_read_error'
  | 'missing_page'
  | 'parse_error'
  | 'response_too_large'
  | 'response_error'

export type StagedPageLimits = {
  pageSize: number
  maxPages: number
  maxPageBytes: number
}

// A page where more than this share of records is invalid indicates a format
// change rather than a few bad records.
const MAX_REJECTED_RATIO = 0.1

// The page envelope written by the stage step. Records are validated one at
// a time so a single malformed listing is skipped, not the whole page.
function pageSchema(pageSize: number) {
  return z
    .object({
      page: z.number().int().positive(),
      isLastPage: z.boolean(),
      records: z.array(z.unknown()).max(pageSize)
    })
    .strict()
}

export async function readStagedPage(
  pages: FeedPageSource | undefined,
  pageIndex: number,
  limits: StagedPageLimits,
  fail: (code: StagedPageErrorCode) => Error
) {
  if (!pages || !Number.isSafeInteger(pageIndex) || pageIndex < 1 || pageIndex > limits.maxPages) {
    throw fail('invalid_request')
  }
  let text: string | null
  try {
    text = await pages.readPage(pageIndex, limits.maxPageBytes)
  } catch (error) {
    throw fail(error instanceof ResponseTooLargeError ? 'response_too_large' : 'page_read_error')
  }
  // The stage marks the final page explicitly, so a page that does not
  // exist is an error rather than the end of the feed.
  if (text === null) throw fail('missing_page')
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw fail('parse_error')
  }
  const parsed = pageSchema(limits.pageSize).safeParse(body)
  if (!parsed.success || parsed.data.page !== pageIndex) {
    throw fail('response_error')
  }
  return parsed.data
}

// Normalizes each record, counting one that `normalize` throws on as
// rejected, and fails the page when too many are.
export function normalizeStagedRecords(
  records: unknown[],
  normalize: (record: unknown) => NormalizedListing,
  fail: () => Error
): Omit<ProviderPage, 'isLastPage'> {
  const listings: NormalizedListing[] = []
  for (const record of records) {
    try {
      listings.push(normalize(record))
    } catch {
      // Counted as rejected below.
    }
  }
  const rejected = records.length - listings.length
  if (rejected > records.length * MAX_REJECTED_RATIO) throw fail()
  return { listings, received: records.length, rejected }
}

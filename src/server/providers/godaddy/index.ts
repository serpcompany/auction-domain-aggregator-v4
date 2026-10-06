import { z } from 'zod';

import {
  parseDomain,
  parseMoneyCents,
  ResponseTooLargeError,
} from '../normalize';
import {
  ProviderError,
  type FeedPageSource,
  type NormalizedListing,
  type NormalizedSeoMetrics,
  type ProviderAdapter,
  type ProviderPage,
} from '../types';

// GoDaddy publishes its auction inventory as one large zipped JSON file
// (`all_biddable_auctions.json.zip`, about 450 MB unzipped) instead of a paged
// API. The ingestion Workflow's stage step streams it into numbered page files
// of at most GODADDY_PAGE_SIZE raw records in R2
// (`src/server/ingestion/feed-stage.ts`). This adapter reads those pages, so
// validation, normalization, storage, and reconciliation follow the same path
// as API providers.
export const GODADDY_FEED_URL =
  'https://inventory.auctions.godaddy.com/all_biddable_auctions.json.zip';
export const GODADDY_FEED_ENTRY = 'all_biddable_auctions.json';
export const GODADDY_PAGE_SIZE = 1000;

const PAGE_BYTE_LIMIT = 10 * 1024 * 1024;
const MAX_PAGE_INDEX = 1000;
// A page where more than this share of records is invalid indicates a format
// change rather than a few bad records.
const MAX_REJECTED_RATIO = 0.1;

const money = z.union([z.string().max(64), z.number()]);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const score = z.number().int().min(0).max(100);

const godaddyRecordSchema = z
  .object({
    domainName: z.string().max(253),
    link: z.string().max(2048),
    auctionType: z.enum(['Bid', 'BuyNow']),
    auctionEndTime: z.string().max(64),
    price: money,
    numberOfBids: count.optional(),
    domainAge: count.nullish(),
    pageviews: count.nullish(),
    valuation: money.nullish(),
    majesticTf: score.nullish(),
    majesticCf: score.nullish(),
    majesticBacklinks: count.nullish(),
    majesticReferringDomains: count.nullish(),
    semrushAs: score.nullish(),
    semrushReferringDomains: count.nullish(),
    semrushBacklinks: count.nullish(),
  })
  .passthrough();

type GodaddyRecord = z.infer<typeof godaddyRecordSchema>;

// The page envelope written by the stage step. Records are validated one at
// a time so a single malformed listing is skipped, not the whole page.
const pageSchema = z
  .object({
    page: z.number().int().positive(),
    isLastPage: z.boolean(),
    records: z.array(z.unknown()).max(GODADDY_PAGE_SIZE),
  })
  .strict();

export type GodaddyProviderErrorCode =
  | 'godaddy_invalid_request'
  | 'godaddy_page_read_error'
  | 'godaddy_missing_page'
  | 'godaddy_parse_error'
  | 'godaddy_response_too_large'
  | 'godaddy_response_error';

export class GodaddyProviderError extends ProviderError {
  declare readonly code: GodaddyProviderErrorCode;

  constructor(code: GodaddyProviderErrorCode) {
    super(code);
    this.name = 'GodaddyProviderError';
  }
}

const AUCTION_TYPES: Record<GodaddyRecord['auctionType'], string> = {
  Bid: 'AUCTION',
  BuyNow: 'BUY_NOW',
};

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function parseEndTime(value: string) {
  const date = new Date(value);
  if (!ISO_UTC.test(value) || Number.isNaN(date.getTime())) {
    throw new Error('invalid_timestamp');
  }
  return date;
}

// The listing ID is the numeric suffix of the auction page path, for example
// `/domain-auctions/example-com-728418303`.
function parseAuctionLink(value: string) {
  const url = new URL(value);
  const match = /^\/domain-auctions\/[a-z0-9-]+-(\d{1,20})$/i.exec(
    url.pathname,
  );
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'www.godaddy.com' ||
    url.username !== '' ||
    url.password !== '' ||
    !match
  ) {
    throw new Error('invalid_link');
  }
  return { auctionUrl: url.toString(), externalId: match[1]! };
}

function nullableMoney(value: string | number | null | undefined) {
  return value === null || value === undefined ? null : parseMoneyCents(value);
}

function seoMetrics(record: GodaddyRecord): NormalizedSeoMetrics | undefined {
  const metrics = {
    majesticTf: record.majesticTf ?? null,
    majesticCf: record.majesticCf ?? null,
    majesticBacklinks: record.majesticBacklinks ?? null,
    majesticRefDomains: record.majesticReferringDomains ?? null,
    semrushAs: record.semrushAs ?? null,
    semrushRefDomains: record.semrushReferringDomains ?? null,
    semrushBacklinks: record.semrushBacklinks ?? null,
  };
  return Object.values(metrics).every((value) => value === null)
    ? undefined
    : metrics;
}

function normalizeRecord(record: GodaddyRecord): NormalizedListing {
  const { auctionUrl, externalId } = parseAuctionLink(record.link);
  // Buy-now listings take no bids; a bid auction must report its count.
  if (record.numberOfBids === undefined && record.auctionType === 'Bid') {
    throw new Error('missing_bid_count');
  }
  const metrics = seoMetrics(record);

  return {
    provider: 'godaddy',
    externalId,
    domainName: parseDomain(record.domainName),
    auctionUrl,
    auctionType: AUCTION_TYPES[record.auctionType],
    currency: 'USD',
    currentBidCents: parseMoneyCents(record.price),
    bidCount: record.numberOfBids ?? 0,
    // The feed has no bidder count.
    bidderCount: null,
    startsAt: null,
    endsAt: parseEndTime(record.auctionEndTime),
    ageYears: record.domainAge ?? null,
    inboundLinks: null,
    visitors: record.pageviews ?? null,
    appraisalCents: nullableMoney(record.valuation),
    renewalPriceCents: null,
    ...(metrics ? { seoMetrics: metrics } : {}),
  };
}

export function normalizeGodaddyRecords(
  records: unknown[],
): Omit<ProviderPage, 'isLastPage'> {
  const listings: NormalizedListing[] = [];
  for (const record of records) {
    const parsed = godaddyRecordSchema.safeParse(record);
    if (!parsed.success) continue;
    try {
      listings.push(normalizeRecord(parsed.data));
    } catch {
      // Counted as rejected below.
    }
  }
  const rejected = records.length - listings.length;
  if (rejected > records.length * MAX_REJECTED_RATIO) {
    throw new GodaddyProviderError('godaddy_response_error');
  }
  return { listings, received: records.length, rejected };
}

export function createGodaddyAdapter({
  pages,
}: {
  pages: FeedPageSource | undefined;
}): ProviderAdapter {
  return {
    provider: 'godaddy',
    async fetchPage({ pageIndex }) {
      if (
        !pages ||
        !Number.isSafeInteger(pageIndex) ||
        pageIndex < 1 ||
        pageIndex > MAX_PAGE_INDEX
      ) {
        throw new GodaddyProviderError('godaddy_invalid_request');
      }
      let text: string | null;
      try {
        text = await pages.readPage(pageIndex, PAGE_BYTE_LIMIT);
      } catch (error) {
        throw new GodaddyProviderError(
          error instanceof ResponseTooLargeError
            ? 'godaddy_response_too_large'
            : 'godaddy_page_read_error',
        );
      }
      // The stage marks the final page explicitly, so a page that does not
      // exist is an error rather than the end of the feed.
      if (text === null) throw new GodaddyProviderError('godaddy_missing_page');
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new GodaddyProviderError('godaddy_parse_error');
      }
      const parsed = pageSchema.safeParse(body);
      if (!parsed.success || parsed.data.page !== pageIndex) {
        throw new GodaddyProviderError('godaddy_response_error');
      }
      return {
        ...normalizeGodaddyRecords(parsed.data.records),
        isLastPage: parsed.data.isLastPage,
      };
    },
  };
}

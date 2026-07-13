import { z } from 'zod';

const stringOrNumber = (maximumLength: number) =>
  z.union([z.string().max(maximumLength), z.number()]);

const dynadotAuctionSchema = z
  .object({
    auction_id: stringOrNumber(256),
    domain: z.string().max(253),
    auction_type: stringOrNumber(32),
    currency: stringOrNumber(16),
    current_bid_price: stringOrNumber(64),
    bids: stringOrNumber(32),
    bidders: stringOrNumber(32),
    end_time_stamp: stringOrNumber(32),
    start_time_stamp: stringOrNumber(32).optional(),
    age: stringOrNumber(32).optional(),
    links: stringOrNumber(32).optional(),
    visitors: stringOrNumber(32).optional(),
    dyna_appraisal: stringOrNumber(64).optional(),
    renewal_price: stringOrNumber(64).optional(),
  })
  .passthrough();

const dynadotResponseSchema = z
  .object({
    status: z.literal('success'),
    auction_list: z.array(dynadotAuctionSchema).max(1000),
  })
  .passthrough();

export type DynadotListing = {
  provider: 'dynadot';
  externalId: string;
  domainName: string;
  auctionUrl: string;
  auctionType: string;
  currency: string;
  currentBidCents: number;
  bidCount: number;
  bidderCount: number;
  startsAt: Date | null;
  endsAt: Date;
  ageYears: number | null;
  inboundLinks: number | null;
  visitors: number | null;
  dynadotAppraisalCents: number | null;
  renewalPriceCents: number | null;
};

export type DynadotProviderErrorCode =
  | 'dynadot_invalid_request'
  | 'dynadot_network_error'
  | 'dynadot_http_error'
  | 'dynadot_parse_error'
  | 'dynadot_response_too_large'
  | 'dynadot_response_error';

export class DynadotProviderError extends Error {
  readonly code: DynadotProviderErrorCode;

  constructor(code: DynadotProviderErrorCode) {
    super(code);
    this.name = 'DynadotProviderError';
    this.code = code;
  }
}

type FetchDynadotPageInput = {
  apiKey: string;
  pageIndex: number;
  pageSize: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};

const RESPONSE_BYTE_LIMIT = 10 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;

async function readBoundedBody(response: Response) {
  const contentLength = response.headers.get('content-length');
  if (
    contentLength !== null &&
    Number.isSafeInteger(Number(contentLength)) &&
    Number(contentLength) > RESPONSE_BYTE_LIMIT
  ) {
    throw new DynadotProviderError('dynadot_response_too_large');
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let body = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) return body + decoder.decode();
    bytesRead += value.byteLength;
    if (bytesRead > RESPONSE_BYTE_LIMIT) {
      await reader.cancel();
      throw new DynadotProviderError('dynadot_response_too_large');
    }
    body += decoder.decode(value, { stream: true });
  }
}

const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function parseDomain(value: string) {
  const domain = value.trim().toLowerCase();
  const labels = domain.split('.');

  if (
    domain.length === 0 ||
    domain.length > 253 ||
    !domain.includes('.') ||
    domain.endsWith('.') ||
    labels.some((label) => !DOMAIN_LABEL.test(label))
  ) {
    throw new Error('invalid_domain');
  }

  return domain;
}

function parseRequiredString(value: string | number) {
  const parsed = String(value).trim();
  if (parsed.length === 0) throw new Error('invalid_string');
  return parsed;
}

function decimalParts(value: string | number) {
  const text = String(value).trim().replaceAll(',', '').replace(/^\$/, '');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new Error('invalid_decimal');

  return { whole: match[1], fraction: (match[2] ?? '').padEnd(2, '0') };
}

function parseMoneyCents(value: string | number) {
  const { whole, fraction } = decimalParts(value);
  const cents = Number(BigInt(whole) * 100n + BigInt(fraction));
  if (!Number.isSafeInteger(cents)) throw new Error('invalid_money');
  return cents;
}

function isNullableSentinel(value: string | number | undefined) {
  if (value === undefined) return true;
  const text = String(value).trim();
  if (text === '' || text === '-') return true;
  const number = Number(text.replaceAll(',', '').replace(/^\$/, ''));
  return Number.isFinite(number) && number < 0;
}

function parseNullableMoney(value: string | number | undefined) {
  return isNullableSentinel(value) ? null : parseMoneyCents(value!);
}

function parseNonnegativeInteger(value: string | number) {
  const parsed =
    typeof value === 'number' && Number.isSafeInteger(value)
      ? value
      : Number(String(value).trim());
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('invalid_integer');
  }
  return parsed;
}

function parseNullableInteger(value: string | number | undefined) {
  return isNullableSentinel(value) ? null : parseNonnegativeInteger(value!);
}

function parseTimestamp(value: string | number) {
  const milliseconds = parseNonnegativeInteger(value);
  if (milliseconds <= 0) throw new Error('invalid_timestamp');
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) throw new Error('invalid_timestamp');
  return date;
}

function parseNullableTimestamp(value: string | number | undefined) {
  return isNullableSentinel(value) ? null : parseTimestamp(value!);
}

function normalizeAuction(
  auction: z.infer<typeof dynadotAuctionSchema>,
): DynadotListing {
  const domainName = parseDomain(auction.domain);

  return {
    provider: 'dynadot',
    externalId: parseRequiredString(auction.auction_id),
    domainName,
    auctionUrl: `https://www.dynadot.com/market/auction/${encodeURIComponent(domainName)}`,
    auctionType: parseRequiredString(auction.auction_type).toUpperCase(),
    currency: parseRequiredString(auction.currency).toUpperCase(),
    currentBidCents: parseMoneyCents(auction.current_bid_price),
    bidCount: parseNonnegativeInteger(auction.bids),
    bidderCount: parseNonnegativeInteger(auction.bidders),
    startsAt: parseNullableTimestamp(auction.start_time_stamp),
    endsAt: parseTimestamp(auction.end_time_stamp),
    ageYears: parseNullableInteger(auction.age),
    inboundLinks: parseNullableInteger(auction.links),
    visitors: parseNullableInteger(auction.visitors),
    dynadotAppraisalCents: parseNullableMoney(auction.dyna_appraisal),
    renewalPriceCents: parseNullableMoney(auction.renewal_price),
  };
}

export async function fetchDynadotPage({
  apiKey,
  pageIndex,
  pageSize,
  fetchImpl = fetch,
  signal: suppliedSignal,
}: FetchDynadotPageInput): Promise<DynadotListing[]> {
  if (
    apiKey.length === 0 ||
    !Number.isSafeInteger(pageIndex) ||
    pageIndex < 1 ||
    pageIndex > 1000 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 1000
  ) {
    throw new DynadotProviderError('dynadot_invalid_request');
  }

  const url = new URL('https://api.dynadot.com/api3.json');
  url.search = new URLSearchParams({
    key: apiKey,
    command: 'get_open_auctions',
    currency: 'usd',
    type: 'expired',
    count_per_page: String(pageSize),
    page_index: String(pageIndex),
  }).toString();

  const timeoutController = new AbortController();
  const timeout = setTimeout(
    () => timeoutController.abort(),
    REQUEST_TIMEOUT_MS,
  );
  const signal = suppliedSignal
    ? AbortSignal.any([suppliedSignal, timeoutController.signal])
    : timeoutController.signal;
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, { signal });
    } catch {
      throw new DynadotProviderError('dynadot_network_error');
    }

    if (!response.ok) {
      throw new DynadotProviderError('dynadot_http_error');
    }

    let text: string;
    try {
      text = await readBoundedBody(response);
    } catch (error) {
      if (error instanceof DynadotProviderError) throw error;
      if (signal.aborted) {
        throw new DynadotProviderError('dynadot_network_error');
      }
      throw new DynadotProviderError('dynadot_parse_error');
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new DynadotProviderError('dynadot_parse_error');
    }

    try {
      const parsed = dynadotResponseSchema.parse(body);
      if (parsed.auction_list.length > pageSize) {
        throw new Error('page_size_exceeded');
      }
      return parsed.auction_list.map(normalizeAuction);
    } catch {
      throw new DynadotProviderError('dynadot_response_error');
    }
  } finally {
    clearTimeout(timeout);
  }
}

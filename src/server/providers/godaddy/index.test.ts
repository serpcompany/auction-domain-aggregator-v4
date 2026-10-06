import { describe, expect, it, vi } from 'vitest';

import { PROVIDER_REGISTRY } from '../registry';
import {
  createGodaddyAdapter,
  GodaddyProviderError,
  normalizeGodaddyRecords,
  parsePagesUrl,
} from './index';

// Invented record in the shape of GoDaddy's public inventory feed.
const record = {
  domainName: 'Example-Garden.ORG',
  link: 'https://www.godaddy.com/domain-auctions/example-garden-org-728418303?isc=json_biddable',
  auctionType: 'Bid',
  auctionEndTime: '2026-10-05T16:00:00Z',
  price: '$1,234',
  numberOfBids: 4,
  domainAge: 4,
  pageviews: 12,
  valuation: '$9,999',
  monthlyParkingRevenue: '$0',
  isAdult: false,
  majesticTf: 7,
  majesticCf: 12,
  majesticBacklinks: 300,
  majesticReferringDomains: 21,
  exactMatchTlds: 2,
  semrushAs: 3,
  semrushReferringDomains: 188,
  semrushBacklinks: 262,
  semrushTopReferringDomains: 'a.example, b.example',
  semrushCpc: 0.1,
};

const PAGES_URL = 'http://127.0.0.1:41234/';

function pageResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), init);
}

function adapterFor(responses: Response[] | ((url: URL) => Response)) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
    typeof responses === 'function'
      ? responses(new URL(String(input)))
      : responses.shift()!,
  );
  return {
    fetchImpl,
    adapter: createGodaddyAdapter({
      pagesUrl: PAGES_URL,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }),
  };
}

describe('GoDaddy record normalization', () => {
  it('normalizes a bid auction with its feed metrics', () => {
    const page = normalizeGodaddyRecords([record]);
    expect(page).toEqual({
      received: 1,
      rejected: 0,
      listings: [
        {
          provider: 'godaddy',
          externalId: '728418303',
          domainName: 'example-garden.org',
          auctionUrl:
            'https://www.godaddy.com/domain-auctions/example-garden-org-728418303?isc=json_biddable',
          auctionType: 'AUCTION',
          currency: 'USD',
          currentBidCents: 123_400,
          bidCount: 4,
          bidderCount: null,
          startsAt: null,
          endsAt: new Date('2026-10-05T16:00:00.000Z'),
          ageYears: 4,
          inboundLinks: null,
          visitors: 12,
          appraisalCents: 999_900,
          renewalPriceCents: null,
          seoMetrics: {
            majesticTf: 7,
            majesticCf: 12,
            majesticBacklinks: 300,
            majesticRefDomains: 21,
            semrushAs: 3,
            semrushRefDomains: 188,
            semrushBacklinks: 262,
          },
        },
      ],
    });
  });

  it('keeps buy-now listings and treats missing optional fields as unknown', () => {
    const [listing] = normalizeGodaddyRecords([
      {
        domainName: 'bücher.example',
        link: 'https://www.godaddy.com/domain-auctions/xn--bcher-kva-example-55',
        auctionType: 'BuyNow',
        auctionEndTime: '2026-10-05T16:00:00.250Z',
        price: 25,
        domainAge: null,
        majesticTf: 0,
      },
    ]).listings;
    expect(listing).toMatchObject({
      externalId: '55',
      domainName: 'xn--bcher-kva.example',
      auctionType: 'BUY_NOW',
      currentBidCents: 2500,
      bidCount: 0,
      ageYears: null,
      visitors: null,
      appraisalCents: null,
      seoMetrics: {
        majesticTf: 0,
        majesticCf: null,
        semrushAs: null,
      },
    });

    const [withoutMetrics] = normalizeGodaddyRecords([
      {
        domainName: 'plain.example',
        link: 'https://www.godaddy.com/domain-auctions/plain-example-56',
        auctionType: 'Bid',
        auctionEndTime: '2026-10-05T16:00:00Z',
        price: '$1',
        numberOfBids: 0,
      },
    ]).listings;
    expect(withoutMetrics).not.toHaveProperty('seoMetrics');
  });

  it('counts each invalid record as rejected', () => {
    const invalid = [
      { ...record, auctionType: 'Offer' },
      { ...record, numberOfBids: undefined },
      { ...record, link: 'not a url' },
      { ...record, link: 'http://www.godaddy.com/domain-auctions/a-com-1' },
      { ...record, link: 'https://evil.example/domain-auctions/a-com-1' },
      { ...record, link: 'https://u:p@www.godaddy.com/domain-auctions/a-1' },
      { ...record, link: 'https://www.godaddy.com/domain-auctions/no-id' },
      { ...record, auctionEndTime: '2026-10-05 16:00' },
      { ...record, auctionEndTime: '2026-13-45T16:00:00Z' },
      { ...record, price: 'free' },
      { ...record, majesticTf: 101 },
      { ...record, semrushBacklinks: -1 },
      { ...record, domainName: 'no-dot' },
      'not an object',
    ];
    const valid = Array.from({ length: 130 }, (_, index) => ({
      ...record,
      link: `https://www.godaddy.com/domain-auctions/example-${index + 1}`,
    }));
    const page = normalizeGodaddyRecords([...valid, ...invalid]);
    expect(page.received).toBe(valid.length + invalid.length);
    expect(page.rejected).toBe(invalid.length);
    expect(page.listings).toHaveLength(valid.length);
  });

  it('fails a page where more than a tenth of the records are invalid', () => {
    expect(() =>
      normalizeGodaddyRecords([record, record, { ...record, price: 'x' }]),
    ).toThrow(new GodaddyProviderError('godaddy_response_error'));
  });
});

describe('GoDaddy pages URL', () => {
  it('accepts only the runner loopback page server', () => {
    expect(parsePagesUrl(PAGES_URL)?.href).toBe(PAGES_URL);
    for (const value of [
      undefined,
      'not a url',
      'https://127.0.0.1:1/',
      'http://localhost:1/',
      'http://10.0.0.1:1/',
      'http://u:p@127.0.0.1:1/',
      'http://127.0.0.1:1/pages',
      'http://127.0.0.1:1/?x=1',
      'http://127.0.0.1:1/#x',
    ]) {
      expect(parsePagesUrl(value)).toBeNull();
    }
  });
});

describe('GoDaddy adapter', () => {
  it('reads numbered loopback pages and reports the marked last page', async () => {
    const { adapter, fetchImpl } = adapterFor((url) =>
      pageResponse({
        page: Number(/page-(\d+)/.exec(url.pathname)![1]),
        isLastPage: url.pathname === '/page-2.json',
        records: [record],
      }),
    );
    expect(adapter.provider).toBe('godaddy');
    await expect(adapter.fetchPage({ pageIndex: 1 })).resolves.toMatchObject({
      received: 1,
      rejected: 0,
      isLastPage: false,
    });
    await expect(adapter.fetchPage({ pageIndex: 2 })).resolves.toMatchObject({
      isLastPage: true,
    });
    expect(String(fetchImpl.mock.calls[1]![0])).toBe(
      'http://127.0.0.1:41234/page-2.json',
    );
  });

  it('is built by the registry from the runner-supplied page URL', async () => {
    const adapter = PROVIDER_REGISTRY.godaddy!.createAdapter({
      GODADDY_FEED_PAGES_URL: 'http://example.invalid/',
    });
    await expect(adapter.fetchPage({ pageIndex: 1 })).rejects.toThrow(
      new GodaddyProviderError('godaddy_invalid_request'),
    );
  });

  it('rejects invalid requests without fetching', async () => {
    const { adapter, fetchImpl } = adapterFor([]);
    for (const pageIndex of [0, 1001, 1.5]) {
      await expect(adapter.fetchPage({ pageIndex })).rejects.toThrow(
        new GodaddyProviderError('godaddy_invalid_request'),
      );
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps transport and envelope failures to fixed codes', async () => {
    const cases: [Response | Error, string][] = [
      [new Error('connection refused'), 'godaddy_network_error'],
      [new Response(null, { status: 404 }), 'godaddy_http_error'],
      [
        new Response('x', { headers: { 'content-length': '99999999' } }),
        'godaddy_response_too_large',
      ],
      [new Response('{'), 'godaddy_parse_error'],
      [new Response(null), 'godaddy_parse_error'],
      [
        pageResponse({ page: 2, isLastPage: true, records: [] }),
        'godaddy_response_error',
      ],
      [
        pageResponse({ page: 1, isLastPage: true, records: [], extra: 1 }),
        'godaddy_response_error',
      ],
      [
        pageResponse({
          page: 1,
          isLastPage: true,
          records: Array.from({ length: 1001 }, () => record),
        }),
        'godaddy_response_error',
      ],
    ];
    for (const [outcome, code] of cases) {
      const adapter = createGodaddyAdapter({
        pagesUrl: PAGES_URL,
        fetchImpl: (async () => {
          if (outcome instanceof Error) throw outcome;
          return outcome;
        }) as unknown as typeof fetch,
      });
      await expect(adapter.fetchPage({ pageIndex: 1 })).rejects.toThrow(
        new GodaddyProviderError(code as never),
      );
    }
  });

  it('times out a page request that never answers', async () => {
    vi.useFakeTimers();
    try {
      const adapter = createGodaddyAdapter({
        pagesUrl: PAGES_URL,
        fetchImpl: ((_input: URL, init?: RequestInit) =>
          new Promise((_resolve, reject) =>
            init?.signal?.addEventListener('abort', () =>
              reject(new Error('aborted')),
            ),
          )) as unknown as typeof fetch,
      });
      const pending = adapter.fetchPage({ pageIndex: 1 });
      const assertion = expect(pending).rejects.toThrow(
        new GodaddyProviderError('godaddy_network_error'),
      );
      await vi.advanceTimersByTimeAsync(30_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('maps an interrupted body read to a network error', async () => {
    const body = new ReadableStream({
      pull(controller) {
        controller.error(new Error('reset'));
      },
    });
    const adapter = createGodaddyAdapter({
      pagesUrl: PAGES_URL,
      fetchImpl: (async () => new Response(body)) as unknown as typeof fetch,
    });
    await expect(adapter.fetchPage({ pageIndex: 1 })).rejects.toThrow(
      new GodaddyProviderError('godaddy_network_error'),
    );
  });
});

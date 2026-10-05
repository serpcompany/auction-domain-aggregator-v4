import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DomainDiscovery } from '@/components/domain-discovery';
import { DomainResultsTable } from '@/components/domain-results-table';
import { parseDomainTableFilters } from '@/domain/domain-table';
import type { DomainListingsResult } from '@/server/queries/domain-listings';

const now = new Date('2026-07-13T10:00:00.000Z');

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(cleanup);
beforeAll(() => {
  // DR enrichment requests from the results table; covered separately.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ status: 'ok', stored: 0 })),
  );
  Object.defineProperty(window, 'PointerEvent', {
    configurable: true,
    value: MouseEvent,
  });
});

const rows: DomainListingsResult['rows'] = [
  {
    provider: 'dynadot',
    externalId: 'auction-1',
    domainName: 'garden-example.com',
    auctionUrl: 'https://www.dynadot.com/market/auction/garden-example.com',
    auctionType: 'expired',
    currency: 'USD',
    currentBidCents: 1250,
    bidCount: 3,
    bidderCount: 2,
    startsAt: null,
    endsAt: new Date('2026-07-14T12:00:00.000Z'),
    ageYears: 12,
    inboundLinks: 50,
    visitors: 20,
    appraisalCents: 2000,
    renewalPriceCents: 1200,
    domainLength: 18,
    tld: 'com',
    hasHyphen: true,
    hasDigit: false,
    domainRating: 42.4,
    domainRatingFetched: true,
  },
  {
    provider: 'other-provider',
    externalId: 'auction-2',
    domainName: 'fresh-example.net',
    auctionUrl: 'https://example.com/auction-2',
    auctionType: 'closeout',
    currency: 'USD',
    currentBidCents: 999,
    bidCount: 0,
    bidderCount: 0,
    startsAt: null,
    endsAt: new Date('2026-07-15T12:00:00.000Z'),
    ageYears: null,
    inboundLinks: null,
    visitors: null,
    appraisalCents: null,
    renewalPriceCents: null,
    domainLength: 17,
    tld: 'net',
    hasHyphen: true,
    hasDigit: false,
    domainRating: null,
    domainRatingFetched: false,
  },
];

describe('DomainDiscovery', () => {
  it('renders real table semantics, controls, external links, and next navigation', () => {
    const filters = parseDomainTableFilters({
      q: 'garden',
      source: 'dynadot',
      sort: 'endsAt',
      direction: 'asc',
    });
    render(
      <DomainDiscovery
        filters={filters}
        result={{
          rows,
          total: 51,
          page: 1,
          sources: ['dynadot', 'other-provider'],
          auctionTypes: ['expired'],
          tlds: ['com', 'net'],
          latestSuccessfulSync: new Date('2026-07-13T09:58:00.000Z'),
        }}
        now={now}
      />,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Domain discovery' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Domain contains')).toHaveValue('garden');
    expect(
      screen.getByRole('button', { name: 'Auction source: Dynadot' }),
    ).toBeInTheDocument();
    expect(
      [...document.querySelectorAll('input[name="source"]')].map(
        (input) => (input as HTMLInputElement).value,
      ),
    ).toEqual(['dynadot']);
    expect(
      screen.getByRole('button', { name: 'Apply filters' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Clear all' })).toHaveAttribute(
      'href',
      '/',
    );
    expect(
      screen.getByRole('link', { name: 'Remove Search: garden filter' }),
    ).toHaveAttribute(
      'href',
      '/?source=dynadot&sort=endsAt&direction=asc&page=1',
    );
    expect(screen.getByLabelText('Data freshness')).toHaveTextContent(
      'Synced 2 minutes ago',
    );
    expect(
      screen.queryByText(/inventory is out of date/i),
    ).not.toBeInTheDocument();

    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getAllByRole('columnheader')).toHaveLength(9);
    for (const heading of [
      'Domain',
      'Auction',
      'Price',
      'Interest',
      'Ends',
      'Age',
      'Links',
      'Appraisal',
    ]) {
      expect(
        within(table).getByRole('columnheader', { name: heading }),
      ).toBeInTheDocument();
    }
    expect(
      within(table).getByRole('columnheader', { name: /Ends/ }),
    ).toHaveAttribute('aria-sort', 'ascending');
    expect(
      within(table).getByRole('link', {
        name: 'garden-example.com (opens auction in a new tab)',
      }),
    ).toHaveAttribute('rel', 'noopener noreferrer');
    expect(
      within(table).getByRole('link', {
        name: 'garden-example.com (opens auction in a new tab)',
      }),
    ).toHaveAttribute('target', '_blank');
    expect(within(table).getByText('Dynadot')).toBeInTheDocument();
    expect(within(table).getByText('Other Provider')).toBeInTheDocument();
    expect(within(table).getByText('12 years')).toBeInTheDocument();
    expect(within(table).getByText('.com')).toBeInTheDocument();
    expect(within(table).getByText('18 characters')).toBeInTheDocument();
    expect(within(table).getAllByText('hyphen')).toHaveLength(2);
    expect(within(table).getByText('$12.50')).toBeInTheDocument();
    expect(within(table).getByText('$12 renewal')).toBeInTheDocument();
    expect(within(table).getByText('3 bids')).toBeInTheDocument();
    expect(within(table).getByText('2 bidders')).toBeInTheDocument();
    expect(within(table).getByLabelText('20 visitors')).toHaveTextContent(
      '20 visitors',
    );
    expect(within(table).getByText('1d 2h')).toBeInTheDocument();
    expect(within(table).getByText('Jul 14, 12:00 UTC')).toBeInTheDocument();
    const endTime = within(table).getByText('1d 2h').closest('time');
    expect(endTime).toHaveAttribute('datetime', '2026-07-14T12:00:00.000Z');
    expect(endTime?.querySelector('div')).toBeNull();
    expect(within(table).getByLabelText('50 inbound links')).toHaveTextContent(
      '50',
    );
    expect(within(table).getByText('Dynadot appraisal')).toBeInTheDocument();
    expect(
      within(table).getByLabelText('Domain age not collected'),
    ).toHaveTextContent('—');
    // A stored DR renders rounded; an unrequested one is "not collected".
    const drHeader = within(table).getByRole('columnheader', { name: /^DR/ });
    const attribution = within(drHeader).getByRole('link', {
      name: 'Domain Rating by Ahrefs',
    });
    expect(attribution).toHaveAttribute('href', 'https://ahrefs.com/');
    expect(attribution).toHaveAttribute('target', '_blank');
    expect(
      within(table).getByTitle('Domain Rating by Ahrefs'),
    ).toHaveTextContent('42');
    expect(
      within(table).getAllByLabelText('Ahrefs Domain Rating not collected'),
    ).toHaveLength(1);
    for (const [heading, sort] of [
      ['Domain', 'domain'],
      ['Auction', 'source'],
      ['Price', 'price'],
      ['Interest', 'bids'],
      ['Ends', 'endsAt'],
      ['Age', 'age'],
      ['Links', 'links'],
      ['Appraisal', 'appraisal'],
    ]) {
      const sortLink = within(table).getByRole('link', { name: heading });
      const url = new URL(
        sortLink.getAttribute('href')!,
        'https://example.test',
      );
      expect(url.searchParams.get('q')).toBe('garden');
      expect(url.searchParams.getAll('source')).toEqual(['dynadot']);
      expect(url.searchParams.get('sort')).toBe(sort);
      expect(url.searchParams.get('direction')).toBe(
        sort === 'endsAt' ? 'desc' : 'asc',
      );
      expect(url.searchParams.get('page')).toBe('1');
    }

    expect(screen.getByText('Showing 1–50 of 51')).toBeInTheDocument();
    expect(screen.getByText('Previous')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('link', { name: 'Next' })).toHaveAttribute(
      'href',
      '/?q=garden&source=dynadot&sort=endsAt&direction=asc&page=2',
    );
  });

  it('renders previous navigation, a descending sort, and singular count', () => {
    const filters = parseDomainTableFilters({
      sort: 'domain',
      direction: 'desc',
      page: '2',
    });
    render(
      <DomainDiscovery
        filters={filters}
        result={{
          rows: rows.slice(0, 1),
          total: 1,
          page: 1,
          sources: [],
          auctionTypes: [],
          tlds: [],
          latestSuccessfulSync: null,
        }}
        now={now}
      />,
    );

    expect(
      screen.getByRole('region', { name: '1 active listing' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Data freshness')).toHaveTextContent(
      'No successful sync yet',
    );
    expect(
      screen.getByRole('columnheader', { name: 'Domain' }),
    ).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getByText('Previous')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByText('Next')).toHaveAttribute('aria-disabled', 'true');
  });

  it('warns when the inventory is stale', () => {
    render(
      <DomainDiscovery
        filters={parseDomainTableFilters({})}
        result={{
          rows: rows.slice(0, 1),
          total: 1,
          page: 1,
          sources: [],
          auctionTypes: [],
          tlds: [],
          latestSuccessfulSync: new Date(now.getTime() - 2 * 86_400_000),
        }}
        now={now}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      /inventory is out of date/i,
    );
    expect(screen.getByLabelText('Data freshness')).toHaveTextContent(
      'Synced 2 days ago',
    );
  });

  it('opens every outbound link in a new tab', () => {
    const { container } = render(
      <DomainDiscovery
        filters={parseDomainTableFilters({})}
        result={{
          rows,
          total: rows.length,
          page: 1,
          sources: ['dynadot'],
          auctionTypes: ['expired'],
          tlds: ['com', 'net'],
          latestSuccessfulSync: now,
        }}
        now={now}
      />,
    );

    const outbound = [
      ...container.querySelectorAll<HTMLAnchorElement>('a[href]'),
    ].filter((link) => /^https?:\/\//.test(link.getAttribute('href')!));
    expect(outbound.length).toBeGreaterThan(0);
    for (const link of outbound) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link.getAttribute('rel')).toContain('noopener');
    }
  });

  it('distinguishes a domain Ahrefs has no rating for from one not fetched yet', () => {
    render(
      <DomainResultsTable
        rows={[{ ...rows[1]!, domainRating: null, domainRatingFetched: true }]}
        filters={parseDomainTableFilters({})}
        now={now}
      />,
    );

    const table = screen.getByRole('table');
    expect(
      within(table).getByText('No Ahrefs Domain Rating'),
    ).toBeInTheDocument();
    expect(
      within(table).queryByLabelText('Ahrefs Domain Rating not collected'),
    ).not.toBeInTheDocument();
  });

  it('renders a useful empty state and zero range', async () => {
    render(
      <DomainDiscovery
        filters={parseDomainTableFilters({})}
        result={{
          rows: [],
          total: 0,
          page: 1,
          sources: ['dynadot'],
          auctionTypes: ['expired'],
          tlds: ['com'],
          latestSuccessfulSync: now,
        }}
        now={now}
      />,
    );

    expect(
      screen.getByRole('heading', { level: 2, name: 'No domains found' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: '0 active listings' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Showing 0–0 of 0')).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Clear all' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More filters' }));
    expect(
      await screen.findByRole('dialog', { name: 'More filters' }),
    ).toBeInTheDocument();
  });

  it('offers one clear path when any filter produces an empty result', () => {
    render(
      <DomainDiscovery
        filters={parseDomainTableFilters({ biddersMin: '2' })}
        result={{
          rows: [],
          total: 0,
          page: 1,
          sources: ['dynadot'],
          auctionTypes: ['expired'],
          tlds: ['com'],
          latestSuccessfulSync: now,
        }}
        now={now}
      />,
    );

    expect(
      screen.getByText(/No listings match all applied filters\./),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Clear all filters' }),
    ).toHaveAttribute('href', '/');
  });

  it('renders deterministic urgency text and every derived domain marker', () => {
    const endingRows: DomainListingsResult['rows'] = [
      {
        ...rows[0],
        externalId: 'critical',
        domainName: 'domain1.com',
        domainLength: 11,
        hasHyphen: false,
        hasDigit: true,
        bidCount: 1,
        bidderCount: 1,
        endsAt: new Date('2026-07-13T10:48:00.000Z'),
      },
      {
        ...rows[0],
        externalId: 'warning',
        domainName: 'warning.com',
        hasHyphen: false,
        endsAt: new Date('2026-07-13T12:14:00.000Z'),
      },
      {
        ...rows[0],
        externalId: 'ended',
        domainName: 'ended.com',
        hasHyphen: false,
        endsAt: new Date('2026-07-13T09:48:00.000Z'),
      },
    ];
    render(
      <DomainResultsTable
        rows={endingRows}
        filters={parseDomainTableFilters({ sort: 'price', direction: 'asc' })}
        now={now}
      />,
    );

    const resultsRegion = screen.getByRole('region', {
      name: 'Domain results',
    });
    expect(resultsRegion).toHaveAttribute('tabindex', '0');
    expect(resultsRegion).toHaveClass('focus-visible:ring-2');

    expect(screen.getByText('48m')).toHaveClass('text-red-700');
    expect(screen.getByText('2h 14m')).toHaveClass('text-amber-700');
    expect(screen.getByText('Ended 12m ago')).toHaveClass('text-red-700');
    expect(screen.getByText('digits')).toBeInTheDocument();
    expect(screen.getByText('1 bid')).toBeInTheDocument();
    expect(screen.getByText('1 bidder')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Price' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  });

  it('keeps an unbroken maximum-length query chip inside its container', () => {
    const query = 'x'.repeat(253);
    render(
      <DomainDiscovery
        filters={parseDomainTableFilters({ q: query })}
        result={{
          rows,
          total: 2,
          page: 1,
          sources: ['dynadot'],
          auctionTypes: ['expired'],
          tlds: ['com'],
          latestSuccessfulSync: now,
        }}
        now={now}
      />,
    );

    const chip = screen.getByRole('link', {
      name: `Remove Search: ${query} filter`,
    });
    expect(chip).toHaveClass('max-w-full', 'min-w-0');
    expect(chip).toHaveAttribute('title', `Search: ${query}`);
    expect(chip.querySelector('span')).toHaveClass('min-w-0', 'truncate');
    expect(chip.querySelector('svg')).toHaveClass('shrink-0');
  });

  it('renders the clamped page returned by the query', () => {
    render(
      <DomainDiscovery
        filters={parseDomainTableFilters({ page: '100000' })}
        result={{
          rows: rows.slice(0, 1),
          total: 51,
          page: 2,
          sources: ['dynadot'],
          auctionTypes: ['expired'],
          tlds: ['com'],
          latestSuccessfulSync: now,
        }}
        now={now}
      />,
    );

    expect(screen.getByText('Showing 51–51 of 51')).toBeInTheDocument();
    expect(screen.getByText('Page 2')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Previous' })).toHaveAttribute(
      'href',
      '/?sort=endsAt&direction=asc&page=1',
    );
  });

  it('renders repeated quick selections and accessible grouped advanced filters', async () => {
    const filters = parseDomainTableFilters({
      source: ['dynadot', 'godaddy'],
      tld: ['com', 'org'],
      type: ['expired'],
      domainLengthMin: '8',
      domainLengthMax: '15',
      ageMin: '3',
      ageMax: '20',
      noHyphens: '1',
      noDigits: '1',
      priceMin: '10.25',
      priceMax: '500',
      renewalMax: '18.50',
      endingWithin: '24h',
      bidsMin: '5',
      biddersMin: '2',
      visitorsMin: '10',
      linksMin: '20',
      appraisalMin: '1000',
    });
    render(
      <DomainDiscovery
        filters={filters}
        result={{
          rows,
          total: 2,
          page: 1,
          sources: ['dynadot', 'godaddy'],
          auctionTypes: ['expired', 'closeout'],
          tlds: ['com', 'net', 'org'],
          latestSuccessfulSync: now,
        }}
        now={now}
      />,
    );

    const form = screen.getByRole('form', {
      name: 'Domain filters',
    }) as HTMLFormElement;
    expect(
      [...form.querySelectorAll('input[name="source"]')].map(
        (input) => (input as HTMLInputElement).value,
      ),
    ).toEqual(['dynadot', 'godaddy']);
    expect(
      [...form.querySelectorAll('input[name="tld"]')].map(
        (input) => (input as HTMLInputElement).value,
      ),
    ).toEqual(['com', 'org']);
    expect(form.querySelector('input[name="priceMin"]')).toHaveValue('10.25');
    expect(form.querySelector('input[name="renewalMax"]')).toHaveValue('18.50');
    expect(screen.getByLabelText('Max current bid')).toHaveValue(500);
    expect(screen.getByLabelText('Ending')).toHaveValue('24h');
    fireEvent.change(screen.getByLabelText('Max current bid'), {
      target: { value: '450' },
    });
    fireEvent.change(screen.getByLabelText('Ending'), {
      target: { value: '6h' },
    });
    expect(screen.getByLabelText('Max current bid')).toHaveValue(450);
    expect(screen.getByLabelText('Ending')).toHaveValue('6h');
    expect(screen.getByText('TLD: .com, .org')).toBeInTheDocument();

    const more = screen.getByRole('button', { name: /More filters 12/ });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);

    const dialog = await screen.findByRole('dialog', {
      name: 'More filters',
    });
    expect(more).toHaveAttribute('aria-expanded', 'true');
    for (const group of ['Domain', 'Auction', 'Activity', 'Value']) {
      expect(
        within(dialog).getByRole('group', { name: group }),
      ).toBeInTheDocument();
    }
    expect(within(dialog).getByLabelText('Minimum length')).toHaveValue(8);
    expect(within(dialog).getByLabelText('Maximum current bid')).toHaveValue(
      450,
    );
    expect(within(dialog).getByLabelText('Ending window')).toHaveValue('6h');
    fireEvent.change(within(dialog).getByLabelText('Maximum current bid'), {
      target: { value: '425' },
    });
    fireEvent.change(within(dialog).getByLabelText('Ending window'), {
      target: { value: '3d' },
    });
    expect(screen.getByLabelText('Max current bid')).toHaveValue(425);
    expect(screen.getByLabelText('Ending')).toHaveValue('3d');
    expect(
      within(dialog).getByRole('button', {
        name: 'Auction type: Expired',
      }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('checkbox', { name: 'No digits' }),
    ).toBeChecked();
    fireEvent.change(within(dialog).getByLabelText('Minimum bids'), {
      target: { value: '7' },
    });
    fireEvent.click(
      within(dialog).getByRole('checkbox', { name: 'No digits' }),
    );
    fireEvent.click(
      within(dialog).getByRole('button', {
        name: 'Auction type: Expired',
      }),
    );
    const auctionTypeDialog = await screen.findByRole('dialog', {
      name: 'Auction type',
    });
    fireEvent.click(
      within(auctionTypeDialog).getByRole('checkbox', { name: 'Closeout' }),
    );

    const portalSubmission = new FormData(form);
    expect(portalSubmission.getAll('bidsMin')).toEqual(['7']);
    expect(portalSubmission.getAll('noDigits')).toEqual([]);
    expect(portalSubmission.getAll('noHyphens')).toEqual(['1']);
    expect(portalSubmission.getAll('type')).toEqual(['expired', 'closeout']);
    expect(portalSubmission.getAll('priceMin')).toEqual(['10.25']);
    expect(portalSubmission.getAll('renewalMax')).toEqual(['18.50']);
    fireEvent.keyDown(auctionTypeDialog, { key: 'Escape' });
    expect(
      within(dialog).getByRole('button', { name: 'Dismiss' }),
    ).toBeInTheDocument();
  });

  it.each([
    {
      label: 'domain length',
      minimumLabel: 'Minimum length',
      maximumLabel: 'Maximum length',
    },
    {
      label: 'domain age',
      minimumLabel: 'Minimum age',
      maximumLabel: 'Maximum age',
    },
    {
      label: 'current bid',
      minimumLabel: 'Minimum current bid',
      maximumLabel: 'Maximum current bid',
    },
  ])(
    'announces and focuses a reversed $label range, then accepts its correction',
    async ({ label, minimumLabel, maximumLabel }) => {
      render(
        <DomainDiscovery
          filters={parseDomainTableFilters({})}
          result={{
            rows,
            total: 2,
            page: 1,
            sources: ['dynadot'],
            auctionTypes: ['expired'],
            tlds: ['com'],
            latestSuccessfulSync: now,
          }}
          now={now}
        />,
      );
      const form = screen.getByRole('form', {
        name: 'Domain filters',
      }) as HTMLFormElement;
      fireEvent.click(screen.getByRole('button', { name: 'More filters' }));
      const dialog = await screen.findByRole('dialog', {
        name: 'More filters',
      });
      const minimum = within(dialog).getByLabelText(minimumLabel);
      const maximum = within(dialog).getByLabelText(maximumLabel);

      fireEvent.change(minimum, { target: { value: '20' } });
      fireEvent.change(maximum, { target: { value: '10' } });
      expect(fireEvent.submit(form)).toBe(false);
      expect(screen.getByRole('alert')).toHaveTextContent(
        `Minimum ${label} cannot exceed maximum ${label}. Lower the minimum or raise the maximum.`,
      );
      expect(minimum).toHaveAttribute('aria-invalid', 'true');
      expect(minimum).toHaveFocus();

      fireEvent.change(maximum, { target: { value: '30' } });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(minimum).not.toHaveAttribute('aria-invalid');
      expect(fireEvent.submit(form)).toBe(true);
      const corrected = new FormData(form);
      expect(corrected.get((minimum as HTMLInputElement).name)).toBe('20');
      if ((maximum as HTMLInputElement).name) {
        expect(corrected.get((maximum as HTMLInputElement).name)).toBe('30');
      } else {
        expect(corrected.get('priceMax')).toBe('30');
      }
    },
  );

  it('validates a preserved minimum price from the closed advanced sheet', () => {
    render(
      <DomainDiscovery
        filters={parseDomainTableFilters({ priceMin: '100', priceMax: '500' })}
        result={{
          rows,
          total: 2,
          page: 1,
          sources: ['dynadot'],
          auctionTypes: ['expired'],
          tlds: ['com'],
          latestSuccessfulSync: now,
        }}
        now={now}
      />,
    );
    const form = screen.getByRole('form', {
      name: 'Domain filters',
    }) as HTMLFormElement;
    const maximum = screen.getByLabelText('Max current bid');
    fireEvent.change(maximum, { target: { value: '50' } });

    expect(fireEvent.submit(form)).toBe(false);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Minimum current bid cannot exceed maximum current bid.',
    );
    expect(maximum).toHaveAttribute('aria-invalid', 'true');
    expect(maximum).toHaveFocus();
  });

  it('uses only the visible maximum-price control for form validity while the sheet is open', async () => {
    render(
      <DomainDiscovery
        filters={parseDomainTableFilters({ priceMax: '500' })}
        result={{
          rows,
          total: 2,
          page: 1,
          sources: ['dynadot'],
          auctionTypes: ['expired'],
          tlds: ['com'],
          latestSuccessfulSync: now,
        }}
        now={now}
      />,
    );
    const form = screen.getByRole('form', {
      name: 'Domain filters',
    }) as HTMLFormElement;
    const quickMaximum = screen.getByLabelText('Max current bid');
    expect(quickMaximum).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'More filters' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'More filters',
    });
    const advancedMaximum = within(dialog).getByLabelText(
      'Maximum current bid',
    ) as HTMLInputElement;
    expect(quickMaximum).toBeDisabled();
    expect(advancedMaximum).toBeEnabled();
    expect(advancedMaximum).toHaveAttribute('form', 'domain-filters');
    expect(advancedMaximum).toHaveAttribute('name', 'priceMax');

    fireEvent.change(advancedMaximum, {
      target: { value: '10000000000000' },
    });
    expect(new FormData(form).getAll('priceMax')).toEqual(['10000000000000']);
    const advancedInvalid = vi.fn();
    const quickInvalid = vi.fn();
    advancedMaximum.addEventListener('invalid', advancedInvalid);
    quickMaximum.addEventListener('invalid', quickInvalid);
    expect(advancedMaximum.validity.rangeOverflow).toBe(true);
    expect(form.checkValidity()).toBe(false);
    expect(advancedInvalid).toHaveBeenCalled();
    expect(quickInvalid).not.toHaveBeenCalled();
    advancedMaximum.focus();
    expect(advancedMaximum).toHaveFocus();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'More filters' }),
      ).not.toBeInTheDocument(),
    );
    expect(quickMaximum).toBeEnabled();
    expect(quickMaximum).toHaveValue(500);
    expect(document.getElementById('advanced-price-max')).toBeNull();
    expect(new FormData(form).getAll('priceMax')).toEqual(['500']);
    expect(form.checkValidity()).toBe(true);
  });

  it('discards every advanced-sheet draft on Dismiss and Escape', async () => {
    render(
      <DomainDiscovery
        filters={parseDomainTableFilters({
          type: 'expired',
          priceMin: '10',
          priceMax: '500',
          endingWithin: '24h',
          bidsMin: '2',
          noDigits: '1',
        })}
        result={{
          rows,
          total: 2,
          page: 1,
          sources: ['dynadot'],
          auctionTypes: ['expired', 'closeout'],
          tlds: ['com'],
          latestSuccessfulSync: now,
        }}
        now={now}
      />,
    );

    const open = async () => {
      fireEvent.click(screen.getByRole('button', { name: /More filters/ }));
      return screen.findByRole('dialog', { name: 'More filters' });
    };
    const editEveryKind = async (dialog: HTMLElement) => {
      fireEvent.change(within(dialog).getByLabelText('Maximum current bid'), {
        target: { value: '75' },
      });
      fireEvent.change(within(dialog).getByLabelText('Ending window'), {
        target: { value: '3d' },
      });
      fireEvent.change(within(dialog).getByLabelText('Minimum current bid'), {
        target: { value: '20' },
      });
      fireEvent.change(within(dialog).getByLabelText('Minimum bids'), {
        target: { value: '8' },
      });
      fireEvent.click(
        within(dialog).getByRole('checkbox', { name: 'No digits' }),
      );
      fireEvent.click(
        within(dialog).getByRole('button', {
          name: 'Auction type: Expired',
        }),
      );
      const typeDialog = await screen.findByRole('dialog', {
        name: 'Auction type',
      });
      fireEvent.click(
        within(typeDialog).getByRole('checkbox', { name: 'Expired' }),
      );
      fireEvent.keyDown(typeDialog, { key: 'Escape' });
    };
    const expectBaseline = (dialog: HTMLElement) => {
      expect(within(dialog).getByLabelText('Maximum current bid')).toHaveValue(
        500,
      );
      expect(within(dialog).getByLabelText('Ending window')).toHaveValue('24h');
      expect(within(dialog).getByLabelText('Minimum current bid')).toHaveValue(
        10,
      );
      expect(within(dialog).getByLabelText('Minimum bids')).toHaveValue(2);
      expect(
        within(dialog).getByRole('checkbox', { name: 'No digits' }),
      ).toBeChecked();
      expect(
        within(dialog).getByRole('button', {
          name: 'Auction type: Expired',
        }),
      ).toBeInTheDocument();
    };

    let dialog = await open();
    await editEveryKind(dialog);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByLabelText('Max current bid')).toHaveValue(500);
    expect(screen.getByLabelText('Ending')).toHaveValue('24h');
    dialog = await open();
    expectBaseline(dialog);

    await editEveryKind(dialog);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByLabelText('Max current bid')).toHaveValue(500);
    expect(screen.getByLabelText('Ending')).toHaveValue('24h');
    dialog = await open();
    expectBaseline(dialog);
  });

  it('remounts URL-derived controls after client navigation without restoring stale filters', async () => {
    const initialFilters = parseDomainTableFilters({
      q: 'garden',
      source: 'dynadot',
      tld: 'com',
      priceMax: '500',
      endingWithin: '24h',
      noDigits: '1',
      bidsMin: '5',
    });
    const result: DomainListingsResult = {
      rows,
      total: 2,
      page: 1,
      sources: ['dynadot', 'godaddy'],
      auctionTypes: ['expired', 'closeout'],
      tlds: ['com', 'net'],
      latestSuccessfulSync: now,
    };
    const view = render(
      <DomainDiscovery filters={initialFilters} result={result} now={now} />,
    );

    fireEvent.change(screen.getByLabelText('Max current bid'), {
      target: { value: '999' },
    });
    fireEvent.change(screen.getByLabelText('Ending'), {
      target: { value: '7d' },
    });
    fireEvent.click(screen.getByRole('button', { name: /More filters 2/ }));
    expect(
      await screen.findByRole('dialog', { name: 'More filters' }),
    ).toBeInTheDocument();

    const navigatedFilters = parseDomainTableFilters({
      source: 'godaddy',
      tld: 'net',
      priceMax: '25',
      endingWithin: '1h',
      bidsMin: '2',
      sort: 'price',
      direction: 'desc',
    });
    view.rerender(
      <DomainDiscovery filters={navigatedFilters} result={result} now={now} />,
    );

    expect(
      screen.queryByRole('dialog', { name: 'More filters' }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Domain contains')).toHaveValue('');
    expect(
      screen.getByRole('button', { name: 'Auction source: GoDaddy' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'TLD: .net' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Max current bid')).toHaveValue(25);
    expect(screen.getByLabelText('Ending')).toHaveValue('1h');
    expect(
      screen.getByRole('button', { name: /More filters 1/ }),
    ).toHaveAttribute('aria-expanded', 'false');

    const form = screen.getByRole('form', {
      name: 'Domain filters',
    }) as HTMLFormElement;
    const submitted = new FormData(form);
    expect(submitted.getAll('source')).toEqual(['godaddy']);
    expect(submitted.getAll('tld')).toEqual(['net']);
    expect(submitted.get('priceMax')).toBe('25');
    expect(submitted.get('endingWithin')).toBe('1h');
    expect(submitted.get('bidsMin')).toBe('2');
    expect(submitted.get('sort')).toBe('price');
    expect(submitted.get('direction')).toBe('desc');
    expect(submitted.has('noDigits')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /More filters 1/ }));
    const navigatedDialog = await screen.findByRole('dialog', {
      name: 'More filters',
    });
    expect(within(navigatedDialog).getByLabelText('Minimum bids')).toHaveValue(
      2,
    );
    expect(
      within(navigatedDialog).getByLabelText('Minimum length'),
    ).toHaveValue(null);
    expect(
      within(navigatedDialog).getByRole('checkbox', { name: 'No digits' }),
    ).not.toBeChecked();
  });
});

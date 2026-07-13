import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DomainDiscovery } from '@/components/domain-discovery';
import { parseDomainTableFilters } from '@/domain/domain-table';
import type { DomainListingsResult } from '@/server/queries/domain-listings';

const now = new Date('2026-07-13T10:00:00.000Z');

afterEach(cleanup);

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
    endsAt: new Date('2026-07-14T12:00:00.000Z'),
    ageYears: 12,
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
    endsAt: new Date('2026-07-15T12:00:00.000Z'),
    ageYears: null,
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
          latestSuccessfulSync: new Date('2026-07-13T09:58:00.000Z'),
        }}
        now={now}
      />,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Domain discovery' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Domain contains')).toHaveValue('garden');
    expect(screen.getByLabelText('Auction source')).toHaveValue('dynadot');
    expect(
      screen.getByRole('button', { name: 'Apply filters' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reset' })).toHaveAttribute(
      'href',
      '/',
    );
    expect(screen.getByLabelText('Data freshness')).toHaveTextContent(
      'Synced 2 minutes ago',
    );

    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(
      within(table).getByRole('columnheader', { name: /Ends/ }),
    ).toHaveAttribute('aria-sort', 'ascending');
    expect(
      within(table).getByRole('link', {
        name: 'garden-example.com (opens auction in a new tab)',
      }),
    ).toHaveAttribute('target', '_blank');
    expect(within(table).getByText('Dynadot')).toBeInTheDocument();
    expect(within(table).getByText('other-provider')).toBeInTheDocument();
    expect(within(table).getByText('12y')).toBeInTheDocument();
    expect(within(table).getAllByText('—')).toHaveLength(5);

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
      screen.getByRole('columnheader', { name: /Domain/ }),
    ).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getByText('Previous')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByText('Next')).toHaveAttribute('aria-disabled', 'true');
  });

  it('renders a useful empty state and zero range', () => {
    render(
      <DomainDiscovery
        filters={parseDomainTableFilters({})}
        result={{
          rows: [],
          total: 0,
          page: 1,
          sources: ['dynadot'],
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
});

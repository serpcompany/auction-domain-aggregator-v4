import { describe, expect, it } from 'vitest';

import {
  buildDomainTableHref,
  DOMAIN_TABLE_PAGE_SIZE,
  formatDateTime,
  formatMoney,
  formatSyncRecency,
  MAX_DOMAIN_TABLE_PAGE,
  nextSortDirection,
  parseDomainTableFilters,
} from './domain-table';

describe('domain table filters', () => {
  it('uses stable defaults', () => {
    expect(parseDomainTableFilters({})).toEqual({
      query: undefined,
      source: undefined,
      sort: 'endsAt',
      direction: 'asc',
      page: 1,
      pageSize: DOMAIN_TABLE_PAGE_SIZE,
    });
  });

  it('normalizes allowlisted values and bounds the page', () => {
    const longQuery = `  ${'A'.repeat(260)}  `;

    expect(
      parseDomainTableFilters({
        q: [longQuery, 'ignored'],
        source: 'DYNADOT',
        sort: 'price',
        direction: 'desc',
        page: String(MAX_DOMAIN_TABLE_PAGE + 1),
      }),
    ).toEqual({
      query: 'a'.repeat(253),
      source: 'dynadot',
      sort: 'price',
      direction: 'desc',
      page: MAX_DOMAIN_TABLE_PAGE,
      pageSize: DOMAIN_TABLE_PAGE_SIZE,
    });
  });

  it('rejects invalid, empty, negative, and unsafe values', () => {
    expect(
      parseDomainTableFilters({
        q: '   ',
        source: 'unknown',
        sort: 'drop table',
        direction: 'sideways',
        page: '-2',
      }),
    ).toMatchObject({
      query: undefined,
      source: undefined,
      sort: 'endsAt',
      direction: 'asc',
      page: 1,
    });

    expect(
      parseDomainTableFilters({ page: '999999999999999999999999999999' }).page,
    ).toBe(1);
    expect(parseDomainTableFilters({ q: [] }).query).toBeUndefined();
  });
});

describe('domain table links and sort direction', () => {
  const filters = parseDomainTableFilters({
    q: 'garden',
    source: 'dynadot',
    sort: 'domain',
    direction: 'asc',
    page: '2',
  });

  it('preserves filters while applying navigation overrides', () => {
    expect(buildDomainTableHref(filters, { page: 3 })).toBe(
      '/?q=garden&source=dynadot&sort=domain&direction=asc&page=3',
    );
    expect(
      buildDomainTableHref(parseDomainTableFilters({}), {
        sort: 'bids',
        direction: 'desc',
      }),
    ).toBe('/?sort=bids&direction=desc&page=1');
  });

  it('toggles an active sort and starts a new sort ascending', () => {
    expect(nextSortDirection(filters, 'domain')).toBe('desc');
    expect(nextSortDirection({ ...filters, direction: 'desc' }, 'domain')).toBe(
      'asc',
    );
    expect(nextSortDirection(filters, 'age')).toBe('asc');
  });
});

describe('domain table formatting', () => {
  it('formats money with a safe fallback', () => {
    expect(formatMoney(1234, 'USD')).toBe('$12.34');
    expect(formatMoney(1234, 'NOT_A_CURRENCY')).toBe('NOT_A_CURRENCY 12.34');
  });

  it('formats timestamps in UTC', () => {
    expect(formatDateTime(new Date('2026-07-13T09:05:00.000Z'))).toContain(
      'Jul 13, 2026',
    );
    expect(formatDateTime(new Date('2026-07-13T09:05:00.000Z'))).toContain(
      'UTC',
    );
  });

  it.each([
    [null, 'No successful sync yet'],
    ['2026-07-13T09:59:30.000Z', 'Synced just now'],
    ['2026-07-13T09:59:00.000Z', 'Synced 1 minute ago'],
    ['2026-07-13T09:58:00.000Z', 'Synced 2 minutes ago'],
    ['2026-07-13T09:00:00.000Z', 'Synced 1 hour ago'],
    ['2026-07-13T08:00:00.000Z', 'Synced 2 hours ago'],
    ['2026-07-12T10:00:00.000Z', 'Synced 1 day ago'],
    ['2026-07-11T10:00:00.000Z', 'Synced 2 days ago'],
    ['2026-07-13T10:01:00.000Z', 'Synced just now'],
  ])('formats sync recency for %s', (value, expected) => {
    expect(
      formatSyncRecency(
        value === null ? null : new Date(value),
        new Date('2026-07-13T10:00:00.000Z'),
      ),
    ).toBe(expected);
  });
});

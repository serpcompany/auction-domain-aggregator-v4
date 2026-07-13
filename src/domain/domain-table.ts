export const DOMAIN_TABLE_PAGE_SIZE = 50;
export const MAX_DOMAIN_TABLE_PAGE = 100_000;

export const DOMAIN_TABLE_SORTS = [
  'domain',
  'source',
  'price',
  'bids',
  'endsAt',
  'age',
] as const;

export type DomainTableSort = (typeof DOMAIN_TABLE_SORTS)[number];
export type SortDirection = 'asc' | 'desc';
export type AuctionSource = 'dynadot';

export interface DomainTableFilters {
  query?: string;
  source?: AuctionSource;
  sort: DomainTableSort;
  direction: SortDirection;
  page: number;
  pageSize: typeof DOMAIN_TABLE_PAGE_SIZE;
}

export type DomainTableSearchParams = Record<
  string,
  string | string[] | undefined
>;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeQuery(value: string | undefined) {
  const normalized = value?.trim().toLowerCase().slice(0, 253);
  return normalized ? normalized : undefined;
}

export function parseDomainTableFilters(
  searchParams: DomainTableSearchParams,
): DomainTableFilters {
  const sourceValue = firstValue(searchParams.source)?.toLowerCase();
  const sortValue = firstValue(searchParams.sort);
  const directionValue = firstValue(searchParams.direction);
  const pageValue = firstValue(searchParams.page);
  const parsedPage =
    pageValue && /^\d+$/.test(pageValue) ? Number(pageValue) : 1;

  return {
    query: normalizeQuery(firstValue(searchParams.q)),
    source: sourceValue === 'dynadot' ? sourceValue : undefined,
    sort: DOMAIN_TABLE_SORTS.includes(sortValue as DomainTableSort)
      ? (sortValue as DomainTableSort)
      : 'endsAt',
    direction:
      directionValue === 'desc' || directionValue === 'asc'
        ? directionValue
        : 'asc',
    page: Math.min(
      Math.max(Number.isSafeInteger(parsedPage) ? parsedPage : 1, 1),
      MAX_DOMAIN_TABLE_PAGE,
    ),
    pageSize: DOMAIN_TABLE_PAGE_SIZE,
  };
}

export function buildDomainTableHref(
  filters: DomainTableFilters,
  overrides: Partial<Pick<DomainTableFilters, 'sort' | 'direction' | 'page'>>,
) {
  const next = { ...filters, ...overrides };
  const params = new URLSearchParams();

  if (next.query) params.set('q', next.query);
  if (next.source) params.set('source', next.source);
  params.set('sort', next.sort);
  params.set('direction', next.direction);
  params.set('page', String(next.page));

  return `/?${params.toString()}`;
}

export function nextSortDirection(
  filters: DomainTableFilters,
  sort: DomainTableSort,
): SortDirection {
  if (filters.sort !== sort) return 'asc';
  return filters.direction === 'asc' ? 'desc' : 'asc';
}

export function formatMoney(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

export function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(value);
}

export function formatSyncRecency(value: Date | null, now = new Date()) {
  if (!value) return 'No successful sync yet';

  const elapsedSeconds = Math.max(
    0,
    Math.floor((now.getTime() - value.getTime()) / 1_000),
  );
  if (elapsedSeconds < 60) return 'Synced just now';

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60)
    return `Synced ${elapsedMinutes} minute${elapsedMinutes === 1 ? '' : 's'} ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24)
    return `Synced ${elapsedHours} hour${elapsedHours === 1 ? '' : 's'} ago`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  return `Synced ${elapsedDays} day${elapsedDays === 1 ? '' : 's'} ago`;
}

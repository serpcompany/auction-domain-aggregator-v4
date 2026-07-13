import { DomainDiscovery } from '@/components/domain-discovery';
import {
  parseDomainTableFilters,
  type DomainTableSearchParams,
} from '@/domain/domain-table';
import { queryDomainListings } from '@/server/queries/domain-listings';

export const dynamic = 'force-dynamic';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<DomainTableSearchParams>;
}) {
  const filters = parseDomainTableFilters(await searchParams);
  const result = await queryDomainListings(filters);

  return <DomainDiscovery filters={filters} result={result} now={new Date()} />;
}

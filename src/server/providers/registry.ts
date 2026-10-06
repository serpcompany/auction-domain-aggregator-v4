import { createDynadotAdapter } from './dynadot';
import {
  createGodaddyAdapter,
  GODADDY_FEED_ENTRY,
  GODADDY_FEED_URL,
  GODADDY_PAGE_SIZE,
} from './godaddy';
import type { AuctionProvider, FeedPageSource, ProviderAdapter } from './types';

// Every credential an adapter may read from the ingestion worker env.
export type ProviderSecretName = 'DYNADOT_API_PRODUCTION_KEY';

export type ProviderSecrets = Partial<Record<ProviderSecretName, string>>;

// A provider that publishes one zipped JSON file instead of a paged API. The
// ingestion Workflow downloads `url`, splits the `field` array of archive
// entry `entry` into page files of `pageSize` records, and gives the adapter
// a source for those pages.
export type FileFeed = {
  url: string;
  entry: string;
  field: string;
  pageSize: number;
};

export type AdapterContext = {
  secrets: ProviderSecrets;
  // Staged pages, for a provider with a file feed.
  feedPages?: FeedPageSource;
};

type ProviderRegistration = {
  // Names of the secrets the adapter needs, read from the worker env.
  secretNames: readonly ProviderSecretName[];
  fileFeed?: FileFeed;
  createAdapter(context: AdapterContext): ProviderAdapter;
};

// Providers with an implemented adapter. Adding a provider means adding an
// adapter and an entry here; the sync service, storage, and Workflow stay
// unchanged.
export const PROVIDER_REGISTRY: Partial<
  Record<AuctionProvider, ProviderRegistration>
> = {
  dynadot: {
    secretNames: ['DYNADOT_API_PRODUCTION_KEY'],
    createAdapter: ({ secrets }) =>
      createDynadotAdapter({ apiKey: secrets.DYNADOT_API_PRODUCTION_KEY! }),
  },
  // GoDaddy's public inventory files need no credentials.
  godaddy: {
    secretNames: [],
    fileFeed: {
      url: GODADDY_FEED_URL,
      entry: GODADDY_FEED_ENTRY,
      field: 'data',
      pageSize: GODADDY_PAGE_SIZE,
    },
    createAdapter: ({ feedPages }) =>
      createGodaddyAdapter({ pages: feedPages }),
  },
};

export function implementedProvider(value: string): AuctionProvider | null {
  return Object.hasOwn(PROVIDER_REGISTRY, value)
    ? (value as AuctionProvider)
    : null;
}

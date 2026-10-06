import { createDynadotAdapter } from './dynadot';
import {
  createGodaddyAdapter,
  GODADDY_FEED_ENTRY,
  GODADDY_FEED_URL,
  GODADDY_PAGE_SIZE,
} from './godaddy';
import type { AuctionProvider, ProviderAdapter } from './types';

// Every credential an adapter may read from the ingestion worker env.
export type ProviderSecretName = 'DYNADOT_API_PRODUCTION_KEY';

// Non-secret values the local runner itself supplies to the worker.
export type ProviderRunnerValueName = 'GODADDY_FEED_PAGES_URL';

export type ProviderSecrets = Partial<
  Record<ProviderSecretName | ProviderRunnerValueName, string>
>;

// A provider that publishes one zipped JSON file instead of a paged API. The
// runner downloads `url`, splits the `data` array of archive entry `entry`
// into pages of `pageSize` records, serves them on loopback, and passes the
// base URL to the worker as `pagesUrlName`.
export type FileFeed = {
  url: string;
  entry: string;
  pageSize: number;
  pagesUrlName: ProviderRunnerValueName;
};

type ProviderRegistration = {
  // Names of the secrets the adapter needs, read from the worker env.
  secretNames: readonly ProviderSecretName[];
  fileFeed?: FileFeed;
  createAdapter(secrets: ProviderSecrets): ProviderAdapter;
};

// Providers with an implemented adapter. Adding a provider means adding an
// adapter and an entry here; the sync service, storage, worker, and runner
// stay unchanged.
export const PROVIDER_REGISTRY: Partial<
  Record<AuctionProvider, ProviderRegistration>
> = {
  dynadot: {
    secretNames: ['DYNADOT_API_PRODUCTION_KEY'],
    createAdapter: (secrets) =>
      createDynadotAdapter({ apiKey: secrets.DYNADOT_API_PRODUCTION_KEY! }),
  },
  // GoDaddy's public inventory files need no credentials.
  godaddy: {
    secretNames: [],
    fileFeed: {
      url: GODADDY_FEED_URL,
      entry: GODADDY_FEED_ENTRY,
      pageSize: GODADDY_PAGE_SIZE,
      pagesUrlName: 'GODADDY_FEED_PAGES_URL',
    },
    createAdapter: (secrets) =>
      createGodaddyAdapter({ pagesUrl: secrets.GODADDY_FEED_PAGES_URL }),
  },
};

export function implementedProvider(value: string): AuctionProvider | null {
  return Object.hasOwn(PROVIDER_REGISTRY, value)
    ? (value as AuctionProvider)
    : null;
}

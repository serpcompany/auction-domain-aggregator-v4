import { createDynadotAdapter } from './dynadot'
import {
  createGodaddyAdapter,
  GODADDY_FEED_ENTRY,
  GODADDY_FEED_URL,
  GODADDY_MAX_PAGES,
  GODADDY_PAGE_BYTE_LIMIT,
  GODADDY_PAGE_SIZE
} from './godaddy'
import {
  createNamecheapAdapter,
  NAMECHEAP_FEED_URL,
  NAMECHEAP_MAX_PAGES,
  NAMECHEAP_PAGE_BYTE_LIMIT,
  NAMECHEAP_PAGE_SIZE
} from './namecheap'
import type { AuctionProvider, FeedPageSource, ProviderAdapter } from './types'

// Every credential an adapter may read from the ingestion worker env.
export type ProviderSecretName = 'DYNADOT_API_PRODUCTION_KEY'

export type ProviderSecrets = Partial<Record<ProviderSecretName, string>>

// A provider that publishes one inventory file instead of a paged API. The
// ingestion Workflow downloads `url`, splits its records into page files of
// `pageSize` records, and gives the adapter a source for those pages.
// `maxPages` and `maxPageBytes` are the adapter's limits for reading them
// back. A `zipped-json` feed's records are the `field` array of archive
// entry `entry`; a `csv` feed's are its rows after the header.
export type FileFeed = {
  url: string
  pageSize: number
  maxPages: number
  maxPageBytes: number
} & ({ format: 'zipped-json'; entry: string; field: string } | { format: 'csv' })

export type AdapterContext = {
  secrets: ProviderSecrets
  // Staged pages, for a provider with a file feed.
  feedPages?: FeedPageSource
}

type ProviderRegistration = {
  // Names of the secrets the adapter needs, read from the worker env.
  secretNames: readonly ProviderSecretName[]
  fileFeed?: FileFeed
  createAdapter(context: AdapterContext): ProviderAdapter
}

// Providers with an implemented adapter. Adding a provider means adding an
// adapter and an entry here; the sync service, storage, and Workflow stay
// unchanged.
export const PROVIDER_REGISTRY: Partial<Record<AuctionProvider, ProviderRegistration>> = {
  dynadot: {
    secretNames: ['DYNADOT_API_PRODUCTION_KEY'],
    createAdapter: ({ secrets }) =>
      createDynadotAdapter({ apiKey: secrets.DYNADOT_API_PRODUCTION_KEY! })
  },
  // GoDaddy's public inventory files need no credentials.
  godaddy: {
    secretNames: [],
    fileFeed: {
      format: 'zipped-json',
      url: GODADDY_FEED_URL,
      entry: GODADDY_FEED_ENTRY,
      field: 'data',
      pageSize: GODADDY_PAGE_SIZE,
      maxPages: GODADDY_MAX_PAGES,
      maxPageBytes: GODADDY_PAGE_BYTE_LIMIT
    },
    createAdapter: ({ feedPages }) => createGodaddyAdapter({ pages: feedPages })
  },
  // Namecheap's public market sales CSV needs no credentials either.
  namecheap: {
    secretNames: [],
    fileFeed: {
      format: 'csv',
      url: NAMECHEAP_FEED_URL,
      pageSize: NAMECHEAP_PAGE_SIZE,
      maxPages: NAMECHEAP_MAX_PAGES,
      maxPageBytes: NAMECHEAP_PAGE_BYTE_LIMIT
    },
    createAdapter: ({ feedPages }) => createNamecheapAdapter({ pages: feedPages })
  }
}

export function implementedProvider(value: string): AuctionProvider | null {
  return Object.hasOwn(PROVIDER_REGISTRY, value) ? (value as AuctionProvider) : null
}

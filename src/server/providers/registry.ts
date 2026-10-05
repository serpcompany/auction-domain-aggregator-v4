import { createDynadotAdapter } from './dynadot';
import type { AuctionProvider, ProviderAdapter } from './types';

// Every credential an adapter may read from the ingestion worker env.
export type ProviderSecretName = 'DYNADOT_API_PRODUCTION_KEY';

export type ProviderSecrets = Partial<Record<ProviderSecretName, string>>;

type ProviderRegistration = {
  // Names of the secrets the adapter needs, read from the worker env.
  secretNames: readonly ProviderSecretName[];
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
};

export function implementedProvider(value: string): AuctionProvider | null {
  return Object.hasOwn(PROVIDER_REGISTRY, value)
    ? (value as AuctionProvider)
    : null;
}

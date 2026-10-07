# Technical design

Accepted technical choices and how the implemented system behaves, one topic per leaf. Stable boundaries and invariants are in [`ARCHITECTURE.md`](../../ARCHITECTURE.md); user-visible behavior is in the [product spec](../product-specs/initial-domain-discovery.md).

## Platform

- [Technology stack](technology-stack.md): the chosen platform, framework, database, UI, and check tools, the constraints they impose, and the decisions still open. Read it before adding a dependency or a Cloudflare service.
- [Production sync](production-sync.md): the one deployed target, its Cloudflare resources, and the CI deploy job. Read it before touching `env.production` or the deploy workflow.
- [Isolated verification](isolated-verification.md): how the workerd D1 tests and browser tests stay away from secrets, providers, and the owner's local inventory.

## Reading and enrichment

- [Domain discovery](domain-discovery.md): the URL contract, D1 query behavior, facets, derived TLD and length columns, indexes with measured request times, and the UI boundary. Read it before changing a filter, sort, or index.
- [Ahrefs Domain Rating enrichment](domain-rating-enrichment.md): the one request path that calls a provider, with its claims, request log, and cool-down.

## Ingestion

- [Data ingestion](data-ingestion.md): the Worker and Workflow steps, retries, reconciliation, listing lifecycle, run state, and feed metrics. Read it before changing anything under `apps/web/src/server/ingestion/`.
- [Provider rate limits](provider-rate-limits.md): each provider's published limit and what the sync enforces.
- [Dynadot](dynadot-sync.md), [GoDaddy](godaddy-sync.md), and [Namecheap](namecheap-sync.md) synchronization: one leaf per provider with its source, staging, adapter, record mapping, and evidence. Read the provider's leaf before changing its adapter.
- [Local sync runs](local-sync-runs.md): how `pnpm sync <provider>` runs the Workflow locally and keeps credentials out of the bundle.

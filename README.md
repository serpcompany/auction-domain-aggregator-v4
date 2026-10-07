# Auction domain aggregator

This repository is a personal auction and expired-domain discovery tool. Its goal is to replace the part of SpamZilla the repository owner uses: browse a domain inventory, narrow and sort it, compare useful signals, and open the authoritative auction page.

The first slice is implemented for Dynadot, GoDaddy, and Namecheap. A Cloudflare Workflow per provider, started daily by a Cron Trigger or manually with `pnpm sync`, synchronizes normalized auction listings into Cloudflare D1, and Next.js serves a URL-backed, server-filtered comparison table from it. Quick and advanced filters cover stored auction data, the Majestic and SEMrush metrics GoDaddy and Namecheap publish per domain, and domain properties derived from the name. Ahrefs Domain Rating is fetched for the rows being viewed. Only the daily sync is deployed, by CI; the website runs locally until accounts and payments (#27).

## Where things are

- [`docs/product-specs/initial-domain-discovery.md`](docs/product-specs/initial-domain-discovery.md): the agreed behavior. Read it before changing what the user sees.
- [`ARCHITECTURE.md`](ARCHITECTURE.md): the system flow, boundaries, and invariants. Read it before structural or data-flow changes.
- [`docs/technical-design/`](docs/technical-design/README.md): how each part works and why, one topic per leaf.
- [`docs/plans/`](docs/plans/README.md): how to run a multi-session plan, and summaries of completed ones.
- [`docs/references/`](docs/references/README.md): data-licensing research and the SpamZilla inventory. Research, not a commitment to implement every field.
- [`AGENTS.md`](AGENTS.md): the complete local command map and safety boundaries.

## Local inspection

After installing the pinned dependencies and applying local migrations, run:

```sh
corepack pnpm dev --webpack --hostname 127.0.0.1 --port 30001
```

Open `http://127.0.0.1:30001`. A populated table requires a manual sync (`corepack pnpm sync godaddy` and `corepack pnpm sync namecheap` need no credentials; Dynadot needs its key); routine checks use invented, provider-free temporary fixtures and do not need credentials.

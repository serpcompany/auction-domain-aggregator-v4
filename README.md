# Auction domain aggregator

This repository is a personal auction and expired-domain discovery tool. Its goal is to replace the part of SpamZilla the repository owner uses: browse a domain inventory, narrow and sort it, compare useful signals, and open the authoritative auction page.

The first local slice is implemented for Dynadot and GoDaddy. A Cloudflare Workflow per provider, started daily by a Cron Trigger or manually with `pnpm sync`, synchronizes normalized auction listings into Cloudflare D1 (local only for now; nothing is deployed) and serves a URL-backed, server-filtered comparison table through Next.js. Quick and advanced filters cover stored auction data, the Majestic and SEMrush metrics GoDaddy publishes per domain, and domain properties derived from the name. Ahrefs Domain Rating is fetched for the rows being viewed.

The agreed behavior is in [`docs/product-specs/initial-domain-discovery.md`](docs/product-specs/initial-domain-discovery.md). System boundaries are in [`ARCHITECTURE.md`](ARCHITECTURE.md), and the read-model decisions are in [`docs/technical-design/domain-discovery.md`](docs/technical-design/domain-discovery.md). The larger SpamZilla inventory under `docs/references/spamzilla/` is research, not a commitment to implement every field.

## Local inspection

After installing the pinned dependencies and applying local migrations, run:

```sh
corepack pnpm dev --webpack --hostname 127.0.0.1 --port 30001
```

Open `http://127.0.0.1:30001`. A populated table requires a manual sync (`corepack pnpm sync godaddy` needs no credentials; Dynadot needs its key); routine checks use invented, provider-free temporary fixtures and do not need credentials.

See [`AGENTS.md`](AGENTS.md) for the complete local command map and safety boundaries.

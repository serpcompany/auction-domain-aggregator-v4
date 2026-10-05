# Auction domain aggregator

This repository is a personal auction and expired-domain discovery tool. Its goal is to replace the part of SpamZilla the repository owner uses: browse a domain inventory, narrow and sort it, compare useful signals, and open the authoritative auction page.

The first local slice is implemented for Dynadot. It manually synchronizes normalized auction listings into local Cloudflare D1 and serves a URL-backed, server-filtered comparison table through Next.js. Quick and advanced filters cover stored auction data plus domain properties derived from the name. The table shows truthful unavailable values for Majestic Topic and Ahrefs Domain Rating until those enrichments are implemented.

The agreed behavior is in [`docs/product-specs/initial-domain-discovery.md`](docs/product-specs/initial-domain-discovery.md). System boundaries are in [`ARCHITECTURE.md`](ARCHITECTURE.md), and the read-model decisions are in [`docs/technical-design/domain-discovery.md`](docs/technical-design/domain-discovery.md). The larger SpamZilla inventory under `docs/references/spamzilla/` is research, not a commitment to implement every field.

## Local inspection

After installing the pinned dependencies and applying local migrations, run:

```sh
corepack pnpm dev --webpack --hostname 127.0.0.1 --port 30001
```

Open `http://127.0.0.1:30001`. A populated table requires the separately authorized manual Dynadot sync; routine checks use invented, provider-free temporary fixtures and do not need credentials.

See [`AGENTS.md`](AGENTS.md) for the complete local command map and safety boundaries.

# README.md

This project is a personal auction and expired-domain discovery tool. Its goal is to replace the parts of SpamZilla that the repository owner uses without requiring a SpamZilla subscription.

The first usable version will aggregate domains into one table, support filtering and column sorting, show the auction source, Majestic topic, and Ahrefs Domain Rating, and link each domain to its auction page.

The agreed initial scope is recorded in [`docs/product-specs/initial-domain-discovery.md`](docs/product-specs/initial-domain-discovery.md). The larger SpamZilla inventories under `docs/references/spamzilla/` are research references, not a commitment to implement every field.

## Domain auction providers

We will aggregate domains from various providers using their API. 

**Providers include:**
1. GoDaddy
2. DropCatch
3. Namecheap
4. Dynadot
5. NameSilo
6. NameJet

## Domain Metrics

There are alot of metrics that can be used to evaluate domains. We will start by trying to create a parity with spamzill.io's set of filters. Their data comes from a variety of sources. 

You can see their domain metrics listed in the `spamzilla` competitor references in the `docs/`

**There is also more information to look at in their docs:**
- https://www.spamzilla.io/faq/domains-table-user-interface/
- https://www.spamzilla.io/faq/domains-table-seo-metrics/
- https://www.spamzilla.io/faq/domains-table-filters/

Our goal is to identify whats needed to "get" (pull) those metrics and work towards having them for our own.

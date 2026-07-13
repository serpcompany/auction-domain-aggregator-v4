# README.md

This project is an auction/expired domain aggregator that helps user's find and bid-on/purchase domains that are either expired (ready to buy) or at auction (expiring soon but first open to bidders). 

Functionally the goal is to fetch auction & expired domains from multiple domain registrars / domain auctions and aggregate them into one central area to make it more convenient for users to find domains that fit their various needs (consolidate, search, filter, etc.)

### Competitor references

1. spamzilla.io

### Domain auction providers

We will aggregate domains from various providers using their API. 

**Providers include:**
1. GoDaddy
2. DropCatch
3. Namecheap
4. Dynadot
5. NameSilo
6. NameJet

### Domain Metrics

There are alot of metrics that can be used to evaluate domains. We will start by trying to create a parity with spamzill.io's set of filters. Their data comes from a variety of sources. 

You can see their domain metrics listed in the `spamzilla` competitor references in the `docs/`

**There is also more information to look at in their docs:**
- https://www.spamzilla.io/faq/domains-table-user-interface/
- https://www.spamzilla.io/faq/domains-table-seo-metrics/
- https://www.spamzilla.io/faq/domains-table-filters/

Our goal is to identify whats needed to "get" (pull) those metrics and work towards having them for our own.


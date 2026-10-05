# Initial domain discovery

## Purpose

The first user is the repository owner. The product replaces the part of SpamZilla they use today: browsing auction domains, narrowing the list, comparing useful values, and reaching the original auction listing.

## First usable workflow

The user can:

1. Open a server-rendered table of active auction listings collected in local D1.
2. Narrow the inventory with quick filters for a domain fragment, one or more sources, one or more TLDs, maximum current bid, and ending window.
3. Open `More filters` for auction type; domain length, age, and shape; current-bid range; renewal-price ceiling; minimum bids, bidders, visitors, inbound links, and Dynadot appraisal.
4. See every applied constraint as a removable summary, clear all constraints, and use a copied URL or browser Back without losing normalized filter state.
5. Sort by Domain, Auction, Price, Interest, Ends, Age, Links, or Appraisal and move through fixed 50-row pages. Sorting and pagination preserve active filters.
6. Compare Domain, Auction, Price, Interest, Ends, Age, Links, Dynadot Appraisal, Majestic Topic, and Ahrefs DR in one table.
7. Open the authoritative auction page from the domain link in a new tab.

Filters combine with AND across categories. Repeated values within Source, Auction type, and TLD use OR. Applying, removing, or clearing filters returns to page 1. Unknown numeric values remain eligible until that value is constrained, then are excluded.

End times show a compact relative value as the primary text and an absolute UTC value as secondary context. Current bids and appraisal values omit unnecessary `.00`; unknown values use a truthful em dash with accessible `Not collected` context. Urgent end times remain understandable from text rather than color alone.

## Current data availability

Dynadot is the first implemented auction source. Its normalized listing data supplies source URL, auction type, current bid, bid and bidder counts, start and end times, age, inbound links, visitors, Dynadot appraisal, and renewal price when the provider supplies them.

TLD, domain length, hyphen presence, and digit presence are deterministic domain-name properties and are derived at query time. They are not separately stored.

Majestic Topic and Ahrefs Domain Rating are part of the intended comparison workflow but are not ingested yet. The table displays them as unavailable, and their filters are explicitly unavailable, until real enrichment exists. No fabricated metric value is acceptable.

Local credentials may exist for other auction or metric providers, but credentials alone do not make an integration implemented or authorize a provider call.

## Scope boundary

The documents under `docs/references/spamzilla/` describe a much larger portion of SpamZilla. They are research inputs, not requirements for this first usable slice.

User accounts, subscriptions, billing, teams, saved searches, bidding, additional providers, scheduled synchronization, remote Cloudflare resources, and deployment are outside this slice.

## Remaining product dependencies

- Obtain and store real Ahrefs Domain Rating enrichment once per domain.
- Decide how Majestic topics will be obtained, then store real topic enrichment once per domain.
- Add other auction providers one independently verified adapter at a time.

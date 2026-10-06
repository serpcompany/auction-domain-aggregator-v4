# Initial domain discovery

## Purpose

The first user is the repository owner. The product replaces the part of SpamZilla they use today: browsing auction domains, narrowing the list, comparing useful values, and reaching the original auction listing.

## First usable workflow

The user can:

1. Open a server-rendered table of active auction listings collected in local D1. Auctions whose end time has passed are hidden even before the next sync, and the page warns when the inventory is more than 24 hours old.
2. Narrow the inventory with quick filters for a domain fragment, one or more sources, one or more TLDs, maximum current bid, and ending window.
3. Open `More filters` for auction type; domain length, age, and shape; current-bid range; renewal-price ceiling; minimum bids, visitors, inbound links, and provider appraisal; and, under Metrics, minimum Majestic Trust Flow, Citation Flow, referring domains, and Semrush Authority Score. Bidder counts are not shown or filterable, because GoDaddy does not publish them.
4. See every applied constraint as a removable summary, clear all constraints, and use a copied URL or browser Back without losing normalized filter state.
5. Sort by Domain, Auction, Price, Interest, Ends, Age, Links, or Appraisal and move through fixed 50-row pages. Sorting and pagination preserve active filters.
6. Compare Domain, Auction, Price, Interest, Ends, Age, Links, provider Appraisal, Majestic TF · CF, Semrush Authority, and Ahrefs DR in one table. DR is fetched from Ahrefs for the rows being viewed, appears a moment after the page loads, and is shown under a "Domain Rating by Ahrefs" link. Because DR exists only for domains someone has viewed, it cannot be filtered or sorted across the inventory.
7. Open the authoritative auction page from the domain link in a new tab. Every link that leaves the application opens in a new tab.

Filters combine with AND across categories. Repeated values within Source, Auction type, and TLD use OR. Applying, removing, or clearing filters returns to page 1. Unknown numeric values remain eligible until that value is constrained, then are excluded.

End times show a compact relative value as the primary text and an absolute UTC value as secondary context. Current bids and appraisal values omit unnecessary `.00`; unknown values use a truthful em dash with accessible `Not collected` context. Urgent end times remain understandable from text rather than color alone.

## Current data availability

Dynadot and GoDaddy are the implemented auction sources.

- Dynadot supplies source URL, auction type, current bid, bid and bidder counts, start and end times, age, inbound links, visitors, Dynadot appraisal, and renewal price when it supplies them.
- GoDaddy's public inventory file supplies source URL, auction type (`Auction` for bid listings, `Buy Now` for fixed-price ones), current price, bid count, end time, age, monthly parking pageviews (shown as visitors), and GoDaddy valuation (shown as appraisal). It publishes no bidder count, start time, inbound links, or renewal price; those stay unknown rather than zero.

GoDaddy's file also carries per-domain Majestic Trust Flow, Citation Flow, backlinks, and referring domains, and SEMrush Authority Score, referring domains, and backlinks. These are stored per domain, replaced by each GoDaddy sync, and apply to every listing of that domain, whatever its source.

TLD, domain length, hyphen presence, and digit presence are deterministic domain-name properties and are derived at query time. They are not separately stored.

Ahrefs Domain Rating is fetched on demand and stored once per domain. A domain not yet fetched shows a truthful em dash with "not collected" context, and one Ahrefs has no rating for says so. Majestic Topic is not planned. No fabricated metric value is acceptable.

Local credentials may exist for other auction or metric providers, but credentials alone do not make an integration implemented or authorize a provider call.

## Scope boundary

The documents under `docs/references/spamzilla/` describe a much larger portion of SpamZilla. They are research inputs, not requirements for this first usable slice.

User accounts, subscriptions, billing, teams, saved searches, bidding, additional providers, scheduled synchronization, remote Cloudflare resources, and deployment are outside this slice.

GoDaddy's inventory content is licensed for the owner's internal use only (`docs/references/data-licensing.md`). Showing it to anyone else needs GoDaddy's written permission first.

## Remaining product dependencies

- Add other auction providers one independently verified adapter at a time.

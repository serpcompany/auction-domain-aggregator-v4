# Initial domain discovery

## Purpose

The first user is the repository owner. The product replaces the part of SpamZilla they use today: browsing auction domains, narrowing the list, comparing useful values, and reaching the original auction listing.

## First usable workflow

The agreed design is the approved mockups, `docs/plans/completed/ui-redesign-mockups.html` (owner review 2026-10-07, #52). The user can:

1. Open the Auctions screen: an application shell with a collapsible sidebar (Auctions, Sync status), a header showing how fresh the inventory is and a light/dark toggle, and a server-rendered table of active auction listings collected in local D1. Auctions whose end time has passed are hidden even before the next sync, and the page warns when the inventory is more than 24 hours old. The screen opens on auction listings only (Type: Auction); removing that rule (on a phone, that filter chip), or Clear all, shows expired-domain listings too.
2. Narrow the inventory from the rule bar above the table, on screens 768 pixels and wider. Its first rule, Domain contains, is always there (`/` focuses it). Every other applied filter shows as one rule: the field, an operator, a value, and a button to remove it. Filters lists the fields not yet in use; choosing one adds its rule and focuses its value. Operators are the ones the filters already support: Domain has no hyphens or no digits; Source, Type, and TLD is any of; Price, Length, and Age ≥, ≤, =, or between; Bids, Links, Visitors, Appraisal, Majestic TF, CF, and referring domains, Semrush AS, and Ahrefs DR ≥; Renewal ≤; and Ends within 1 hour to 7 days. A value applies on Enter, on leaving the rule, or on choosing an option, never while typing, and returns to page 1; a between rule waits for both ends. Clear all removes every rule and keeps the sort. The listing count, Fetch DR, and Columns stay at the right end of the first row while the rules wrap below.
3. Open the Filters page (`/filters/`) to see and change every filter in one place: the quick filters, plus domain length, age, and shape; current-bid range; renewal-price ceiling; minimum bids, visitors, inbound links, and provider appraisal; and minimum Majestic Trust Flow, Citation Flow, referring domains, Semrush Authority Score, and Ahrefs DR. The page opens with the current filters filled in. Show results applies them and Cancel returns to the unchanged results. A minimum greater than its maximum blocks applying until it is fixed. Bidder counts are not shown or filterable, because GoDaddy does not publish them.
4. See every applied constraint once (as a rule, or on a phone as a removable chip), clear all constraints, and use a copied URL or browser Back without losing normalized filter state.
5. Sort by any column from the menu on its header (Sort ascending or descending): Domain, Source, Price, Bids, Ends, Age, Links, Appraisal, Renewal, Visitors, Length, Majestic Trust Flow, Citation Flow, and referring domains, Semrush Authority Score, or Ahrefs DR. Metric sorts start with the highest values. Listings without a value sort last in both directions. Move through fixed 96-row pages with first, previous, next, and last page links. Sorting and pagination preserve active filters.
6. Choose which columns the table shows. The default columns are Domain, Source, Type (the auction type: Auction, Buy Now, Closeout, or Expired), Price, Bids, Ends, Age, Links, provider Appraisal, Majestic TF and CF, and Ahrefs DR. Renewal, Visitors, Length, Majestic referring domains, and Semrush Authority Score are optional. Short metric headers (TF, CF, AS, DR) name the metric in a tooltip. Hide a column from its header menu, or choose columns from the Columns menu; Reset layout restores the default columns and widths. Showing or hiding a column does not reload the page. Domain is always shown. On a desktop, resize any column by dragging the right edge of its header (or focusing that edge and using the arrow keys); double-click the edge or press Enter to restore its default width. The column choice and widths persist in the browser across reloads and are not part of a shared URL. On a phone, the same choice decides which metrics each listing shows.
7. See Ahrefs DR for the rows being viewed. It is fetched from Ahrefs after the page loads, with a spinner meanwhile, and is always shown with a "Domain Rating by Ahrefs" link to `https://ahrefs.com/`. DR exists only for domains already fetched, so a minimum-DR filter matches only those, and sorting by DR ranks the domains with a stored rating and puts every other listing last. Once the filters match 1,000 listings or fewer, Fetch DR asks Ahrefs for all of them in one call; above that it asks for narrower filters. While the DR column is hidden, no DR is fetched. A domain Ahrefs gives no answer for shows no rating and is asked for again after a week.
8. Open a details panel for any listing with every collected value. Auction: price, bids, end time, renewal, and appraisal. Domain: TLD, length, hyphens, digits, age, visitors, and inbound links. SEO metrics: Majestic TF, CF, and referring domains; Semrush Authority Score; and Ahrefs DR. The panel can also copy the domain.
9. Open the authoritative auction page in a new tab from the domain link or the details panel. Every link that leaves the application opens in a new tab.
10. On a phone, browse listings as a list rather than a table, with search, a Filters link, sorting, column choice, removable filter chips, and pagination. Each listing shows its domain and price, its source (with the provider's color dot), type, and bids, the countdown (amber under 48 hours), and badges for the chosen metrics, DR emphasized; the "DR = Domain Rating by Ahrefs" link stays at the top of the list. The first screen shows listings, not filter fields.
11. Open Sync status (`/syncs/`) to see, for each provider, active listings, the latest run's status, the last success, duration, records fetched, the next scheduled run (or that the site does not schedule that provider: Staging syncs only GoDaddy, weekly), and the local sync command, plus recent runs with their error codes. A failed latest run is flagged there and in the sidebar. The page reads D1 only.
12. See a designed state while results load, when no listing matches (with Clear all and Edit filters), when nothing has been synced yet (with the sync command), and when the database cannot be read (with the migration command and Try again).

Filters combine with AND across categories. Repeated values within Source, Auction type, and TLD use OR. Applying, removing, or clearing filters returns to page 1. Unknown numeric values remain eligible until that value is constrained, then are excluded.

In the table, Source and Type are pills, Source with a dot in its provider's color. Ends is a countdown pill only (for example `1d 5h`), amber under 48 hours, with the exact UTC end time in its tooltip. DR is its number inside a ring that fills to the rating. Current bids and appraisal values omit unnecessary `.00`; unknown values use a truthful em dash with accessible `Not collected` context. Urgent end times remain understandable from text rather than color alone.

## Current data availability

Dynadot, GoDaddy, Namecheap, and NameSilo are the implemented auction sources.

- Dynadot supplies source URL, auction type, current bid, bid and bidder counts, start and end times, age, inbound links, visitors, Dynadot appraisal, and renewal price when it supplies them.
- GoDaddy's public inventory file supplies source URL, auction type (`Auction` for bid listings, `Buy Now` for fixed-price ones), current price, bid count, end time, age, monthly parking pageviews (shown as visitors), and GoDaddy valuation (shown as appraisal). It publishes no bidder count, start time, inbound links, or renewal price; those stay unknown rather than zero.
- Namecheap Market's public sales file supplies source URL, current price, bid count, start and end times, age (whole years from registration to the sale's start), Estibot valuation (shown as appraisal), and renewal price. Every Namecheap sale is a timed auction. It publishes no bidder count, inbound links, or visitors.
- NameSilo's API supplies expired auctions (auction type `Expired`) and customer auctions (`Auction`) with source URL, current bid (the opening bid until someone bids), bid count, end time, age (whole years from registration to the auction's end), and visitors. It publishes no bidder count, start time, inbound links, appraisal, or renewal price.

GoDaddy's file also carries per-domain Majestic Trust Flow, Citation Flow, backlinks, and referring domains, and SEMrush Authority Score, referring domains, and backlinks. Namecheap's carries Trust Flow, Citation Flow, Majestic backlinks, Authority Score, and SEMrush backlinks. These are stored per domain, replaced by each sync that carries them, and apply to every listing of that domain, whatever its source.

TLD, domain length, hyphen presence, and digit presence are deterministic properties of the normalized domain name; no provider supplies them. The TLD is the final label, so `example.co.uk` is listed under `.uk`.

The Source, Auction type, and TLD filters offer every value that an open listing had at the last successful sync, with no cap on the number of TLDs. A value seen only by a sync that has not yet succeeded can still be filtered through the URL and is offered after the next successful sync.

Ahrefs Domain Rating is fetched on demand and stored once per domain. A domain not yet fetched shows a truthful em dash with "not collected" context, and one Ahrefs has no rating for says so. Majestic Topic is not planned. No fabricated metric value is acceptable.

Local credentials may exist for other auction or metric providers, but credentials alone do not make an integration implemented or authorize a provider call.

## Scope boundary

The documents under `docs/references/spamzilla/` describe a much larger portion of SpamZilla. They are research inputs, not requirements for this first usable slice. The Filters page and the column choice are built to hold many more options, but no filter or column beyond those listed above is implied.

User accounts, subscriptions, billing, teams, saved searches, bidding, additional providers, scheduled synchronization, remote Cloudflare resources, and deployment are outside this slice.

GoDaddy's inventory content is licensed for the owner's internal use only (`docs/references/data-licensing/godaddy.md`). Showing it to anyone else needs GoDaddy's written permission first. Namecheap publishes its sales file without a licence either way; the owner has approved showing Namecheap listings to customers, each linked back to its sale (`docs/references/data-licensing/namecheap.md`). NameSilo's terms do not address showing its API data to others; ask NameSilo first (`docs/references/data-licensing/namesilo.md`).

## Remaining product dependencies

- Add other auction providers one independently verified adapter at a time.

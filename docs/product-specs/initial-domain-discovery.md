# Initial domain discovery

## Purpose

The first user is the repository owner. The product should replace the part of SpamZilla they currently pay for: browsing auction domains, narrowing the list, and reaching the original auction listing.

## First usable workflow

The user can:

1. Open a table containing domains gathered from auction sources.
2. Filter the table to narrow the available domains.
3. Sort the table by its columns.
4. See each domain's auction source, Majestic topic, and Ahrefs Domain Rating (DR).
5. Click a domain or auction link to open its page on the source auction site.

## Required information

Each displayed auction listing needs enough information to support that workflow:

- Domain name.
- Auction source.
- Source auction page URL.
- Majestic topic, when available.
- Ahrefs Domain Rating, when available.

Additional identifiers, timestamps, prices, and ingestion metadata may become necessary when provider data is examined. They are not user-facing requirements merely because they appear in a provider response.

## Available integrations

Local credentials currently exist for these auction sources:

- GoDaddy.
- Dynadot.
- DropCatch.

Local Ahrefs credentials also exist. Credential availability does not prove that a particular API supplies every field the product needs; that must be verified against the provider and with a small working integration.

No Majestic credentials are currently recorded in `.env`. How Majestic topics will be obtained remains an open product dependency.

## Scope boundary

The documents under `docs/references/spamzilla/` describe a much larger portion of SpamZilla. They are inputs to future decisions, not the scope of the first usable version.

User accounts, subscriptions, billing, teams, and other public SaaS concerns are outside the initial personal-use scope.

## Open decisions

- Which auction source should supply the first working domain listings?
- Which filters and sortable columns are required beyond the three explicitly named fields?
- How will Majestic topics be obtained?
- Which provider-specific auction fields are needed to keep active listings useful between synchronizations?

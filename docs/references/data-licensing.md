# Data licensing for a paid product

Researched 2026-10-06 for issue #28.

**This is research, not legal advice.** It records what each provider's published terms say about showing their listing data to paying customers. Terms change; re-read the linked documents before relying on them, and get written permission or legal review before a paid launch.

## Question

The product is moving from a single-owner tool to a paid SaaS ($27/month, one plan). It would show auction listings from Dynadot, DropCatch, and GoDaddy to paying customers, link each row to the provider's auction page, and may show Ahrefs Domain Rating (DR). For each source: may data obtained through its API or feeds be shown to third-party paying customers, and under what conditions?

Confidence labels:

- **Verified**: a clause in the provider's published terms answers the question directly.
- **Inferred**: no clause answers it directly; the conclusion is drawn from general clauses, silence, or secondary sources.

## Summary

| Source                        | Allowed for paying customers?                    | Confidence |
| ----------------------------- | ------------------------------------------------ | ---------- |
| Dynadot API                   | No, not without written permission               | Verified   |
| DropCatch API                 | Not addressed; ask first                         | Inferred   |
| GoDaddy API and inventory     | Not granted; content licensed for internal use   | Verified   |
| Ahrefs Domain Rating (DR API) | Yes, with attribution and link                   | Verified   |
| Other Ahrefs metrics          | Only through Ahrefs Connect (Enterprise, OAuth)  | Verified   |
| Linking out to auction pages  | No clause against plain links; affiliate links OK | Inferred   |

## 1. Dynadot

The current ingestion uses the api3 `get_open_auctions` command with the owner's API key. The API documentation itself carries no separate API terms; the API is governed by section 13 of the Dynadot Terms of Use.

| Question       | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Allowed?       | **No**, without Dynadot's written agreement. The terms prohibit making API-derived data available to third parties or embedding it in other applications.                                                                                                                                                                                                                                                                                                                                                                                       |
| Conditions     | Rate limits by account tier: regular accounts 1 thread, "60/min (1/sec)"; bulk 600/min; super bulk 6000/min. Site content is also protected separately (section 2).                                                                                                                                                                                                                                                                                                                                                                             |
| Evidence       | Terms of Use §13.1(b): you shall not "make available the API (or … any data derived out of its use) to third parties". §13.1(c): shall not "embed or incorporate … any data derived out of its use) into other applications". §2.1: "The copying, redistribution, use or publication by You of any such content" is prohibited. §13.1(i) bars using API code to build something "competitive with the API".                                                                                                                                      |
| Affiliate      | Dynadot runs two mutually exclusive programs (CJ Affiliate, or the in-house Ambassador Program). Expired, expired-closeout, and backorder auctions pay 15% on won auctions within a 30-day cookie. Ambassador restrictions forbid paid search on Dynadot terms and using "Dynadot's name, brand terms, or URLs in display URLs". The affiliate pages describe referral links only; they do not grant a data feed or a licence to republish listings.                                                                                     |
| Reseller       | The Reseller Program is a white-label registrar backend (registration, transfer, renewal, DNS). Nothing found says it covers aftermarket listing data.                                                                                                                                                                                                                                                                                                                                                                                          |
| Confidence     | **Verified** for the prohibition. **Inferred** that an affiliate or reseller relationship would not by itself change it.                                                                                                                                                                                                                                                                                                                                                                                                                        |

The public Expired Auctions page offers a manual CSV download, but that is still site content under §2.

## 2. DropCatch

DropCatch (TurnCommerce, with NameBright as registrar) authenticates API users through NameBright API accounts (`auth.tcdevops.com` bearer tokens). The only public API documentation found covers backordering (`NameBright/DropCatchBackorderExamples` on GitHub). No public API terms, developer agreement, or listing-feed licence was found. `api.dropcatch.com/swagger` returns 403 to anonymous requests.

| Question   | Answer                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Allowed?   | **Not addressed.** The DropCatch Terms and Conditions (42 sections) and the NameBright Terms of Service (revised 2026-04-09) contain no clause on API data use, scraping, redistribution, or republishing listings.                                                                                                                                                                         |
| Conditions | §25 Gamification: automated systems "must first be presented to DropCatch and approved" (written about bidding, but the only clause on programmatic use). An unapproved integration could be treated as a breach, and the terms say breaches suspend both DropCatch and NameBright accounts.                                                                                               |
| Evidence   | DropCatch Terms and Conditions, served at `dropcatch.com/legal/terms`; NameBright Terms of Service.                                                                                                                                                                                                                                                                                             |
| Affiliate  | No DropCatch affiliate or partner program was found. The terms mention "Corporate Partner" backorders, which is a backorder priority tier, not a data or referral partnership.                                                                                                                                                                                                              |
| Confidence | **Inferred.** Silence is not permission. The repository's earlier probe also found the V2 auctions endpoint returned zero items for this account (see `docs/plans/completed/dynadot-domain-table.md`).                                                                                                                                                                                          |

## 3. GoDaddy

Three relevant documents: the GoDaddy API Terms of Use (revised 2026-07-07), the Universal Terms of Service (revised 2026-03-06), and the Auctions Membership Agreement (revised 2025-08-29). The public inventory files at `inventory.auctions.godaddy.com` (39 zipped JSON, XML, and CSV files, refreshed daily, no login) display no terms of their own.

| Question   | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Allowed?   | **Not granted.** GoDaddy Content, which includes "GoDaddy data", is licensed only for internal business use and may not be redistributed or displayed except as expressly permitted. Neither the API Terms nor the inventory page grants republishing rights.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Conditions | API: "each API endpoint is limited to sixty (60) requests per minute"; use "only in connection with … data that you are authorized to access or manage"; you "may not resell, sublicense, provide, or otherwise make the API or API access available" to third parties without written authorisation; you may not imply your app is "sponsored by, endorsed by, or affiliated with GoDaddy". The Auctions API needs a classic `sso-key` developer key and is built for availability checks, bidding, and buy-now purchases, not catalogue export.                                                                                                                                                                                                                                       |
| Evidence   | Universal Terms of Service: GoDaddy Content is provided "for your internal business purposes in connection with your authorized use"; "GoDaddy Content may not be downloaded, copied, reproduced, distributed, transmitted, displayed, sold" except as permitted; you "will not copy or distribute in any medium any part of this Site"; you will not access GoDaddy Content by means "other than through this Site itself, or as GoDaddy may designate". Auctions Membership Agreement: Traffic Data and Valuation are "for informational purposes only", and buyers agree "not to purchase any domain name found through the Services without using the Services". |
| Affiliate  | GoDaddy's affiliate program runs through CJ Affiliate (advertiser 1513033) and offers banner ads and text links. The public page does not mention auctions or a listing feed; the CJ publisher agreement was not reviewed because it requires sign-up.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Confidence | **Verified** that no republishing right is granted and that content is internal-use. **Inferred** that GoDaddy tolerates third-party display in practice, because ExpiredDomains.net publicly lists GoDaddy auction counts sourced from these feeds.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

The inventory download page is arguably a way of access GoDaddy "may designate", but that only covers access, not the internal-use limit on what you may do with the content.

**Current use (2026-10-06, issue #16):** `pnpm sync godaddy` downloads `all_biddable_auctions.json.zip` from these public files into the owner's local D1 for the owner's own use, which is internal use. That includes the file's Majestic and SEMrush metrics. Nothing from it may be shown to other people, including paying customers, until GoDaddy grants written permission.

## 4. Ahrefs

### Domain Rating

Ahrefs published a separate Domain Rating licence (last modified 2026-06-11) and a free endpoint, `POST /v3/public/domain-rating-free`, which takes up to 1,000 targets per request and consumes no API units. "Requests to this endpoint are free, yet require an APIv3 key", which any free Ahrefs account can generate.

| Question   | Answer                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Allowed?   | **Yes.** The licence grants a worldwide, royalty-free, revocable right to "use, display, publish or integrate DR Data into or within your products and services".                                                                                                                                                                                                                                        |
| Conditions | Every display must carry the attribution "Domain Rating by Ahrefs", clear, legible, adjacent to the value, with a working hyperlink to `https://ahrefs.com/`, and it "shall not be hidden, obscured or removed". Do not "re-package, sell or distribute DR Data in its original form" or as a substitute or competing product. Do not "harvest DR Data in bulk or systematically in order to compile, reconstruct" a competing dataset or index. Ahrefs may rate-limit, throttle, or withdraw the endpoint without notice. |
| Evidence   | Domain Rating License Terms of Use §§1 to 5; Ahrefs API reference for `domain-rating-free`.                                                                                                                                                                                                                                                                                                              |
| Confidence | **Verified** for display with attribution. **Inferred** risk: looking up DR for every auction domain each day and storing it could be read as systematic bulk harvesting under §4(b) if Ahrefs sees the result as a competing index. Ask Ahrefs about volume before building it.                                                                                                                      |

### Other Ahrefs metrics and "bring your own key"

| Question   | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Allowed?   | **Only through Ahrefs Connect**, and only back to the same customer. Using the owner's own paid Ahrefs key to show metrics to customers is not permitted: the general Terms of Service licence is "solely for the purposes of your internal business operations" (§12.4).                                                                                                                                                                                                                        |
| Conditions | Connect eligibility: the app "must be a publicly available product with an existing user base"; "For any new integration with Ahrefs Connect, you will require an Ahrefs Enterprise Plan"; admission is at Ahrefs' discretion. End users must hold "active and paid Ahrefs accounts" and authorise via OAuth; their own API units are consumed. "Do not display Ahrefs Data to anyone other than the End User." "Do not reconstruct datasets or maintain shadow databases of Ahrefs Data." Caches must be purged on revocation. No substitute or competing features. |
| BYO key    | Ahrefs Connect is the sanctioned way for a third-party app to use a customer's Ahrefs account. Legacy integrations were deprecated on 2025-11-01. Customers pasting their own API keys into the app is not addressed by any clause found; it sidesteps Connect's eligibility and audit terms, and Connect §8 forbids using "multiple apps/keys to bypass limits".                                                                                                                                  |
| Evidence   | Ahrefs Connect Terms of Service §§1 to 8; Ahrefs Connect introduction; Ahrefs Terms of Service §§4.4(i), 4.4(j), 4.4(l), 12.4.                                                                                                                                                                                                                                                                                                                                                                    |
| Confidence | **Verified** for Connect rules and internal-use limit. **Inferred** that pasted BYO keys are unsafe.                                                                                                                                                                                                                                                                                                                                                                                               |

## 5. Competitors

| Product           | What they say publicly                                                                                                                                                                                                                                                                                                                                                                      | Confidence |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| SpamZilla         | Listed on the Ahrefs blog among its "most popular integrations". Third-party reviews say Ahrefs data appears when the user connects their own Ahrefs account, which matches Ahrefs Connect's end-user model. No public statement about auction-data licences was found.                                                                                                                  | Inferred   |
| ExpiredDomains.net | Shows GoDaddy expired, TDNAM, and most-active auction counts on its home page; third-party write-ups describe outbound affiliate links to the major auction houses. Its FAQ does not describe data sources or partnerships, and it offers no API.                                                                                                                                           | Inferred   |
| DomCop            | FAQ: "We import data from domain auctions, pending delete, public drop lists" and names GoDaddy, NameJet, and Dynadot. It says it "uses their API to get this data for you" for Ahrefs, Moz, Majestic, and SEMrush metrics. It has no affiliate program yet. No statement of licences with auction houses.                                                                                 | Verified (own FAQ); licensing basis unknown |

Competitors operating openly is evidence of tolerance, not of permission. None publishes a licence with Dynadot, DropCatch, or GoDaddy.

## Recommended actions

### Safe to build now

- Keep the current single-owner, local use. Every source above permits the owner's own use of their own account and API.
- Show Ahrefs DR from the free `domain-rating-free` endpoint with "Domain Rating by Ahrefs" adjacent to each value (or the column header, if Ahrefs confirms that counts as adjacent) and linked to `https://ahrefs.com/`.
- Keep the provider-neutral ingestion work; it does not depend on licensing.
- Join the Dynadot and GoDaddy affiliate programs and append referral parameters to outbound auction links. This is low risk on its own and gives each provider a reason to approve the listing display.

### Do not launch to paying customers until answered

- Dynadot listings: the terms prohibit it. Get written permission first.
- GoDaddy listings: content is licensed for internal use. Get written permission first.
- DropCatch listings: no terms either way, and programmatic systems need approval. Get written permission first.
- Ahrefs metrics other than DR: requires Ahrefs Connect admission (Enterprise plan, existing user base). Do not accept pasted customer keys.

### Emails to send

**Dynadot** (support or the affiliate team): "We run a paid expired-domain discovery tool and want to display your open expired, closeout, and backorder auctions (domain, current bid, end time, bids, appraisal) to subscribers, each linking to the Dynadot auction page with our affiliate ID. Terms §13.1(b) and (c) bar making API-derived data available to third parties. Can you grant written permission or a data or partner agreement for this use? Are there attribution, caching, refresh, or field restrictions, and which API tier should we be on?"

**DropCatch** (support): "We want to read your public auction listings through `api.dropcatch.com` V2 using a NameBright API account and show them to paying subscribers, linking each row to DropCatch. Is there an API or data licence covering this? Does this need approval under §25 of your terms? Is there an affiliate or partner program? Why does `/v2/auctions` return zero items for our account?"

**GoDaddy** (Auctions support and the developer team): "May the daily files at `inventory.auctions.godaddy.com` or Auctions API results be displayed to paying subscribers of a third-party discovery tool, with each row linking to the GoDaddy Auctions listing? The Universal Terms limit GoDaddy Content to internal business use. Is there a partner or affiliate feed licence for this? Are Valuation and Traffic Data fields excluded?"

**Ahrefs** (API or partnerships team): "We plan to show DR from `domain-rating-free` with the required attribution for every domain currently at auction, roughly N lookups per day, stored for 24 hours. Is that within the Domain Rating licence, in particular §4(b)? Does one attribution in the column header satisfy 'adjacent'? Separately, what would Ahrefs Connect admission need for a new app?"

Record each reply in this document with the date and the sender, and treat only written replies from the provider as permission.

## Sources

Retrieved 2026-10-06.

- Dynadot Terms of Use (§2, §13): https://www.dynadot.com/terms-of-use
- Dynadot API commands and rate limits: https://www.dynadot.com/domain/api-commands
- Dynadot affiliate programs: https://www.dynadot.com/affiliate
- Dynadot affiliate getting started: https://www.dynadot.com/community/help/question/affiliate-get-started
- Dynadot Ambassador restrictions: https://dynadot.com/community/help/question/restrictions-for-Ambassadors
- Dynadot Reseller Program: https://www.dynadot.com/domain/reseller-program
- Dynadot expired list download: https://www.dynadot.com/help/question/download-expired-list
- DropCatch Terms and Conditions: https://www.dropcatch.com/legal/terms
- DropCatch backorder API examples: https://github.com/NameBright/DropCatchBackorderExamples
- NameBright Terms of Service: https://www.namebright.com/terms
- GoDaddy API Terms of Use: https://www.godaddy.com/en/legal/agreements/godaddy-api-terms-of-use
- GoDaddy Universal Terms of Service: https://www.godaddy.com/legal/agreements/universal-terms-of-service-agreement
- GoDaddy Auctions Membership Agreement: https://www.godaddy.com/legal/agreements/auctions-membership-agreement
- GoDaddy Auctions API overview: https://developer.godaddy.com/llms.mdx/api-users/auctions
- GoDaddy API authentication and account requirements: https://developer.godaddy.com/llms.mdx/api-users/auth
- GoDaddy inventory files help: https://www.godaddy.com/help/download-inventory-files-for-godaddy-auctions-41284
- GoDaddy Auctions inventory: https://inventory.auctions.godaddy.com/
- GoDaddy affiliate program: https://www.godaddy.com/affiliate-programs
- Ahrefs Domain Rating licence: https://ahrefs.com/legal/domain-rating-license
- Ahrefs free DR endpoint: https://docs.ahrefs.com/en/api/reference/public/post-domain-rating-free
- Ahrefs Connect Terms of Service: https://docs.ahrefs.com/ahrefs-connect/docs/terms-of-service
- Ahrefs Connect introduction: https://docs.ahrefs.com/ahrefs-connect/docs/introduction
- Ahrefs Terms of Service: https://ahrefs.com/legal/terms
- Ahrefs integrations (SpamZilla listing): https://ahrefs.com/blog/ahrefs-integrations
- DomCop FAQ: https://www.domcop.com/faq
- ExpiredDomains.net: https://www.expireddomains.net/

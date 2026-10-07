# Dynadot data licensing

Researched 2026-10-06 for #28. Research, not legal advice; see the [summary](README.md) for the question and confidence labels.

The ingestion uses the api3 `get_open_auctions` command with the owner's API key. The API documentation carries no separate API terms; the API is governed by section 13 of the Dynadot Terms of Use.

| Question | Answer |
| --- | --- |
| Allowed? | **No**, without Dynadot's written agreement. The terms prohibit making API-derived data available to third parties or embedding it in other applications. |
| Conditions | Rate limits by account tier: regular accounts 1 thread, "60/min (1/sec)"; bulk 600/min; super bulk 6000/min. Site content is also protected separately (section 2). |
| Evidence | Terms of Use §13.1(b): you shall not "make available the API (or … any data derived out of its use) to third parties". §13.1(c): shall not "embed or incorporate … any data derived out of its use) into other applications". §2.1: "The copying, redistribution, use or publication by You of any such content" is prohibited. §13.1(i) bars using API code to build something "competitive with the API". |
| Affiliate | Dynadot runs two mutually exclusive programs (CJ Affiliate, or the in-house Ambassador Program). Expired, expired-closeout, and backorder auctions pay 15% on won auctions within a 30-day cookie. Ambassador restrictions forbid paid search on Dynadot terms and using "Dynadot's name, brand terms, or URLs in display URLs". The affiliate pages describe referral links only; they do not grant a data feed or a licence to republish listings. |
| Reseller | The Reseller Program is a white-label registrar backend (registration, transfer, renewal, DNS). Nothing found says it covers aftermarket listing data. |
| Confidence | **Verified** for the prohibition. **Inferred** that an affiliate or reseller relationship would not by itself change it. |

The public Expired Auctions page offers a manual CSV download, but that is still site content under §2.

## Email to send

To support or the affiliate team: "We run a paid expired-domain discovery tool and want to display your open expired, closeout, and backorder auctions (domain, current bid, end time, bids, appraisal) to subscribers, each linking to the Dynadot auction page with our affiliate ID. Terms §13.1(b) and (c) bar making API-derived data available to third parties. Can you grant written permission or a data or partner agreement for this use? Are there attribution, caching, refresh, or field restrictions, and which API tier should we be on?"

## Sources

Retrieved 2026-10-06.

- Dynadot Terms of Use (§2, §13): https://www.dynadot.com/terms-of-use
- Dynadot API commands and rate limits: https://www.dynadot.com/domain/api-commands
- Dynadot affiliate programs: https://www.dynadot.com/affiliate
- Dynadot affiliate getting started: https://www.dynadot.com/community/help/question/affiliate-get-started
- Dynadot Ambassador restrictions: https://dynadot.com/community/help/question/restrictions-for-Ambassadors
- Dynadot Reseller Program: https://www.dynadot.com/domain/reseller-program
- Dynadot expired list download: https://www.dynadot.com/help/question/download-expired-list

# NameSilo data licensing

Researched 2026-10-07 for #83, from public pages and a 10-request probe with the owner's key. Research, not legal advice; see the [summary](README.md) for the question and confidence labels.

NameSilo runs expired-domain auctions (days 5 to 41 after expiry, cancelled if the owner renews before day 31) and customer auctions on its own marketplace. The official API has a `listAuctions` operation. The key is "available to all users", generated in API Manager, shown once, and sent in the query string of a GET. It can be restricted to up to 5 IP addresses; Cloudflare Workers have no fixed IP, so that list stays empty.

| Question | Answer |
| --- | --- |
| Allowed? | **Not addressed.** The general terms say nothing about using API data or showing it to others. |
| Conditions | NameSilo's batch-processing policy says automated, repetitive calls "must ONLY use /apibatch", with "API and/or account suspension" for violations. **Satisfied by `/public/apibatch/`**: the probe confirmed `GET https://www.namesilo.com/public/apibatch/listAuctions` works, while `/apibatch/listAuctions` answers code 107. No rate limit is published, so requests are paced at one every 2 seconds ([Provider rate limits](../../technical-design/provider-rate-limits.md)). |
| Not used | The marketplace's internal `/auctions/api/search` JSON and its CSV export (`robots.txt` disallows `/auctions/*`, Cloudflare protects them, and they are undocumented), and the RSS feed, which answers 403. |
| Confidence | **Inferred.** The official API is open to every account holder, but silence is not permission to republish its data. |

**Current use (2026-10-07, #83):** `pnpm sync namesilo` reads expired and customer auctions through `/public/apibatch/listAuctions` into the owner's local D1 for the owner's own use, and every row links back to its NameSilo auction page. The daily production sync runs it once `NAMESILO_API_KEY` is set as a Worker secret.

## Questions for NameSilo support

Not yet sent. Ask whether `/apibatch` is the right path for `listAuctions`, what the maximum `pageSize` (500 in practice) and the rate limit are, and whether daily read-only aggregation shown to paying subscribers, each row linking to the NameSilo auction, is acceptable (#28). Record the reply here with its date and sender.

## Sources

Retrieved 2026-10-07.

- NameSilo API reference: https://www.namesilo.com/api-reference
- NameSilo marketplace auctions: https://www.namesilo.com/auctions
- Research and probe notes: issue #83

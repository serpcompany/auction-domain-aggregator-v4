# Namecheap data licensing

Researched 2026-10-07 for #71. Research, not legal advice; see the [summary](README.md) for the question and confidence labels.

Namecheap runs its own expired-domain auctions (it stopped sending expired names to GoDaddy Auctions in 2021) on Namecheap Market. The auctions page (`namecheap.com/market/auctions/`) links "Export all current domain auctions to CSV" to a public file at `https://d3ry1h4w5036x1.cloudfront.net/reports/Namecheap_Market_Sales.csv`. No login is needed, and the knowledge base says it is refreshed once per hour. The Market Auctions API (`aftermarketapi.namecheap.com`, Bearer key, phone-verified Market account) carries the same sales, but its rate limits are not documented. The classic Namecheap API has no auction data.

| Question | Answer |
| --- | --- |
| Allowed? | **Not addressed.** No licence covers the CSV, and no clause addresses showing listings to third parties. |
| Conditions | The Universal Terms of Service cover "platforms, APIs". They forbid using them to "abuse and/or overload", including "repetitive, high volume requests", and forbid harvesting user content without permission. One download a day is not high volume. Rows with `isPartnerSale=1` are cross-listed from partner registrars' platforms. |
| Evidence | Universal ToS (`namecheap.com/legal/universal/universal-tos/`); Domain Market agreement (`namecheap.com/legal/domains/marketplace-agreement/`), which has no clause on scraping or redistribution; `robots.txt` does not disallow `/market/`. |
| Confidence | **Inferred.** Namecheap publishes the file for anyone to download, but silence is not permission to republish it. |

**Current use (2026-10-07, #71):** `pnpm sync namecheap` downloads the CSV once per run into the owner's local D1 for the owner's own use, and every row links back to its Namecheap sale page. That includes the file's Majestic, Semrush, and Estibot values. Its Ahrefs Domain Rating column is not stored.

**Owner decision (2026-10-07):** the owner approved showing Namecheap listings to paying customers, each row linking back to its Namecheap sale page. This is the owner's call on the terms' silence, not written permission from Namecheap. Revisit it if Namecheap publishes terms for the file or objects.

## Sources

- Namecheap Universal Terms of Service: https://www.namecheap.com/legal/universal/universal-tos/
- Namecheap Domain Market agreement: https://www.namecheap.com/legal/domains/marketplace-agreement/
- Namecheap Market auctions: https://www.namecheap.com/market/auctions/

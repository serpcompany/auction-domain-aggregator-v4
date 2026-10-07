# Data licensing for a paid product

Researched 2026-10-06 for #28; Namecheap added 2026-10-07 for #71, NameSilo for #83.

**This is research, not legal advice.** It records what each provider's published terms say about showing their listing data to paying customers. Terms change; re-read the linked documents before relying on them, and get written permission or legal review before a paid launch.

## Question

The product is moving from a single-owner tool to a paid SaaS ($27/month, one plan). It would show auction listings from Dynadot, DropCatch, and GoDaddy to paying customers, link each row to the provider's auction page, and may show Ahrefs Domain Rating (DR). For each source: may data obtained through its API or feeds be shown to third-party paying customers, and under what conditions?

Confidence labels:

- **Verified**: a clause in the provider's published terms answers the question directly.
- **Inferred**: no clause answers it directly; the conclusion is drawn from general clauses, silence, or secondary sources.

## Summary

Each source's leaf holds the clauses, affiliate programs, the email to send, and its sources.

| Source | Allowed for paying customers? | Confidence |
| --- | --- | --- |
| [Dynadot API](dynadot.md) | No, not without written permission | Verified |
| [DropCatch API](dropcatch.md) | Not addressed; ask first | Inferred |
| [GoDaddy API and inventory](godaddy.md) | Not granted; content licensed for internal use | Verified |
| [Namecheap market sales CSV](namecheap.md) | Yes, by the owner's decision (2026-10-07) | Inferred |
| [NameSilo API](namesilo.md) | Not addressed; ask first. Batch policy met by `/public/apibatch/` | Inferred |
| [Ahrefs Domain Rating (DR API)](ahrefs.md) | Yes, with attribution and link | Verified |
| [Other Ahrefs metrics](ahrefs.md#other-ahrefs-metrics-and-bring-your-own-key) | Only through Ahrefs Connect (Enterprise, OAuth) | Verified |
| Linking out to auction pages | No clause against plain links; affiliate links OK | Inferred |

[Competitors](competitors.md) operate openly, which is evidence of tolerance, not of permission. Each provider's rate limit, the interval the ingestion enforces, and when it was verified are in [Provider rate limits](../../technical-design/provider-rate-limits.md).

## Recommended actions

### Safe to build now

- Namecheap listings from the public market sales CSV, linked back to each sale (owner decision, 2026-10-07).
- Keep the current single-owner, local use. Every source above permits the owner's own use of their own account and API.
- Show Ahrefs DR from the free `domain-rating-free` endpoint with "Domain Rating by Ahrefs" adjacent to each value (or the column header, if Ahrefs confirms that counts as adjacent) and linked to `https://ahrefs.com/`.
- Keep the provider-neutral ingestion work; it does not depend on licensing.
- Join the Dynadot and GoDaddy affiliate programs and append referral parameters to outbound auction links. This is low risk on its own and gives each provider a reason to approve the listing display.

### Do not launch to paying customers until answered

- Dynadot listings: the terms prohibit it. Get written permission first.
- GoDaddy listings: content is licensed for internal use. Get written permission first.
- DropCatch listings: no terms either way, and programmatic systems need approval. Get written permission first.
- NameSilo listings: the terms are silent on showing API data to others. Ask support first.
- Ahrefs metrics other than DR: requires Ahrefs Connect admission (Enterprise plan, existing user base). Do not accept pasted customer keys.

### Replies

Each provider leaf has the email to send. Record each reply in that leaf with the date and the sender, and treat only written replies from the provider as permission.

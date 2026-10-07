# DropCatch data licensing

Researched 2026-10-06 for #28. Research, not legal advice; see the [summary](README.md) for the question and confidence labels.

DropCatch (TurnCommerce, with NameBright as registrar) authenticates API users through NameBright API accounts (`auth.tcdevops.com` bearer tokens). The only public API documentation found covers backordering (`NameBright/DropCatchBackorderExamples` on GitHub). No public API terms, developer agreement, or listing-feed licence was found. `api.dropcatch.com/swagger` returns 403 to anonymous requests.

| Question | Answer |
| --- | --- |
| Allowed? | **Not addressed.** The DropCatch Terms and Conditions (42 sections) and the NameBright Terms of Service (revised 2026-04-09) contain no clause on API data use, scraping, redistribution, or republishing listings. |
| Conditions | §25 Gamification: automated systems "must first be presented to DropCatch and approved" (written about bidding, but the only clause on programmatic use). An unapproved integration could be treated as a breach, and the terms say breaches suspend both DropCatch and NameBright accounts. |
| Evidence | DropCatch Terms and Conditions, served at `dropcatch.com/legal/terms`; NameBright Terms of Service. |
| Affiliate | No DropCatch affiliate or partner program was found. The terms mention "Corporate Partner" backorders, which is a backorder priority tier, not a data or referral partnership. |
| Confidence | **Inferred.** Silence is not permission. The repository's earlier probe also found the V2 auctions endpoint returned zero items for this account (see [Dynadot domain table](../../plans/completed/dynadot-domain-table.md)). |

## Email to send

To support: "We want to read your public auction listings through `api.dropcatch.com` V2 using a NameBright API account and show them to paying subscribers, linking each row to DropCatch. Is there an API or data licence covering this? Does this need approval under §25 of your terms? Is there an affiliate or partner program? Why does `/v2/auctions` return zero items for our account?"

## Sources

Retrieved 2026-10-06.

- DropCatch Terms and Conditions: https://www.dropcatch.com/legal/terms
- DropCatch backorder API examples: https://github.com/NameBright/DropCatchBackorderExamples
- NameBright Terms of Service: https://www.namebright.com/terms

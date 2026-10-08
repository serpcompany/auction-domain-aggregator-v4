# Ahrefs data licensing

Researched 2026-10-06 for #28. Research, not legal advice; see the [summary](README.md) for the question and confidence labels.

## Domain Rating

Ahrefs published a separate Domain Rating licence (last modified 2026-06-11) and a free endpoint, `POST /v3/public/domain-rating-free`, which takes up to 1,000 targets per request and consumes no API units. "Requests to this endpoint are free, yet require an APIv3 key", which any free Ahrefs account can generate.

| Question | Answer |
| --- | --- |
| Allowed? | **Yes.** The licence grants a worldwide, royalty-free, revocable right to "use, display, publish or integrate DR Data into or within your products and services". |
| Conditions | Every display must carry the attribution "Domain Rating by Ahrefs", clear, legible, adjacent to the value, with a working hyperlink to `https://ahrefs.com/`, and it "shall not be hidden, obscured or removed". Do not "re-package, sell or distribute DR Data in its original form" or as a substitute or competing product. Do not "harvest DR Data in bulk or systematically in order to compile, reconstruct" a competing dataset or index. Ahrefs may rate-limit, throttle, or withdraw the endpoint without notice. |
| Evidence | Domain Rating License Terms of Use §§1 to 5; Ahrefs API reference for `domain-rating-free`. |
| Confidence | **Verified** for display with attribution. **Inferred** risk: looking up DR for every auction domain each day and storing it could be read as systematic bulk harvesting under §4(b) if Ahrefs sees the result as a competing index. Ask Ahrefs about volume before building it. |
| Decision | 2026-10-08: the owner chose to build the daily DR backfill for the whole inventory while the site is owner-only, accepting this risk before asking Ahrefs. The email below is still unsent. |

## Other Ahrefs metrics and "bring your own key"

| Question | Answer |
| --- | --- |
| Allowed? | **Only through Ahrefs Connect**, and only back to the same customer. Using the owner's own paid Ahrefs key to show metrics to customers is not permitted: the general Terms of Service licence is "solely for the purposes of your internal business operations" (§12.4). |
| Conditions | Connect eligibility: the app "must be a publicly available product with an existing user base"; "For any new integration with Ahrefs Connect, you will require an Ahrefs Enterprise Plan"; admission is at Ahrefs' discretion. End users must hold "active and paid Ahrefs accounts" and authorise via OAuth; their own API units are consumed. "Do not display Ahrefs Data to anyone other than the End User." "Do not reconstruct datasets or maintain shadow databases of Ahrefs Data." Caches must be purged on revocation. No substitute or competing features. |
| BYO key | Ahrefs Connect is the sanctioned way for a third-party app to use a customer's Ahrefs account. Legacy integrations were deprecated on 2025-11-01. Customers pasting their own API keys into the app is not addressed by any clause found; it sidesteps Connect's eligibility and audit terms, and Connect §8 forbids using "multiple apps/keys to bypass limits". |
| Evidence | Ahrefs Connect Terms of Service §§1 to 8; Ahrefs Connect introduction; Ahrefs Terms of Service §§4.4(i), 4.4(j), 4.4(l), 12.4. |
| Confidence | **Verified** for Connect rules and internal-use limit. **Inferred** that pasted BYO keys are unsafe. |

## Email to send

To the API or partnerships team: "We plan to show DR from `domain-rating-free` with the required attribution for every domain currently at auction, roughly N lookups per day, stored for 24 hours. Is that within the Domain Rating licence, in particular §4(b)? Does one attribution in the column header satisfy 'adjacent'? Separately, what would Ahrefs Connect admission need for a new app?"

## Sources

Retrieved 2026-10-06.

- Ahrefs Domain Rating licence: https://ahrefs.com/legal/domain-rating-license
- Ahrefs free DR endpoint: https://docs.ahrefs.com/en/api/reference/public/post-domain-rating-free
- Ahrefs Connect Terms of Service: https://docs.ahrefs.com/ahrefs-connect/docs/terms-of-service
- Ahrefs Connect introduction: https://docs.ahrefs.com/ahrefs-connect/docs/introduction
- Ahrefs Terms of Service: https://ahrefs.com/legal/terms

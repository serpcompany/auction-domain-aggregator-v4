# GoDaddy data licensing

Researched 2026-10-06 for #28. Research, not legal advice; see the [summary](README.md) for the question and confidence labels.

Three relevant documents: the GoDaddy API Terms of Use (revised 2026-07-07), the Universal Terms of Service (revised 2026-03-06), and the Auctions Membership Agreement (revised 2025-08-29). The public inventory files at `inventory.auctions.godaddy.com` (39 zipped JSON, XML, and CSV files, refreshed daily, no login) display no terms of their own.

| Question | Answer |
| --- | --- |
| Allowed? | **Not granted.** GoDaddy Content, which includes "GoDaddy data", is licensed only for internal business use and may not be redistributed or displayed except as expressly permitted. Neither the API Terms nor the inventory page grants republishing rights. |
| Conditions | API: "each API endpoint is limited to sixty (60) requests per minute"; use "only in connection with … data that you are authorized to access or manage"; you "may not resell, sublicense, provide, or otherwise make the API or API access available" to third parties without written authorisation; you may not imply your app is "sponsored by, endorsed by, or affiliated with GoDaddy". The Auctions API needs a classic `sso-key` developer key and is built for availability checks, bidding, and buy-now purchases, not catalogue export. |
| Evidence | Universal Terms of Service: GoDaddy Content is provided "for your internal business purposes in connection with your authorized use"; "GoDaddy Content may not be downloaded, copied, reproduced, distributed, transmitted, displayed, sold" except as permitted; you "will not copy or distribute in any medium any part of this Site"; you will not access GoDaddy Content by means "other than through this Site itself, or as GoDaddy may designate". Auctions Membership Agreement: Traffic Data and Valuation are "for informational purposes only", and buyers agree "not to purchase any domain name found through the Services without using the Services". |
| Affiliate | GoDaddy's affiliate program runs through CJ Affiliate (advertiser 1513033) and offers banner ads and text links. The public page does not mention auctions or a listing feed; the CJ publisher agreement was not reviewed because it requires sign-up. |
| Confidence | **Verified** that no republishing right is granted and that content is internal-use. **Inferred** that GoDaddy tolerates third-party display in practice, because ExpiredDomains.net publicly lists GoDaddy auction counts sourced from these feeds. |

The inventory download page is arguably a way of access GoDaddy "may designate", but that only covers access, not the internal-use limit on what you may do with the content.

**Current use (2026-10-06, #16):** `pnpm sync godaddy` downloads `all_biddable_auctions.json.zip` from these public files into the owner's local D1 for the owner's own use, which is internal use. That includes the file's Majestic and SEMrush metrics. Nothing from it may be shown to other people, including paying customers, until GoDaddy grants written permission.

## Email to send

To Auctions support and the developer team: "May the daily files at `inventory.auctions.godaddy.com` or Auctions API results be displayed to paying subscribers of a third-party discovery tool, with each row linking to the GoDaddy Auctions listing? The Universal Terms limit GoDaddy Content to internal business use. Is there a partner or affiliate feed licence for this? Are Valuation and Traffic Data fields excluded?"

## Sources

Retrieved 2026-10-06.

- GoDaddy API Terms of Use: https://www.godaddy.com/en/legal/agreements/godaddy-api-terms-of-use
- GoDaddy Universal Terms of Service: https://www.godaddy.com/legal/agreements/universal-terms-of-service-agreement
- GoDaddy Auctions Membership Agreement: https://www.godaddy.com/legal/agreements/auctions-membership-agreement
- GoDaddy Auctions API overview: https://developer.godaddy.com/llms.mdx/api-users/auctions
- GoDaddy API authentication and account requirements: https://developer.godaddy.com/llms.mdx/api-users/auth
- GoDaddy inventory files help: https://www.godaddy.com/help/download-inventory-files-for-godaddy-auctions-41284
- GoDaddy Auctions inventory: https://inventory.auctions.godaddy.com/
- GoDaddy affiliate program: https://www.godaddy.com/affiliate-programs

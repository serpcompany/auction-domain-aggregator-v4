# Ahrefs, Moz, and SEMrush filters

Third-party SEO metric ranges, including the first Backlinks panel of Ahrefs-derived counts. Part of the [SpamZilla filter reference](README.md), extracted from the supplied SpamZilla filter interface HTML; field names are preserved exactly as submitted by the form.

## Ahrefs

| Filter | Filter type | From field | To field | Constraints/defaults |
|---|---|---|---|---|
| Ahrefs DR | Numeric range | `Filter[ahrefs_dr_from]` | `Filter[ahrefs_dr_to]` | minimum 0; requires connected Ahrefs account for table data |
| Ahrefs UR | Numeric range | `Filter[ahrefs_rank_from]` | `Filter[ahrefs_rank_to]` | minimum 0 |
| Backlinks | Numeric range | `Filter[ahrefs_backlinks_from]` | `Filter[ahrefs_backlinks_to]` | minimum 0 |
| Domains | Numeric range | `Filter[ahrefs_domains_from]` | `Filter[ahrefs_domains_to]` | minimum 0 |
| Positions | Numeric range | `Filter[ahrefs_positions_from]` | `Filter[ahrefs_positions_to]` | minimum 0 |
| Traffic | Numeric range | `Filter[ahrefs_traffic_from]` | `Filter[ahrefs_traffic_to]` | minimum 0 |

## Backlinks

This is the first Backlinks panel in the UI, containing Ahrefs-derived backlink-type counts.

| Filter | Filter type | From field | To field | Constraints/defaults |
|---|---|---|---|---|
| IPs | Numeric range | `Filter[ahrefs_ips_from]` | `Filter[ahrefs_ips_to]` | minimum 0 |
| Subnets | Numeric range | `Filter[ahrefs_subnets_from]` | `Filter[ahrefs_subnets_to]` | minimum 0 |
| DoFollow | Numeric range | `Filter[ahrefs_dofollow_from]` | `Filter[ahrefs_dofollow_to]` | minimum 0 |
| NoFollow | Numeric range | `Filter[ahrefs_nofollow_from]` | `Filter[ahrefs_nofollow_to]` | minimum 0 |
| Text | Numeric range | `Filter[ahrefs_text_from]` | `Filter[ahrefs_text_to]` | minimum 0 |
| Gov | Numeric range | `Filter[ahrefs_gov_from]` | `Filter[ahrefs_gov_to]` | minimum 0 |
| Edu | Numeric range | `Filter[ahrefs_edu_from]` | `Filter[ahrefs_edu_to]` | minimum 0 |

## Moz

| Filter | Filter type | From field | To field | Constraints/defaults |
|---|---|---|---|---|
| DA | Numeric range | `Filter[moz_da_from]` | `Filter[moz_da_to]` | minimum 0 |
| PA | Numeric range | `Filter[moz_pa_from]` | `Filter[moz_pa_to]` | minimum 0 |

## SEMRush

| Filter | Filter type | From field | To field | Constraints/defaults |
|---|---|---|---|---|
| Rank | Numeric range | `Filter[semrush_rank_from]` | `Filter[semrush_rank_to]` | minimum 0 |
| Traffic | Numeric range | `Filter[semrush_traffic_from]` | `Filter[semrush_traffic_to]` | minimum 0 |
| Keywords | Numeric range | `Filter[semrush_keywords_from]` | `Filter[semrush_keywords_to]` | minimum 0 |

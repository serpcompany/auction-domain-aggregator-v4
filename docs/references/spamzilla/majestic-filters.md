# Majestic filters

Majestic category, metric ranges, and site and anchor languages. Part of the [SpamZilla filter reference](README.md), extracted from the supplied SpamZilla filter interface HTML; field names are preserved exactly as submitted by the form.

## Majestic

### Category

- **Filter type:** single-select dropdown
- **Field:** `Filter[majestic_topics]`
- **Options (17):**
  - `All Categories`
  - Adult — value `0`
  - Arts — value `1`
  - Business — value `2`
  - Computers — value `3`
  - Games — value `4`
  - Health — value `5`
  - Home — value `6`
  - News — value `7`
  - Recreation — value `8`
  - Reference — value `9`
  - Regional — value `10`
  - Science — value `11`
  - Shopping — value `12`
  - Society — value `13`
  - Sports — value `14`
  - World — value `15`

### Sub Category

- **Filter type:** dynamic single-select dropdown
- **Field:** `Filter[majestic_sub_topics]`
- **Options (1):**
  - `Choose Sub Category`

| Filter | Filter type | From field | To field | Constraints/defaults |
|---|---|---|---|---|
| CF | Numeric range | `Filter[majestic_cf_from]` | `Filter[majestic_cf_to]` | minimum 0 |
| TF | Numeric range | `Filter[majestic_tf_from]` | `Filter[majestic_tf_to]` | minimum 0 |
| TF/CF Ratio | Numeric range | `Filter[majestic_tf_cf_ratio_from]` | `Filter[majestic_tf_cf_ratio_to]` | minimum 0 |
| Links | Numeric range | `Filter[majestic_links_from]` | `Filter[majestic_links_to]` | minimum 0 |
| Domains | Numeric range | `Filter[majestic_domains_from]` | `Filter[majestic_domains_to]` | minimum 0 |
| Out Links Internal | Numeric range | `Filter[out_links_internal_from]` | `Filter[out_links_internal_to]` | minimum 0 |
| Out Links External | Numeric range | `Filter[out_links_external_from]` | `Filter[out_links_external_to]` | minimum 0 |
| Out Domains External | Numeric range | `Filter[out_domains_external_from]` | `Filter[out_domains_external_to]` | minimum 0 |
| IPs | Numeric range | `Filter[majestic_ips_from]` | `Filter[majestic_ips_to]` | minimum 0 |
| Subnets | Numeric range | `Filter[majestic_subnets_from]` | `Filter[majestic_subnets_to]` | minimum 0 |
| EDU Dom | Numeric range | `Filter[majestic_edu_dom_from]` | `Filter[majestic_edu_dom_to]` | minimum 0 |
| EDU Links | Numeric range | `Filter[majestic_edu_links_from]` | `Filter[majestic_edu_links_to]` | minimum 0 |
| GOV Dom | Numeric range | `Filter[majestic_gov_dom_from]` | `Filter[majestic_gov_dom_to]` | minimum 0 |
| GOV Links | Numeric range | `Filter[majestic_gov_links_from]` | `Filter[majestic_gov_links_to]` | minimum 0 |

## Select Majestic Languages

### Site Language

- **Filter type:** multi-select checkboxes
- **Field:** `Filter[site_languages][]`
- **Options (65):**
  - `Blank`
  - `af`
  - `sq`
  - `am`
  - `ar`
  - `az`
  - `bn`
  - `bh`
  - `bg`
  - `my`
  - `cs`
  - `zh`
  - `da`
  - `nl`
  - `en`
  - `et`
  - `fi`
  - `fr`
  - `gl`
  - `de`
  - `el`
  - `gu`
  - `ha`
  - `iw`
  - `hi`
  - `hu`
  - `id`
  - `ga`
  - `it`
  - `jw`
  - `ja`
  - `kn`
  - `kz`
  - `ko`
  - `lv`
  - `lt`
  - `ms`
  - `ml`
  - `gv`
  - `mr`
  - `no`
  - `or`
  - `om`
  - `ps`
  - `fa`
  - `pl`
  - `pt`
  - `pa`
  - `ro`
  - `ru`
  - `sr`
  - `sd`
  - `sk`
  - `es`
  - `sv`
  - `tl`
  - `te`
  - `th`
  - `tr`
  - `uk`
  - `ur`
  - `uz`
  - `vi`
  - `cy`
  - `yo`

### Anchor Language

- **Filter type:** multi-select checkboxes
- **Field:** `Filter[anchor_languages][]`
- **Options (65):**
  - `Blank`
  - `af`
  - `sq`
  - `am`
  - `ar`
  - `az`
  - `bn`
  - `bh`
  - `bg`
  - `my`
  - `cs`
  - `zh`
  - `da`
  - `nl`
  - `en`
  - `et`
  - `fi`
  - `fr`
  - `gl`
  - `de`
  - `el`
  - `gu`
  - `ha`
  - `iw`
  - `hi`
  - `hu`
  - `id`
  - `ga`
  - `it`
  - `jw`
  - `ja`
  - `kn`
  - `kz`
  - `ko`
  - `lv`
  - `lt`
  - `ms`
  - `ml`
  - `gv`
  - `mr`
  - `no`
  - `or`
  - `om`
  - `ps`
  - `fa`
  - `pl`
  - `pt`
  - `pa`
  - `ro`
  - `ru`
  - `sr`
  - `sd`
  - `sk`
  - `es`
  - `sv`
  - `tl`
  - `te`
  - `th`
  - `tr`
  - `uk`
  - `ur`
  - `uz`
  - `vi`
  - `cy`
  - `yo`

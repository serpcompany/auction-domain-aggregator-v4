# Backlink filters

The second Backlinks panel: anchor keywords, referring domains, and backlink-source TLDs. Part of the [SpamZilla filter reference](README.md), extracted from the supplied SpamZilla filter interface HTML; field names are preserved exactly as submitted by the form.

## Backlinks

This is the second Backlinks panel in the UI, containing advanced anchor/domain/TLD filters.

| Filter | Filter type | Field(s) | Constraints/defaults |
|---|---|---|---|
| Keywords Search | Text list | `Filter[backlinks_keywords]` | comma-separated anchor-text keywords; maximum 20 |
| Include Domains | Text list | `Filter[include_domains]` | comma-separated referring authority domains; maximum 20 |
| Exclude Domains | Text list | `Filter[exclude_domains]` | comma-separated referring domains to exclude; maximum 20 |
| Number of links where DR above | Compound numeric condition | `Filter[dr_backlinks_amount]`, `Filter[dr_backlinks_rank]` | both 1–100 |
| Number of links with selected TLDs | Minimum numeric input | `Filter[backlinks_tlds_amount]` | 1–100 |
| Include backlink-source TLDs | Multi-select checkboxes | `Filter[backlinks_tlds][]` | split into Major TLDs and Country TLDs below |

### Major TLDs

- **Filter type:** multi-select checkboxes
- **Field:** `Filter[backlinks_tlds][]`
- **Options (5):**
  - `.com`
  - `.net`
  - `.biz`
  - `.info`
  - `.org`

### Country TLDs

- **Filter type:** multi-select checkboxes
- **Field:** `Filter[backlinks_tlds][]`
- **Options (52):**
  - `.at`
  - `.be`
  - `.ca`
  - `.cc`
  - `.cl`
  - `.co`
  - `.co.nz`
  - `.co.uk`
  - `.co.za`
  - `.com.ar`
  - `.com.au`
  - `.com.mx`
  - `.com.pl`
  - `.com.tr`
  - `.com.ua`
  - `.cz`
  - `.de`
  - `.dk`
  - `.ee`
  - `.eu`
  - `.fi`
  - `.fr`
  - `.ga`
  - `.hk`
  - `.hr`
  - `.hu`
  - `.ie`
  - `.in`
  - `.io`
  - `.ir`
  - `.is`
  - `.it`
  - `.kr`
  - `.kz`
  - `.lv`
  - `.ma`
  - `.me`
  - `.mx`
  - `.net.au`
  - `.nl`
  - `.no`
  - `.nu`
  - `.pl`
  - `.ro`
  - `.ru`
  - `.se`
  - `.sg`
  - `.sk`
  - `.su`
  - `.tk`
  - `.tv`
  - `.tw`

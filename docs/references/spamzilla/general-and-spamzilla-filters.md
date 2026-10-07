# General and SpamZilla filters

The Columns control, general auction and domain filters, and SpamZilla's own metrics. Part of the [SpamZilla filter reference](README.md), extracted from the supplied SpamZilla filter interface HTML; field names are preserved exactly as submitted by the form.

## Columns

| Control | Type | Notes |
|---|---|---|
| Columns | Modal/dialog button | Selects which columns are displayed in the main domain table. This is a display control, not a domain-result filter. |

## General

| Filter | Filter type | Field(s) | Constraints/defaults |
|---|---|---|---|
| Auction Ends | Date range | `Filter[auction_ends_from]`, `Filter[auction_ends_to]` | Datepicker-backed text inputs |
| Domain Added | Date range | `Filter[domain_added_from]`, `Filter[domain_added_to]` | Datepicker-backed text inputs |
| Price | Numeric range | `Filter[price_from]`, `Filter[price_to]` | minimum 0 |
| Domain Length | Numeric range | `Filter[domain_length_from]`, `Filter[domain_length_to]` | minimum 3 |
| Domains per Page | Single-select dropdown | `Filter[per-page]` | options: 25, 50, 75, 100, 200 |
| Added Period | Radio group | `Filter[added_period]` | options listed below; default `all_domains` |
| Expires in 24 hours | Checkbox | `Filter[expiry_period]` | checked value `1` |
| Allow Numbers | Checkbox | `Filter[allow_numbers]` | checked value `1`; default checked |
| Allow Dashes | Checkbox | `Filter[allow_dashes]` | checked value `1`; default checked |
| Google Index | Checkbox | `Filter[google_index]` | checked value `1` |
| Processed by SpamZilla | Checkbox | `Filter[processed_sz]` | checked value `1` |
| Remove Reviewed | Checkbox | `Filter[remove_reviewed]` | checked value `1` |
| Remove Watch List | Checkbox | `Filter[remove_watchlist]` | checked value `1` |

### Domains per Page

- **Filter type:** single-select dropdown
- **Field:** `Filter[per-page]`
- **Options (5):**
  - `25`
  - `50`
  - `75`
  - `100`
  - `200`

### Added Period

- **Filter type:** radio group
- **Field:** `Filter[added_period]`
- **Options (4):**
  - All Domains — value `all_domains`
  - Added last 24 hours — value `last_24_hours`
  - Added last 7 days — value `last_7_days`
  - Added last 30 days — value `last_30_days`

## SpamZilla

| Filter | Filter type | From field | To field | Constraints/defaults |
|---|---|---|---|---|
| SZ Score | Numeric range | `Filter[sz_score_from]` | `Filter[sz_score_to]` | minimum 0 |
| SZ Redirects | Numeric range | `Filter[sz_redirects_from]` | `Filter[sz_redirects_to]` | minimum 0 |
| SZ Parked | Numeric range | `Filter[sz_parked_from]` | `Filter[sz_parked_to]` | minimum 0 |
| SZ A/History | Numeric range | `Filter[sz_activehistory_from]` | `Filter[sz_activehistory_to]` | minimum 0 |
| SZ Age | Numeric range | `Filter[sz_age_from]` | `Filter[sz_age_to]` | minimum 0 |
| DNS Changes | Numeric range | `Filter[dns_changes_from]` | `Filter[dns_changes_to]` | minimum 0 |
| SZ Drops | Numeric range | `Filter[sz_drops_from]` | `Filter[sz_drops_to]` | minimum 0 |

| Filter | Filter type | Field | Constraints/defaults |
|---|---|---|---|
| Drop Date | Year dropdown | `Filter[last_drop_year]` | blank or years listed below |
| Min Indexed Pages | Minimum numeric input | `Filter[min_indexed_pages]` | minimum 0 |

### Drop Date

- **Filter type:** single-select year dropdown
- **Field:** `Filter[last_drop_year]`
- **Options (26):**
  - *(blank / any)*
  - `2002`
  - `2003`
  - `2004`
  - `2005`
  - `2006`
  - `2007`
  - `2008`
  - `2009`
  - `2010`
  - `2011`
  - `2012`
  - `2013`
  - `2014`
  - `2015`
  - `2016`
  - `2017`
  - `2018`
  - `2019`
  - `2020`
  - `2021`
  - `2022`
  - `2023`
  - `2024`
  - `2025`
  - `2026`

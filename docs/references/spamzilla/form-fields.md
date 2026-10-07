# Filter actions and form fields

The filter action buttons, hidden form fields, and every distinct submitted field name. Part of the [SpamZilla filter reference](README.md), extracted from the supplied SpamZilla filter interface HTML; field names are preserved exactly as submitted by the form.

## Filter Actions

| Action | Control type | Notes |
|---|---|---|
| Apply Filter | Button | Applies current filter state. |
| Save Filter | Button/modal | Saves the current filter configuration. |
| Reset Filter | Button | Clears or restores defaults. |
| Load Filter | Button/modal | Loads a saved filter configuration. |

## Internal / Non-visible Form Fields

| Field | Type | Purpose visible from HTML |
|---|---|---|
| `Filter[keyword]` | Hidden input | Stores the keyword-search value submitted with the filter form. |
| `quick_filter_id` | Hidden input | Stores the loaded/saved quick-filter identifier. |

## Distinct Submitted Field Names

- `Filter[tlds][]`
- `Filter[majestic_topics]`
- `Filter[majestic_sub_topics]`
- `Filter[majestic_cf_from]`
- `Filter[majestic_cf_to]`
- `Filter[majestic_tf_from]`
- `Filter[majestic_tf_to]`
- `Filter[majestic_tf_cf_ratio_from]`
- `Filter[majestic_tf_cf_ratio_to]`
- `Filter[majestic_links_from]`
- `Filter[majestic_links_to]`
- `Filter[majestic_domains_from]`
- `Filter[majestic_domains_to]`
- `Filter[out_links_internal_from]`
- `Filter[out_links_internal_to]`
- `Filter[out_links_external_from]`
- `Filter[out_links_external_to]`
- `Filter[out_domains_external_from]`
- `Filter[out_domains_external_to]`
- `Filter[majestic_ips_from]`
- `Filter[majestic_ips_to]`
- `Filter[majestic_subnets_from]`
- `Filter[majestic_subnets_to]`
- `Filter[majestic_edu_dom_from]`
- `Filter[majestic_edu_dom_to]`
- `Filter[majestic_edu_links_from]`
- `Filter[majestic_edu_links_to]`
- `Filter[majestic_gov_dom_from]`
- `Filter[majestic_gov_dom_to]`
- `Filter[majestic_gov_links_from]`
- `Filter[majestic_gov_links_to]`
- `Filter[site_languages][]`
- `Filter[anchor_languages][]`
- `Filter[ahrefs_dr_from]`
- `Filter[ahrefs_dr_to]`
- `Filter[ahrefs_rank_from]`
- `Filter[ahrefs_rank_to]`
- `Filter[ahrefs_backlinks_from]`
- `Filter[ahrefs_backlinks_to]`
- `Filter[ahrefs_domains_from]`
- `Filter[ahrefs_domains_to]`
- `Filter[ahrefs_positions_from]`
- `Filter[ahrefs_positions_to]`
- `Filter[ahrefs_traffic_from]`
- `Filter[ahrefs_traffic_to]`
- `Filter[ahrefs_ips_from]`
- `Filter[ahrefs_ips_to]`
- `Filter[ahrefs_subnets_from]`
- `Filter[ahrefs_subnets_to]`
- `Filter[ahrefs_dofollow_from]`
- `Filter[ahrefs_dofollow_to]`
- `Filter[ahrefs_nofollow_from]`
- `Filter[ahrefs_nofollow_to]`
- `Filter[ahrefs_text_from]`
- `Filter[ahrefs_text_to]`
- `Filter[ahrefs_gov_from]`
- `Filter[ahrefs_gov_to]`
- `Filter[ahrefs_edu_from]`
- `Filter[ahrefs_edu_to]`
- `Filter[has_gbp]`
- `Filter[gbp_country]`
- `Filter[gbp_city]`
- `Filter[gbp_category]`
- `Filter[gbp_rating_from]`
- `Filter[gbp_rating_to]`
- `Filter[moz_da_from]`
- `Filter[moz_da_to]`
- `Filter[moz_pa_from]`
- `Filter[moz_pa_to]`
- `Filter[semrush_rank_from]`
- `Filter[semrush_rank_to]`
- `Filter[semrush_traffic_from]`
- `Filter[semrush_traffic_to]`
- `Filter[semrush_keywords_from]`
- `Filter[semrush_keywords_to]`
- `Filter[auction_ends_from]`
- `Filter[auction_ends_to]`
- `Filter[domain_added_from]`
- `Filter[domain_added_to]`
- `Filter[price_from]`
- `Filter[price_to]`
- `Filter[domain_length_from]`
- `Filter[domain_length_to]`
- `Filter[per-page]`
- `Filter[added_period]`
- `Filter[expiry_period]`
- `Filter[allow_numbers]`
- `Filter[allow_dashes]`
- `Filter[google_index]`
- `Filter[processed_sz]`
- `Filter[remove_reviewed]`
- `Filter[remove_watchlist]`
- `Filter[sz_score_from]`
- `Filter[sz_score_to]`
- `Filter[sz_redirects_from]`
- `Filter[sz_redirects_to]`
- `Filter[sz_parked_from]`
- `Filter[sz_parked_to]`
- `Filter[sz_activehistory_from]`
- `Filter[sz_activehistory_to]`
- `Filter[sz_age_from]`
- `Filter[sz_age_to]`
- `Filter[dns_changes_from]`
- `Filter[dns_changes_to]`
- `Filter[sz_drops_from]`
- `Filter[sz_drops_to]`
- `Filter[last_drop_year]`
- `Filter[min_indexed_pages]`
- `all_data_sources`
- `Filter[domain_sources][]`
- `Filter[backlinks_keywords]`
- `Filter[include_domains]`
- `Filter[exclude_domains]`
- `Filter[dr_backlinks_amount]`
- `Filter[dr_backlinks_rank]`
- `Filter[backlinks_tlds_amount]`
- `Filter[backlinks_tlds][]`

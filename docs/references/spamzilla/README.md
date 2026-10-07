# SpamZilla reference

Research into SpamZilla, the tool this project replaces for the owner. It is not a product requirement: do not infer first-version scope from it. The agreed scope is in [`initial-domain-discovery.md`](../../product-specs/initial-domain-discovery.md).

## Filter reference

A complete inventory of SpamZilla's filter form, extracted from the supplied SpamZilla filter interface HTML. Field names are preserved exactly as the form submits them. The leaves follow the UI order; open the one for the filter family you are comparing against.

- [Keyword and TLD filters](keyword-and-tld-filters.md): domain keyword search and the 57 major and country TLDs.
- [Majestic filters](majestic-filters.md): category, sub-category, TF, CF, link and domain ranges, and the 65 site and anchor languages.
- [Ahrefs, Moz, and SEMrush filters](ahrefs-moz-semrush-filters.md): DR, UR, traffic, and the first Backlinks panel of Ahrefs-derived counts; Moz DA and PA; SEMrush rank, traffic, and keywords.
- [Google Business Profile filters](google-business-profile-filters.md): GBP presence, the 195 countries, city, rating, and the category filter, whose 3,579 options are data in [`gbp-categories.csv`](gbp-categories.csv).
- [General and SpamZilla filters](general-and-spamzilla-filters.md): the Columns control, auction end, date added, price, length, page size, flags, and SpamZilla's own scores and drop date.
- [Domain source filters](domain-source-filters.md): the expired, pending-delete, and 17 marketplace sources.
- [Backlink filters](backlink-filters.md): the second Backlinks panel, with anchor keywords, include and exclude domains, DR-above counts, and backlink-source TLDs.
- [Filter actions and form fields](form-fields.md): Apply, Save, Reset, Load, the hidden fields, and every distinct submitted field name.

[SpamZilla domain metrics](spamzilla-domain-metrics.md) is a JSON sketch of the domains-table filter fields, from SpamZilla's FAQ, and the list of its table columns.

### Filter-type key

- **Numeric range:** two number inputs, usually `*_from` and `*_to`.
- **Date range:** two date/text inputs, `*_from` and `*_to`.
- **Checkbox:** independent Boolean toggle.
- **Radio group:** exactly one preset may be selected.
- **Multi-select checkboxes:** zero or more values submitted through an array field ending in `[]`.
- **Searchable dropdown:** single-select menu enhanced with live search.
- **Dynamic dropdown:** options are loaded after another filter is selected.

### Extraction totals

- **Form controls found:** 381
- **Non-hidden controls found:** 379
- **Distinct non-hidden submitted field names:** 117
- **Google Business Profile category options:** 3579
- **Google Business Profile country options:** 195
- **Majestic site-language options:** 65
- **Majestic anchor-language options:** 65
- **Primary domain TLD options:** 57
- **Backlink-source TLD options:** 57

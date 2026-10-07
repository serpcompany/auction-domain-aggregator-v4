# Domain source filters

Which expired, pending-delete, and marketplace sources to include. Part of the [SpamZilla filter reference](README.md), extracted from the supplied SpamZilla filter interface HTML; field names are preserved exactly as submitted by the form.

## Domain Source

| Filter | Filter type | Field | Constraints/defaults |
|---|---|---|---|
| All Domains | Checkbox | `all_data_sources` | checked value `1`; default checked; acts as a source-wide toggle |
| Domain Sources | Multi-select checkboxes | `Filter[domain_sources][]` | options grouped into the two UI tabs below |

### Expired / Expiring

- **Filter type:** multi-select checkboxes
- **Field:** `Filter[domain_sources][]`
- **Options (3):**
  - Expired Domains - Register Now! — value `expired`
  - Pending Delete — value `pending-delete`
  - ccTLD (Country Domains) — value `cctld`

### Marketplace Domains

- **Filter type:** multi-select checkboxes
- **Field:** `Filter[domain_sources][]`
- **Options (17):**
  - GoDaddy Auctions — value `godaddy-auctions`
  - GoDaddy Closeouts — value `godaddy-closeouts`
  - Namejet Auctions — value `namejet-auctions`
  - Namejet PreRelease — value `namejet-prerelease`
  - Dynadot Expired — value `dynadot`
  - DropCatch PreRelease — value `dropcatch-prerelease`
  - DropCatch Dropped — value `dropcatch-dropped`
  - DropCatch Private Seller — value `dropcatch-private-seller`
  - Namesilo Auctions — value `namesilo`
  - Sedo Expiring Domains — value `sedo`
  - Name.com — value `name-com`
  - Namecheap Auctions — value `namecheap`
  - Sav.com Auctions — value `sav-com`
  - SEO.Domains — value `seo-domains`
  - Atom — value `atom`
  - Gname Auctions — value `gname-auctions`
  - Gname Buy It Now — value `gname-buy-it-now`

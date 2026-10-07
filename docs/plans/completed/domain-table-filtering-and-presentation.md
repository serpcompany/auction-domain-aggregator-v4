# Domain table filtering and presentation

Completed 2026-07-13 (Codex). This is the outcome summary; the full ExecPlan, with its milestone log, benchmark tables, and revision notes, is in git history (`git show 907d382:docs/plans/completed/domain-table-filtering-and-presentation.md`).

## Outcome

The first Dynadot table became a tool for narrowing about 426,000 active listings to a shortlist, still on one server-rendered page:

- A normalized URL contract for domain search; repeated source, auction-type, and TLD values; domain length, no-hyphen, and no-digit; price, bids, bidders, age, links, visitors, appraisal, and renewal bounds; ending-window presets (1h, 6h, 24h, 3d, 7d); 12 allowlisted sorts; and fixed 50-row pages.
- Quick filters in a toolbar, the rest in a grouped advanced sheet, removable applied-filter chips, Clear all, and Back and reload that restore state from the URL.
- A redesigned comparison table: grouped cells, relative end time with an absolute UTC line, urgency cues that do not rely on color alone, money without meaningless decimals, and em dashes for unknown values.
- Deterministic browser acceptance against an isolated temporary D1 seeded with invented listings, and the `benchmark:filters` command for the real local inventory.

The table and filter UI were later replaced by the [UI redesign](ui-redesign.md), and TLD and length moved to indexed generated columns ([Indexed TLD and length facets](indexed-tld-length-facets.md)). The URL contract and query semantics below still hold.

## Key decisions

- **Only honest filters:** stored fields or values derived from the domain name. Ahrefs and Majestic controls waited for real enrichment, with no fake or no-op inputs.
- **The URL is the canonical state.** Reloadable, shareable, and testable, and it keeps the D1 queries server-side. No client table framework, because it would add a second state model without making D1 faster.
- **Explicit Apply, and every filter change returns to page 1,** so a set of range edits is one action and keystrokes never trigger count queries.
- **OR within a category, AND across categories.** A range filter excludes unknown values only when that field is constrained.
- **Unknown values sort last** in both directions, then domain, provider, and external ID break ties.
- **A shared 64-value budget for repeated categories** (source, then auction type, then TLD), discarded at the URL boundary. D1 allows 100 bound parameters per statement, and the worst accepted row query uses 82.
- **Relative end time first,** floored to whole minutes, with urgency from the exact remaining time: red within one hour, amber within 24 hours.
- **Measure before adding schema.** Expressions on `domain_name` met the targets, so no migration was added. TLD extraction used SQLite JSON functions to handle the 590 multi-dot names.
- **Reads stay sequential,** because concurrent local D1 reads produced `SQLITE_BUSY_SNAPSHOT`.
- **Browser tests use isolated persistence** and never touch the owner's inventory.

## Discoveries

- OpenNext's `preview` does not expose Wrangler's persistence option, so e2e serves the built worker with Wrangler directly against a temporary `--persist-to` directory.
- HTTP 200 on a fixed port is not readiness: setup rejects an occupied port, then waits for a page containing a domain seeded for that exact run.
- Next.js reads dotenv files from its working directory even with a sanitized environment, so the e2e build runs in an allowlisted temporary source workspace.
- Stopping only the direct child process left pnpm, Wrangler, and workerd running; e2e commands run as process groups.
- Sticky and overflow behavior cannot be inferred from class names; browser tests measure geometry, scroll offsets, and computed styles at desktop and 375 px.

## Evidence

- Real inventory (426,398 active rows), `benchmark:filters` with one warm-up and five measured runs: ordinary count and page means 36 to 98 ms, broad substring 79 to 86 ms, the 250-value TLD facet about 275 to 283 ms. Each query used the status/provider index.
- `pnpm check` passed with 163 unit tests at 100 percent configured coverage, the isolated D1 proof, and four Chromium tests. Independent specification and quality reviews approved the work.

## Follow-ups at completion

Enrichment (Ahrefs DR, Majestic Topic), more providers, and scheduling were left to later plans.

# Make domain discovery faster to narrow and easier to read

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must remain accurate while implementation proceeds.

Maintain this plan according to `docs/plans/README.md` from the repository root.

## Purpose / Big Picture

With this plan complete, the repository owner can reduce hundreds of thousands of active auction listings to a useful shortlist without mentally decoding raw values. The discovery page provides practical auction, domain-shape, timing, price, and activity filters; shows every applied constraint clearly; and renders a denser but more legible comparison table.

The observable result is still one domain-discovery page, not a dashboard. A person can search for a domain fragment, select one or more categorical filters, enter numeric ranges, apply common ending-time presets, remove individual filters, sort the surviving rows, and share or reload the resulting URL without losing state. The table will make urgent end times, money, domain characteristics, and auction activity understandable at a glance while preserving a direct link to the source auction.

This plan improves the existing D1-backed Dynadot slice. It does not add another auction provider, call Dynadot during a page request, ingest Ahrefs or Majestic data, schedule synchronization, deploy Cloudflare resources, add accounts, save searches, place bids, or fabricate unavailable metrics.

## Progress

- [x] (2026-07-13 12:16Z) Checkpointed the completed Dynadot ingestion and discovery slice as commit `7952021`.
- [x] (2026-07-13 12:16Z) Inspected the current schema, URL parser, D1 query, table component, product spec, and architecture to inventory real filterable fields and existing constraints.
- [x] (2026-07-13 12:16Z) Defined the initial filter contract, presentation direction, performance decision gate, milestones, and acceptance behavior in this ExecPlan.
- [x] (2026-07-13 12:32Z) Measured count and 50-row query shapes against the 426,398-row local inventory; warm ordinary queries remained below 155 ms and the worst substring case below 116 ms, so no derived-domain migration is needed.
- [x] (2026-07-13 12:32Z) Implemented and tested the expanded normalized URL filter/sort contract, expression-backed D1 predicates, extended row model, deterministic facets, null placement, and injected ending-window reference time.
- [x] (2026-07-13 14:04Z) Completed the quick and advanced filter UI, applied summaries, client-navigation resynchronization, and real-browser Back and narrow-viewport acceptance with deterministic provider-free fixtures.
- [x] (2026-07-13 13:47Z) Extracted and redesigned the server-rendered comparison table, added deterministic value/urgency formatting, accessible unknown states, semantic sorting, and sticky contained overflow; browser visual acceptance remains in Milestone 4.
- [x] (2026-07-13 14:04Z) Added isolated deterministic browser acceptance, proved rendered table geometry and interaction states at desktop and 375 pixels, audited the changed UI, updated durable documentation, and reran the complete local validation and real-inventory benchmark. Independent review remains.
- [x] (2026-07-13 14:22Z) Addressed the first Milestone 4 specification review: made E2E cleanup awaited and invocation-verifiable, added real intersection stacking hit tests, and completed sortable-hover, autocomplete, and placeholder guideline corrections. Re-review remains.
- [x] (2026-07-13 14:28Z) Added a pre-spawn loopback port guard and run-specific seeded-page readiness identity so Playwright cannot accept an existing server on port 8787. Re-review remains.
- [x] (2026-07-13 14:36Z) Moved the E2E OpenNext build into a manifest-only temporary workspace that excludes repository dotenv and local-state paths, uses the offline locked pnpm store, publishes only the worker artifact, and cleans up its exact build/run directories. Re-review remains.
- [x] (2026-07-13 14:42Z) Removed generated, gitignored `next-env.d.ts` from required isolated-build inputs and proved a source copy is ignored while Next generates its own workspace-local file. Re-review remains.
- [x] (2026-07-13 14:51Z) Addressed final quality-review findings: allowlisted source/type facets at the D1 boundary, made advanced-filter dismissal discard every draft consistently, terminated isolated E2E command trees by process group, and made the table scroll region labeled, focusable, and keyboard-scrollable. Final re-review remains.
- [x] (2026-07-13 14:54Z) Received independent specification and quality approval, reran the standard production build and migration-history check, and verified the real local-inventory page plus D1 health at `http://127.0.0.1:30001`.

## Surprises & Discoveries

- Observation: The database already stores more useful comparison data than the UI exposes.
  Evidence: `auction_listings` contains bidder count, inbound links, visitors, Dynadot appraisal, renewal price, start time, and auction type, while `DomainListingRow` currently selects only price, bids, end time, and age.

- Observation: Useful domain-shape filters are not represented as stored fields.
  Evidence: TLD, domain length, hyphen presence, and digit presence can be derived from `domains.name`, but neither `domains` nor `auction_listings` currently stores them or indexes them.

- Observation: The current `Ends` cell is accurate but requires unnecessary interpretation.
  Evidence: It renders a long UTC value such as month, day, year, 24-hour time, and zone as one line, with no relative duration or urgency cue.

- Observation: D1 read concurrency and scan cost are real constraints at the current inventory size.
  Evidence: The first slice had to make its count, row, facet, and freshness reads sequential to avoid local SQLite snapshot locking. The local database has 426,398 active listings, so every new filter and facet query must be measured rather than assumed cheap.

- Observation: The current URL-backed, server-rendered model is already a strong base for richer filtering.
  Evidence: Filter state survives reloads, links preserve sorting and pagination, invalid values are allowlisted, and normal page requests read only D1. The redesign should extend this model rather than replace it with a second client-only state system.

- Observation: Domain-shape expressions are inexpensive enough on the real local inventory that persisted derived columns would be premature.
  Evidence: After warm-up, TLD count/page queries averaged 96/102 ms, domain-length count/page queries averaged 54/75 ms, and combined no-hyphen plus no-digit count/page queries averaged 120/136 ms across 426,398 active rows. The plans used the existing status/provider index and temporary B-trees where sorting or grouping required them.

- Observation: A bounded TLD facet is the most expensive new read, but still meets the local navigation target without schema changes.
  Evidence: Grouping the active inventory by the safely extracted final domain label and limiting to 250 values took 361-649 ms warm. The query plan uses `auction_listings_status_provider_idx` plus a temporary B-tree for grouping.

- Observation: Ending-window semantics need to tolerate temporarily stale active inventory.
  Evidence: The disposable D1 proof includes an active listing ending before the injected reference time; `endingWithin=1h` includes it because the agreed predicate is only `ends_at <= now + window`, while active status remains mandatory.

- Observation: Repeated categorical URL parameters need a shared budget, not merely per-field syntax validation.
  Evidence: D1 limits statements to 100 bound parameters. A 64-value total budget allocated deterministically across source, auction type, and TLD leaves the worst production row query at no more than 82 bindings even when every scalar predicate, limit, and offset is present. The disposable D1 proof executes this worst accepted shape after receiving 81 TLD inputs.

- Observation: A combined filter assertion does not prove each predicate even when the final row count is correct.
  Evidence: The disposable D1 proof now gives each predicate its own boundary and near-miss assertions. Distinct fixture permutations independently prove both range sides, each threshold, null versus wrong-side numeric values, shape flags, ending cutoffs including stale rows, literal wildcard escaping, and OR behavior for source, auction type, and TLD.

- Observation: Real-inventory benchmark evidence is reproducible without knowing Wrangler's internal persistence path.
  Evidence: `corepack pnpm benchmark:filters` resolves the populated local D1 binding through `wrangler.jsonc`, explicitly uses `--local --env-file /dev/null`, performs one warm-up plus five measured D1 executions per count and 50-row shape, and prints only aggregate counts, D1 timing metadata, and query-plan details.

- Observation: Portal-rendered advanced controls can remain part of the same semantic GET form without duplicating filter state.
  Evidence: The sheet fields and advanced categorical hidden inputs use the HTML `form` association, while the quick and advanced projections of maximum bid and ending window share one controlled value. One Apply action therefore emits the existing normalized URL contract and never queries D1 on keystrokes.

- Observation: OpenNext's preview command does not expose Wrangler's local persistence option.
  Evidence: Deterministic browser state therefore uses `scripts/start-e2e-preview.ts` to apply migrations and invented fixtures to a temporary `--persist-to` directory, then starts the built `.open-next/worker.js` with Wrangler directly. Playwright global setup starts that runner as a direct child and awaits teardown because terminating a package-script process tree did not reliably let the nested runner finish cleanup.

- Observation: Rendered sticky behavior cannot be inferred from table class names, and the available horizontal travel differs by viewport.
  Evidence: Browser acceptance measures actual client and scroll widths, scroll offsets, bounding boxes, positions, backgrounds, and focus styles at 1280 and 375 pixels. The desktop table has only a small horizontal delta while the narrow viewport has much more; both move a non-sticky header while the Domain intersection remains fixed and opaque.

- Observation: HTTP 200 alone is not sufficient preview readiness evidence on a fixed port.
  Evidence: Global setup now first binds and closes port 8787 to reject an existing listener, then requires a filtered server-rendered page to contain the unique domain marker seeded for that exact run. A focused socket test proves an occupied port is rejected and becomes acceptable only after its owner closes it.

- Observation: Sanitizing the child process environment does not stop Next.js from discovering dotenv files in its working directory.
  Evidence: The original root build reported the repository environment file even with an allowlisted process environment. E2E now builds from a temporary allowlisted source workspace with an offline locked dependency install; its output has no `Environments` line, and a controlled sentinel test proves dotenv, local-state, and key-like paths are not copied.

- Observation: Stopping only the direct Corepack child does not guarantee that pnpm, Wrangler, and workerd descendants stop.
  Evidence: E2E setup and preview commands now start as detached process groups on macOS/Linux, cleanup signals the group gracefully and then forcefully if needed, and Windows uses only the safe direct-child fallback. Focused lifecycle tests prove the group target and fallback behavior.

## Decision Log

- Decision: Expose only filters backed by data that is already stored or deterministically derived from the domain name.
  Rationale: Price, bids, bidders, age, links, visitors, appraisal, renewal price, auction type, source, end time, TLD, length, hyphen presence, and digit presence are honest inputs. Ahrefs DR and Majestic Topic filters must wait for real enrichment.
  Date/Author: 2026-07-13 / Codex.

- Decision: Organize controls into a small always-visible quick-filter row and a grouped `More filters` surface.
  Rationale: Domain search, source, TLD, maximum price, and ending window are likely to be used repeatedly. Showing every numeric input at once would crowd the table and make the page harder to scan.
  Date/Author: 2026-07-13 / Codex.

- Decision: Keep the URL as the canonical filter, sort, and page state.
  Rationale: URLs remain reloadable, linkable, testable, and compatible with server-side D1 queries. The form may use small client components for disclosure or multi-select interactions, but it must submit normalized URL parameters rather than maintain a separate hidden result set.
  Date/Author: 2026-07-13 / Codex.

- Decision: Apply filter changes explicitly and reset pagination to page 1.
  Rationale: Explicit application avoids issuing expensive count queries on every keystroke and makes a grouped set of range edits behave as one action. Removing an applied-filter chip also returns to page 1.
  Date/Author: 2026-07-13 / Codex.

- Decision: Use human-relative end time as the primary value and an absolute UTC time as secondary context.
  Rationale: `2h 14m` or `3d 6h` supports auction triage more directly than a long timestamp. UTC is stable across server rendering and remains an unambiguous fallback; the semantic `time` element retains the ISO timestamp.
  Date/Author: 2026-07-13 / Codex.

- Decision: Group related values within cells rather than creating a separate column for every stored number.
  Rationale: A wide comparison table is useful, but one-column-per-field would force excessive horizontal travel. Domain characteristics, auction identity, price/value, and activity each have a clear primary/secondary hierarchy.
  Date/Author: 2026-07-13 / Codex.

- Decision: Floor displayed end durations to completed whole minutes while applying urgency thresholds to the exact remaining milliseconds.
  Rationale: This produces stable compact values such as `48m`, keeps the red boundary inclusive through exactly one hour and amber through exactly 24 hours, and represents equal or past timestamps explicitly as ended without allowing rounding to weaken urgency.
  Date/Author: 2026-07-13 / Codex.

- Decision: Preserve server-side filtering, sorting, and fixed 50-row pagination without adding a client table framework.
  Rationale: The current architecture already handles 426,000-plus records without sending the dataset to the browser. A client table library would not make server query behavior faster and would add a second state model.
  Date/Author: 2026-07-13 / Codex.

- Decision: Benchmark domain-derived SQL before committing to schema changes.
  Rationale: TLD and shape filters may be acceptable as expressions or may need stored/indexed domain attributes. A disposable local-D1 proof with the real row count will choose between them using evidence.
  Date/Author: 2026-07-13 / Codex.

- Decision: Keep the schema and current indexes unchanged for this filtering milestone.
  Rationale: Every measured count and 50-row query met the local targets with substantial margin. Persisting and backfilling TLD, length, hyphen, and digit fields would add migration and ingestion complexity without an observed latency need. No local migration was generated or applied, and the imported 426,400/426,398 total/active counts remain unchanged.
  Date/Author: 2026-07-13 / Codex.

- Decision: Derive domain length and shape directly from `auction_listings.domain_name`, and extract the final TLD label with SQLite JSON functions.
  Rationale: The listing already carries the normalized domain identity needed by the result query, so joining `domains` would add work without supplying another field. JSON extraction handles the observed 590 multi-dot names correctly, unlike taking the substring after the first dot. All selected filter values remain Drizzle-bound parameters.
  Date/Author: 2026-07-13 / Codex.

- Decision: Place unknown values last for both ascending and descending nullable sorts.
  Rationale: A leading `field is null` ordering expression gives stable, user-oriented null placement, while domain, provider, and external ID complete deterministic tie-breaking.
  Date/Author: 2026-07-13 / Codex.

- Decision: Cap all repeated category values at 64 total in source, auction-type, then TLD order.
  Rationale: First-valid unique values are retained deterministically and excess values are discarded at the URL boundary. This central budget is compatible with D1's 100-bind ceiling even when every scalar filter is active, and is safer than independent per-category limits that could exceed the statement ceiling when combined.
  Date/Author: 2026-07-13 / Codex.

- Decision: Use one client filter-form island with an accessible sheet and local-only searchable multi-selects.
  Rationale: The sheet supplies focus management and keyboard/dialog semantics at every viewport, while a single GET form preserves server-owned URL and query state. Only bounded facet strings and normalized filter values cross the client boundary; the table, rows, and D1 result remain server rendered.
  Date/Author: 2026-07-13 / Codex.

- Decision: Run Playwright against a separately configured, temporary D1 with 60 invented listings.
  Rationale: CI must prove populated-table behavior while a fresh database is empty, and browser checks must never mutate the owner's 426,400-row local inventory. The E2E runner applies the real migrations, serves the real OpenNext worker, loads no provider credentials, makes no provider request, and cleans up its temporary persistence.
  Date/Author: 2026-07-13 / Codex.

- Decision: Treat closing the advanced sheet without applying as cancellation of the whole sheet draft.
  Rationale: Dismiss and Escape now restore the shared maximum-bid and ending values captured when the sheet opened, while unmounted advanced fields remount from the canonical URL filters. Controlled, uncontrolled, checkbox, and repeated categorical controls therefore follow one predictable cancellation model.
  Date/Author: 2026-07-13 / Codex.

## Outcomes & Retrospective

Milestone 1 is complete. The normalized contract now supports repeated source, auction-type, and TLD values; domain shape; money, count, age, and metric bounds; ending windows; 12 allowlisted sorts; and fixed 50-row pagination. The general link builder preserves or removes every normalized field without implicitly changing the page, so later controls can reset pagination deliberately.

The production query applies OR within multi-value categories and AND across categories, uses one reference time for ending windows, excludes unknown values only when their field is constrained, returns all stored comparison fields plus derived TLD/length/shape values, and returns deterministic allowlisted source/auction-type facets plus a bounded TLD facet. Reads remain sequential. A provider-free disposable D1 proof covers all filter families, category OR, cross-category AND, the 64-value bind cap with every scalar predicate, null behavior, stale-ended behavior, exact ascending and descending values for all 12 sorts, null-last placement for every nullable sort, provider/external-ID tie-breakers, out-of-range page clamping, exclusion of unsupported stored facet values, facets, and the extended row contract.

No schema or index changed. The live local inventory remains 426,400 total listings and 426,398 active listings.

Milestone 2 is complete. The always-visible toolbar now provides domain search, repeated source and searchable TLD selection, maximum bid, ending presets, an advanced-filter count, explicit Apply, and conditional Clear all. The advanced sheet groups every stored-data constraint under Domain, Auction, Activity, and Value, and explains why Ahrefs and Majestic controls are unavailable rather than presenting fake inputs. Quick and advanced projections share one form state, selected categorical values submit as repeated parameters, and sort/direction survive form submission while pagination resets by omission.

Applied chips are produced by pure domain helpers in stable logical order. Their human labels cover ranges, shape flags, money, timing, activity, and categorical selections; each removal link preserves every other normalized filter plus sort/direction and resets page 1. The count sits beside this summary, Clear all returns to `/`, and URL-derived defaults reconstruct the controls on reload. The server boundary keys the client filter island from the canonical normalized filter URL, so chip removal, Clear all, sort/page navigation, and Back remount local controls from the new URL instead of resubmitting stale state. Component and pure-helper tests cover this navigation-style rerender, resulting form data, repeated parameters, grouped dialog semantics, unavailable-metric explanations, More count, chip/remove/clear behavior, and local multi-select search. The configured unit suite passes with 100% statements, branches, functions, and lines. Actual browser Back, 375-pixel overflow, and workerd acceptance remain deliberately assigned to Milestone 4.

The quality pass keeps long unbroken chip labels within their container while preserving the full accessible name and title, and supplies 44-pixel narrow-viewport targets throughout the filter surfaces. Portal-associated tests prove that live sheet number fields, checkboxes, and repeated auction-type selections contribute exactly once to the outer GET form, including a standalone multi-select rendered outside its target form. Maximum bid has exactly one active named control: the quick input is disabled while the sheet's visible form-associated input is mounted, then is restored with the shared value when the sheet closes. Native range-overflow validity therefore targets the visible sheet control rather than an inert background input. Parser-aligned HTML limits cover query length, domain length, safe integers, and 13-major-digit money. Client submission rejects reversed domain-length, age, and price ranges with an asserted live error, marks and focuses the first visible offending input, clears the error on correction, and then permits the corrected form. The direct URL parser continues to normalize untrusted reversed input at the server boundary. Filter markup is split into preserved-input and Domain, Auction, Activity, Value, and Metrics components without adding another state model. Generated sheet/popover motion respects reduced-motion preference, and full-height filter scrolling contains overscroll.

Milestone 3 implementation is complete. `DomainDiscovery` now composes a focused server-rendered `DomainResultsTable` instead of owning row markup. The semantic table has the agreed ten-column hierarchy, eight URL-backed sortable headers with Lucide state icons, explicit safe external auction links, sticky header and Domain column surfaces, a contained 70dvh horizontal/vertical scroll region, compact 64-pixel rows, tabular numeric alignment, and filter-aware empty-state recovery. Domain shape, auction source/type, bid/renewal, bids/bidders/visitors, relative and absolute end time, age, links, Dynadot-qualified appraisal, and truthful unavailable enrichment values are grouped without a client table state model.

Pure formatting tests define whole-dollar versus cent-bearing money, invalid-currency fallback, compact/full counts, provider and auction-type normalization, age units, compact absolute UTC timestamps, and duration floor rounding. Exact urgency boundaries are red through one hour, amber through 24 hours, neutral beyond 24 hours, and explicit for ended rows. Component tests cover all ten headers and rows, grouped hierarchy, domain metadata markers, link safety, semantic phrasing-only `time` markup, every urgency presentation, null accessibility, all eight sort mappings with filter preservation and page reset, and non-sortable enrichment headers. `corepack pnpm check:quick` passes with 158 tests and 100% configured statement, branch, function, and line coverage. Milestone 4 subsequently supplied the real-browser desktop and 375-pixel overflow, sticky intersection and movement, and computed hover/focus proof.

Milestone 4 is complete and independently approved. Playwright now runs the built OpenNext worker against an isolated temporary D1 seeded with 60 invented listings. Its four tests prove the healthy D1 page, all ten table headers, quick search/price/ending filters, advanced numeric and domain-shape filters, URL parameters and result changes, readable relative plus UTC end time, sort preservation, browser Back control/result restoration, individual chip removal, and Clear all. At desktop and 375 pixels it proves that overflow remains inside the table, the document does not overflow, horizontal scrolling moves Auction while Domain stays fixed, a scrolled non-sticky body cell geometrically overlaps the sticky intersection while `elementFromPoint` still returns the Domain header, vertical scrolling keeps the header fixed, sortable-header and row hover change computed backgrounds, and both the labeled scroll region and row links receive computed focus treatment. Keyboard ArrowRight and PageDown input changes the region's contained horizontal and vertical offsets at both widths.

The interface audit found and corrected unbounded `transition-all` declarations in the shared Button and Badge primitives, made sortable table-header targets 44 pixels at narrow widths while retaining the compact desktop size, added an explicit sortable-header hover surface, set non-auth filter number/search inputs to `autocomplete="off"`, and made placeholders end with a real ellipsis. Semantic controls and table markup, labels and input names, focus-visible treatment, reduced-motion behavior, text truncation, server-side `Intl` formatting, external-link context, and responsive overflow remain covered by component or browser proof. Durable product, architecture, technical-design, command, and overview documentation now matches the implemented slice.

Final validation on 2026-07-13 passed after all review fixes: `corepack pnpm check` (163 unit tests at 100% configured coverage, the complete isolated D1 proof, four Chromium tests, isolated dotenv-free build, run-specific readiness, process-group shutdown, and exact UUID-scoped build/E2E teardown verification), `corepack pnpm build`, `corepack pnpm db:check`, and `git diff --check`. Focused build, lifecycle, query, filter, and component tests also passed independently. The real-inventory benchmark rerun retained 426,400 total and 426,398 active listings; ordinary count/page means ranged from 36.0 to 97.6 ms, broad substring count/page means were 78.6/86.0 ms, and the 250-value TLD facet count/page means were 277.4/274.8 ms. The status/provider index and expected temporary expression B-trees remain unchanged, so the no-migration decision stands. Independent specification and quality reviewers approved the completed slice. The Webpack development server returns HTTP 200 for `/`, and `/api/health` returns `{"status":"ok","database":"ok"}` on port 30001 against the existing local inventory.

## Context and Orientation

Run every repository command from `/Users/devin/dev/repos/auction-domain-aggregator-v4` unless a step explicitly creates an isolated temporary directory.

The completed first slice is recorded in `docs/plans/completed/dynadot-domain-table.md`. `src/app/page.tsx` parses search parameters and calls the server-only wrapper in `src/server/queries/domain-listings.ts`. The database-bound query implementation is `src/server/queries/domain-listings-query.ts`. `src/domain/domain-table.ts` owns the pure URL parser, link builder, sort allowlist, and value formatters. `src/components/domain-discovery.tsx` owns the discovery form and table.

`src/server/db/schema.ts` defines `domains` and `auction_listings`. The listing table already has indexes for status/provider, domain name, end time, current bid, bid count, and age. It does not have indexes for auction type, links, visitors, appraisal, renewal price, or domain-derived characteristics. Do not add an index merely because a filter exists: demonstrate its query-plan or latency value and account for its write/storage cost.

The page uses sequential D1 reads intentionally. Concurrent reads previously produced `SQLITE_BUSY_SNAPSHOT` under local workerd/SQLite. Preserve sequential execution unless a real D1 proof demonstrates a safe alternative.

`scripts/test-d1-integration.ts`, `src/server/ingestion/integration-worker.ts`, and `wrangler.integration.jsonc` provide the provider-free disposable D1/workerd test harness. Extend that proof rather than creating another unrelated integration runner. Routine verification must not read `.env`, call a provider, use remote D1, or deploy anything.

For this plan, a quick filter is an always-visible control. An advanced filter is a control inside the `More filters` disclosure. An applied filter is a normalized, active URL constraint shown as a removable summary chip. A facet is a set of valid categorical values, such as auction types or TLDs, returned by D1 for filter controls.

## Plan of Work

### Milestone 1: Prove the filter contract and query shape

Extend the pure filter model in `src/domain/domain-table.ts` before changing the visual table. The normalized contract must support:

- Domain substring query.
- Zero or more auction sources.
- Zero or more auction types.
- Zero or more TLDs.
- Minimum and maximum domain length.
- `no hyphens` and `no digits` flags.
- Minimum and maximum current bid.
- Minimum bid count.
- Minimum bidder count.
- Minimum and maximum domain age.
- Minimum inbound links.
- Minimum visitors.
- Minimum Dynadot appraisal.
- Maximum renewal price.
- One ending-window preset: any time, 1 hour, 6 hours, 24 hours, 3 days, or 7 days.
- One allowlisted sort and direction.
- A positive bounded page with a fixed page size of 50.

Use repeated query parameters for multi-valued categories, for example `source=dynadot&type=expired&tld=com&tld=org`. Use decimal major-currency units at the URL/form boundary and integer cents inside the query contract. Use integer URL values for counts, years, and domain length. Normalize TLDs to lower-case labels without a leading dot. Empty, non-finite, negative, overlong, or unsupported values are discarded. If both ends of a range are valid but reversed, normalize them into ascending order. Every filter change resets the page to 1, while sort and pagination links preserve all active filters.

The query must define null behavior explicitly. A range or threshold filter on links, visitors, appraisal, renewal price, or age excludes rows where that field is unknown. With no filter on that field, unknown values remain eligible and display as an em dash.

Add the following sorts to the existing allowlist where the underlying field is present: appraisal, renewal price, links, visitors, bidder count, and domain length. Null-bearing sorts must have deterministic null placement, followed by domain, provider, and external ID tie-breakers.

Before adding domain columns or migrations, use count-only queries, representative row queries, `EXPLAIN QUERY PLAN`, and repeated timing against the current local inventory for:

- TLD alone and TLD plus end-time sort.
- Domain length range.
- No-hyphen and no-digit constraints.
- Price range plus ending window.
- Auction type plus bid threshold.
- Links, visitors, appraisal, and renewal thresholds.
- A worst-case domain substring combined with two other filters.

Do not record domain names in benchmark artifacts. Record query shapes, row counts, plans, and aggregate timings only. The target is that ordinary non-substring filtered navigation completes in under one second locally after warm-up and that the deliberately scan-heavy substring case completes in under two seconds. Treat these as investigation targets rather than excuses to add broad indexes: preserve the observed numbers even if the target is missed.

If TLD/length/shape expressions miss the target or produce unavoidable full listing scans, add domain-level derived fields to `domains`: `tld`, `name_length`, `has_hyphen`, and `has_digit`. Generate a reviewed Drizzle migration that backfills all existing domains deterministically, update ingestion domain inserts, and add only indexes shown useful by the benchmark. If expressions meet the target, keep the schema unchanged and record that decision in this plan.

Extend `DomainListingRow` and the result metadata with the fields and facets required by the controls and redesigned cells. At minimum, return auction type options and TLD options in deterministic order. Keep facet queries sequential with the existing count, row, source, and freshness reads. Do not return hundreds of thousands of row values merely to build a control.

Milestone 1 is complete when pure parser/link tests cover every filter kind and invalid-input boundary, the disposable D1 proof executes representative combinations against actual D1, and the plan records the schema/index decision with timings.

### Milestone 2: Build a filter system that stays understandable

Replace the current four-control form with a filter toolbar and an advanced filter surface while preserving semantic GET submission.

The always-visible toolbar contains:

- Domain search.
- Source multi-select.
- TLD multi-select with search when the facet contains enough values to require it.
- Maximum current bid.
- Ending-window preset.
- `More filters` button with an active-advanced-filter count.
- Primary `Apply filters` action.
- `Clear all` action, shown only when a filter is active.

The advanced surface groups controls by meaning:

- `Domain`: length range, age range, no hyphens, no digits.
- `Auction`: auction type, price range, renewal maximum, ending window.
- `Activity`: minimum bids, bidders, visitors, and inbound links.
- `Value`: minimum Dynadot appraisal.
- `Metrics`: disabled explanatory rows for Majestic Topic and Ahrefs DR until those datasets exist; do not render fake controls that silently do nothing.

Use a non-modal popover on wide screens if it can contain the grouped form without clipping; use an accessible sheet or dialog on narrow screens. The same named controls and normalization contract must serve both layouts. Do not duplicate separate desktop and mobile filter logic.

Below the toolbar, render applied-filter chips in a stable order. Each chip uses human language such as `TLD: .com, .org`, `Price: up to $500`, `Ends: next 24 hours`, or `Domain: no digits`. Removing a chip preserves every other filter and sort and returns to page 1. `Clear all` removes filters but preserves the default sort, and browser Back restores the prior filter state.

Display the result count beside the applied filters, not detached at the far edge of a large empty header. While server navigation is pending, use the framework's navigation behavior without replacing the current rows with fabricated loading data. Controls must have labels, descriptions for ambiguous metrics, visible focus, keyboard operation, and announced validation/normalization where user-entered bounds are changed.

Add only the shadcn primitives actually needed, likely Checkbox, Popover or Sheet, Select, Separator, and Tooltip. Add them through the shadcn CLI and keep their source in `src/components/ui/`. Do not add a premium block, a client-side data-grid package, or a general form framework solely for this page.

Milestone 2 is complete when every filter can be applied, removed individually, cleared together, restored with Back, and reconstructed from a copied URL in both desktop and narrow viewport browser tests.

### Milestone 3: Redesign the comparison table and value formatting

Keep a real semantic table. Make the header sticky within the table scroll container and keep the Domain column sticky during horizontal scrolling if that remains readable at narrow widths. Use one consistent compact row height with sufficient target size, a restrained row hover state, visible keyboard focus, tabular numerals, and right alignment for comparable numeric values. Do not make the entire row an auction link; accidental navigation is costly. The domain/source link remains explicit and opens in a new tab.

Use this default column hierarchy:

1. `Domain`: linked domain as the primary line; TLD and character count as quiet secondary metadata. Show small `hyphen` or `digits` markers only when present and only if they remain scannable.
2. `Auction`: source badge as primary; normalized auction type as secondary.
3. `Price`: current bid as primary; renewal price as secondary when known.
4. `Interest`: bids and bidders on the primary line; visitors as secondary when known.
5. `Ends`: compact relative duration as primary; absolute UTC date/time as secondary.
6. `Age`: full human unit, for example `12 years`, with an em dash for unknown.
7. `Links`: compact count with a full accessible label and an em dash for unknown.
8. `Appraisal`: Dynadot appraisal with a provider-qualified tooltip or label; em dash when unknown.
9. `Majestic topic`: em dash and an accessible `Not collected` label until enrichment exists.
10. `Ahrefs DR`: em dash and an accessible `Not collected` label until enrichment exists.

Format money without meaningless decimals: `$125` for whole-dollar amounts and `$125.50` when cents matter. Use compact notation only for secondary large values, such as `12.4K links`, and expose the full localized number through visible text, a tooltip, or an accessible label. Normalize provider auction-type labels for display without changing stored values.

Replace the current long end timestamp with a pure, exhaustively tested duration formatter. Examples include `48m`, `2h 14m`, `3d 6h`, and `Ended 12m ago` if stale active inventory temporarily contains an expired timestamp. Use restrained urgency treatment: neutral beyond 24 hours, amber within 24 hours, and red within 1 hour. Color cannot be the only signal; the text itself conveys the remaining duration. The absolute secondary line uses a compact form such as `Jul 14, 18:30 UTC` and the `time` element keeps the ISO value.

Improve header labels and help text so abbreviated or provider-specific values are understandable. Sortable headers must keep `aria-sort`, use a consistent icon, preserve filters, and reset to page 1. Non-sortable columns must not look clickable. Keep the existing truthful empty state, but make its explanation reflect all filter types and provide a one-action clear path.

On narrow viewports, preserve horizontal scrolling inside the table container without allowing document-level overflow. Keep Domain visible if sticky positioning works without obscuring other cells. Do not replace the table with cards unless browser evidence shows that the semantic table is unusable on the supported narrow viewport.

Milestone 3 is complete when the real 50-row page can be scanned without decoding raw timestamps, money aligns consistently, unknown values are unmistakable, urgent endings are apparent without relying only on color, and desktop/narrow screenshots show no clipping or document overflow.

### Milestone 4: Prove behavior, performance, and maintainability

Extend unit tests around `src/domain/domain-table.ts` for parsing, normalization, link construction, chip labels, money, compact counts, absolute dates, durations, urgency states, and null handling. Component tests verify grouped controls, applied chips, semantic table structure, accessible unavailable values, sort state, row hierarchy, and pagination without asserting incidental Tailwind class strings.

Extend the existing provider-free D1 integration worker with fixture rows covering nulls, multiple TLDs, auction types, price boundaries, ending windows, domain shapes, and all numeric thresholds. Prove combined filters use AND semantics across groups and OR semantics within one multi-select group. Prove sorting, null placement, page clamping, facet ordering, and idempotence against actual migrated D1.

Extend Playwright acceptance to exercise at least one quick filter, one advanced numeric filter, one domain-shape filter, an applied-chip removal, clear all, a sort while filters are active, browser Back, readable end-time output, and narrow-viewport overflow. Keep the browser test compatible with a freshly migrated empty database by using the disposable integration proof for deterministic row-level assertions; do not make CI depend on live provider data.

For table presentation, record browser evidence at both desktop width and a 375-pixel viewport rather than asserting Tailwind implementation tokens in unit tests. Use Playwright bounding boxes, scroll offsets, and computed styles to prove that the table scroll region stays within the document viewport, the document itself has no horizontal overflow, horizontal scrolling moves non-sticky columns, the Domain/header sticky intersection remains positioned and opaque above moving cells, and row hover plus keyboard-focused links and headers receive visibly different computed backgrounds or focus treatment. These checks belong to Milestone 4 because DOM class names alone cannot prove rendered sticky or overflow behavior.

Measure repeated real-inventory navigation for the benchmark cases selected in Milestone 1 and record aggregate timings in this plan. Verify that no normal page request imports or calls provider code. Run an accessibility pass for labels, keyboard use, focus order, dialog/popover behavior, table semantics, contrast, and non-color urgency cues.

Update `ARCHITECTURE.md` only if the query boundary or schema changes. Update `docs/product-specs/initial-domain-discovery.md` with the accepted filter behavior so its open filter decision is no longer stale. Update technical design with any derived-domain fields and demonstrated indexes. Add new commands to `AGENTS.md` only if the standard workflow changes.

Run final independent specification and quality reviews. Restart the inspection server on port 30001, record final evidence in this plan, and move it to `docs/plans/completed/domain-table-filtering-and-presentation.md` only after every acceptance item passes.

## Concrete Steps

From `/Users/devin/dev/repos/auction-domain-aggregator-v4`, preserve the checkpoint and establish the baseline:

    git status --short
    git log -1 --oneline
    corepack pnpm check
    corepack pnpm build

Expected baseline: commit `7952021` is present, the working tree contains only this active plan before implementation starts, 94 unit tests pass at configured 100-percent coverage, the isolated D1 proof and one browser test pass, and the build succeeds.

Run count-only/query-plan benchmarks without printing domain rows. Add the exact repeatable benchmark command during Milestone 1 rather than preserving one-off shell history. It must use local D1 with dotenv disabled or a disposable local copy:

    corepack pnpm benchmark:filters

Expected output: JSON with `status: "succeeded"`, aggregate inventory counts, one warm-up and five measured count/50-row timings per named shape, and sanitized `EXPLAIN QUERY PLAN` details. The command depends on an already populated local inventory and is intentionally not part of CI or `check`.

If the benchmark selects a schema change:

    corepack pnpm db:generate
    corepack pnpm db:check
    corepack pnpm db:migrate:local
    corepack pnpm db:migrate:local

The generated migration must be inspected before application. The second local migration run must report no work. Verify the domain count, listing count, active count, duplicate identities, and foreign keys using count-only output.

During each milestone, run the fast loop:

    corepack pnpm check:quick
    git diff --check

Run the provider-free D1 proof whenever query or schema behavior changes:

    corepack pnpm test:integration

Run the complete acceptance set before review:

    corepack pnpm check
    corepack pnpm build
    corepack pnpm db:check
    git diff --check

Start the final inspection server with the verified development bundler:

    corepack pnpm dev --webpack --hostname 127.0.0.1 --port 30001

Expected handoff: `/` and `/api/health` return HTTP 200, filters operate against real local inventory, and no provider sync is required to inspect the redesign.

## Validation and Acceptance

The plan is complete only when all of the following are observable:

1. The URL parser accepts every documented filter, rejects unsupported or unsafe values, normalizes reversed ranges, and keeps page size fixed at 50.
2. Category filters use OR semantics within a category and filters from different categories combine with AND semantics.
3. Range filters exclude unknown values only when that field is constrained; unconstrained unknown values remain visible as em dashes.
4. Domain search, source, type, TLD, domain length, no-hyphen, no-digit, price, bids, bidders, age, links, visitors, appraisal, renewal, and ending-window behavior are proven against actual local D1 fixtures.
5. Ahrefs and Majestic filters are absent or explicitly disabled until real enrichment exists; no fake metric value or functional-looking no-op control appears.
6. Quick filters remain visible without crowding the table; advanced filters are grouped under one clearly labeled disclosure.
7. Every applied constraint has a human-readable chip, individual removal preserves other state, and `Clear all` removes filters in one action.
8. Applying, removing, or clearing filters returns to page 1. Sorting and pagination preserve all active filters.
9. Reloading, copying the URL, and browser Back reproduce the same normalized filter state and result set.
10. The table displays the agreed Domain, Auction, Price, Interest, Ends, Age, Links, Appraisal, Majestic Topic, and Ahrefs DR hierarchy.
11. End time uses a relative primary value and compact absolute UTC secondary value; urgent text is understandable without color.
12. Whole-dollar money omits `.00`, fractional money retains cents, and comparable numbers use stable alignment and tabular numerals.
13. Unknown values use an em dash with accessible `Not collected` or equivalent context where the column could otherwise be ambiguous.
14. Every domain link still targets its authoritative auction URL in a new tab with safe relationship attributes.
15. Sortable headers expose correct `aria-sort`, preserve filters, and have deterministic tie-breakers and null placement.
16. The table header remains usable while scrolling, horizontal overflow stays inside the table container, and the document has no horizontal overflow at the tested narrow viewport.
17. Keyboard users can reach, operate, apply, and dismiss all filter controls and return focus predictably from a popover, sheet, or dialog.
18. Representative non-substring filter navigation meets the recorded local performance target or the plan documents measured evidence and the accepted tradeoff. The substring worst case is measured separately.
19. Query-plan evidence justifies every new index or records why no schema/index change was needed.
20. The server query remains D1-only and sequential unless a real integration proof demonstrates a safe concurrency change.
21. The disposable integration test applies migrations, cleans up its state and port, does not read `.env`, and does not call Dynadot or any other provider.
22. `corepack pnpm check:quick`, `corepack pnpm test:integration`, `corepack pnpm check`, `corepack pnpm build`, `corepack pnpm db:check`, and `git diff --check` pass.
23. No tracked file contains credentials, copied provider responses, remote D1 configuration, or fabricated metric fixtures presented as real data.
24. Durable product and technical documentation matches the implemented filters, schema, indexes, and table behavior.
25. Independent review approves the slice and `http://127.0.0.1:30001` serves the improved table with a healthy local D1 connection.

## Idempotence and Recovery

URL parsing and link construction are pure and rerunnable. Invalid parameters fall back to documented defaults rather than throwing. Reapplying the same normalized filter URL returns the same ordered rows for unchanged D1 data.

Benchmarks and integration tests use local-only state and must be safe to rerun. Disposable D1 persistence is removed in `finally`, child workerd processes are terminated, and fixed test ports are verified free. A failed benchmark does not authorize deleting the existing `.wrangler/` inventory.

If a migration is selected, generate it once from the accepted schema change, inspect it, and apply it locally twice to prove idempotence. Do not edit old migrations or discard the 426,400-row local database to simplify development. Before any backfill, record count-only baseline values. Afterward, verify counts, derived-field completeness, duplicates, and foreign keys. If migration or backfill timing is unacceptable, stop and revise the migration strategy rather than killing a partially observed process or switching to remote D1.

Filter UI changes are reversible by navigating to `/`. Keep the existing query and table tests passing while replacing controls incrementally. If the advanced surface proves inaccessible or clips at supported widths, fall back to a simpler semantic form rather than retaining two divergent state implementations.

No step calls a provider or mutates remote state. The existing manual sync remains independently rerunnable, but it should be invoked during this plan only if a schema change requires explicit ingestion compatibility verification and the repository owner authorizes the live call.

## Artifacts and Notes

Baseline evidence:

- Checkpoint: `7952021 feat: add Dynadot auction discovery slice`.
- Local inventory after the last live sync: 426,400 listings total, 426,398 active, 2 inactive.
- Current table: domain search, one source filter, six sorts, fixed 50-row pages.
- Current user-visible gap: `Ends` is a long UTC timestamp; stored bidder, link, visitor, appraisal, and renewal fields are not displayed or filterable.
- Current metric gap: Majestic Topic and Ahrefs DR are not ingested and remain truthful em dashes.
- Existing provider-free proof: migrations, guarded upsert, stale rejection, failure/success reconciliation, filtering, sorting, and 50-plus-1 pagination against disposable real D1.

Milestone 1 benchmark evidence (real local D1, 426,398 active rows, count-only output, four repeated timings per shape):

- TLD `.com`: 112,015 matches; warm count 96-97 ms, 50-row end-sort page 101-104 ms.
- Domain length 8-15: 290,417 matches; warm count 53-54 ms, 50-row length-sort page 72-81 ms.
- No hyphen and no digit: 239,166 matches; warm count 119-122 ms, 50-row page 125-155 ms.
- Price 100-50,000 cents plus ending cutoff: 32,153 matches; warm count 48-51 ms, 50-row page 51-52 ms.
- `EXPIRED` plus at least three bids: 468 matches; warm count 50-52 ms, 50-row page 51-54 ms.
- Links, visitors, appraisal, and renewal thresholds together: 163 matches; warm count 46-48 ms, 50-row page 46-48 ms. Individual threshold counts were 373-333,891 matches and 48-68 ms warm.
- Deliberately broad substring `a` plus price and no-hyphen filters: 184,065 matches; warm count 101-105 ms, 50-row page 111-116 ms.
- Bounded 250-value TLD facet: 361-649 ms warm.
- Query plans searched active rows through `auction_listings_status_provider_idx`; expression sorts used a temporary B-tree for ordering and the TLD facet used one for grouping. These plans and timings meet the ordinary sub-second and substring two-second investigation targets without a migration.

Reproducible benchmark rerun with `corepack pnpm benchmark:filters` (one warm-up, five measured runs, D1 duration metadata):

- TLD `.com`: count mean 74.2 ms, 50-row mean 80.8 ms.
- Length 8-15: count mean 44 ms, 50-row mean 62 ms.
- No hyphen and no digit: count mean 81.2 ms, 50-row mean 93.8 ms.
- Price and ending cutoff: count mean 42.6 ms, 50-row mean 44 ms.
- Auction type and bids: count mean 43.2 ms, 50-row mean 43.6 ms.
- Individual links, visitors, appraisal, and renewal filters: count means 34.6-39.8 ms, 50-row means 34.6-57.6 ms.
- Broad substring plus price and shape: count mean 82.8 ms, 50-row mean 92 ms.
- Production-sized TLD facet: aggregate-count mean 277.8 ms and 250-value mean 282.8 ms. The benchmark uses the same `LIMIT 250` as `queryDomainListingsWithDatabase`; the earlier 50-value reproducible sample is superseded by this run.
- Every shape reported the status/provider index; ordered pages reported a temporary ordering B-tree, and the facet reported temporary grouping/ordering B-trees. No domain names or result rows were emitted.

Preserve aggregate benchmark output and query plans here or in a small checked-in text artifact only when they materially explain a schema/index decision. Do not preserve domain names, full result rows, `.env` values, or raw provider data.

## Interfaces and Dependencies

The expanded pure filter interface should remain owned by `src/domain/domain-table.ts` and be equivalent to:

    {
      query?: string;
      sources: string[];
      auctionTypes: string[];
      tlds: string[];
      domainLengthMin?: number;
      domainLengthMax?: number;
      noHyphens: boolean;
      noDigits: boolean;
      priceMinCents?: number;
      priceMaxCents?: number;
      bidsMin?: number;
      biddersMin?: number;
      ageMin?: number;
      ageMax?: number;
      linksMin?: number;
      visitorsMin?: number;
      appraisalMinCents?: number;
      renewalMaxCents?: number;
      endingWithin?: '1h' | '6h' | '24h' | '3d' | '7d';
      sort:
        | 'domain'
        | 'source'
        | 'price'
        | 'bids'
        | 'bidders'
        | 'endsAt'
        | 'age'
        | 'links'
        | 'visitors'
        | 'appraisal'
        | 'renewal'
        | 'domainLength';
      direction: 'asc' | 'desc';
      page: number;
      pageSize: 50;
    }

Exact property names may change once parser tests make a clearer distinction, but one normalized object must be shared by URL construction, chip construction, query predicates, sort selection, and component props. Do not pass raw `searchParams` into the query layer.

Repeated categories share `DOMAIN_TABLE_CATEGORY_VALUE_LIMIT`, currently 64. Parsing retains the first valid unique source values, then auction-type values, then TLD values until that shared budget is exhausted; later values are discarded. With all scalar predicates and pagination bindings, every accepted production row query remains below D1's 100-bound-parameter limit.

`queryDomainListingsWithDatabase(filters, database)` remains the database-bound production interface used by both the server-only Next wrapper and disposable integration worker. Its result must include rows, total, effective page, freshness, and bounded categorical facets. Browser components still must not import server modules.

If domain-derived storage is selected, fields belong to `domains`, not provider listings. The ingestion storage boundary must populate them for every newly encountered domain, and a reviewed migration must backfill existing rows. Keep normalized domain identity as the primary key and do not copy provider response shapes into the domain table.

Continue with Next.js 16, React 19, D1, Drizzle ORM 0.44.7, Drizzle Kit 0.31.10, Tailwind 4, and repository-owned shadcn components. Add no new table library. Add shadcn primitives through its CLI only when the milestone uses them. Any new runtime dependency requires a concrete behavior that existing platform and component code cannot reasonably supply.

Revision note (2026-07-13 / Codex): Created after checkpoint `7952021` to turn the first real table into a practical comparison tool. The initial revision defines the complete stored-data filter set, URL and null semantics, a measured schema/index decision gate for domain-derived filters, the quick-plus-advanced control model, the row/cell hierarchy, human-readable time and money rules, and provider-free performance and acceptance evidence. It explicitly defers enrichment, providers, scheduling, remote state, and unrelated dashboard features. Updated at 12:32Z after Milestone 1 to preserve real-inventory query counts, timing ranges, query-plan evidence, the no-migration decision, the completed query/filter behavior, and disposable-D1 coverage. Updated after specification review to record the 64-value shared category budget, 82-bind worst accepted row shape, and stronger exact ordering, tie-break, null-placement, and page-clamping proof. Updated after quality review with independent boundary/near-miss D1 evidence for every predicate and the reproducible, local-only `benchmark:filters` command and rerun aggregates. Updated after re-review with separate digit-only and hyphen-only shape fixtures and production-sized `LIMIT 250` facet benchmark evidence superseding the earlier 50-value sample. Updated at 13:10Z to record the single-form sheet/multi-select implementation, applied-summary behavior, client-boundary decision, and complete configured unit coverage. Corrected after specification review to keep Milestone 2 in progress, record the canonical-key client-navigation resynchronization proof, and leave actual browser/workerd acceptance in Milestone 4. Updated after quality review to record constrained long chips, explicit portal-form evidence, parser-aligned client limits and reversed-range feedback, focused filter component decomposition, reduced-motion behavior, and overscroll containment. Updated after re-review to record the single active named maximum-bid control and visible native-validity target while the sheet is open.

Revision note (2026-07-13 14:04Z / Codex): Completed Milestone 4 implementation with isolated deterministic E2E persistence, four populated-table browser tests, desktop and 375-pixel computed geometry/interaction evidence, interface-guideline corrections, matching durable documentation, complete local validation, and a fresh sanitized 426,400-row benchmark. The plan remains active until independent review and final port-30001 inspection.

Revision note (2026-07-13 14:22Z / Codex): Corrected the first Milestone 4 specification-review findings. E2E lifecycle work now shares one awaited cleanup promise, installs signal handling before setup, runs under awaited Playwright global teardown, and rejects the run if its exact UUID-prefixed directory remains; a focused lifecycle test covers cleanup coalescing, shutdown ordering, and directory removal. Browser geometry now proves the sticky intersection is the top rendered hit over a genuinely overlapping non-sticky body cell at both widths. The remaining guideline fixes add sortable hover, consistent non-auth autocomplete hints, and real-ellipsis placeholders.

Revision note (2026-07-13 14:28Z / Codex): Corrected the remaining readiness finding by centralizing the E2E host/port, rejecting an occupied port before spawn, seeding a UUID-bearing domain, and requiring the filtered page for that UUID before tests start. The lifecycle proof now also covers occupied-port rejection without disturbing the listener.

Revision note (2026-07-13 14:36Z / Codex): Corrected the dotenv-isolation finding by building E2E artifacts from an allowlisted temporary source workspace rather than the repository root. The workspace excludes dotenv and local-state paths by construction, recreates dependencies offline from the frozen lockfile, publishes only `.open-next`, and is always removed. A controlled sentinel test verifies the copy boundary, and the successful isolated Next build no longer reports a repository environment file. Browser URL assertions now reuse the centralized base URL.

Revision note (2026-07-13 14:42Z / Codex): Corrected clean-checkout compatibility by removing generated `next-env.d.ts` from the isolated source manifest. The controlled copy test supplies but rejects that source file, while the successful isolated Next build creates its own workspace-local declaration as needed.

Revision note (2026-07-13 14:51Z / Codex): Corrected final quality-review findings. Source and auction-type facet queries now bind only their small parser allowlists, with disposable-D1 evidence that supported stored values remain and unsupported values never reach controls. More-filter dismissal now cancels controlled and uncontrolled drafts consistently, including repeated auction types and shape checkboxes, for both Dismiss and Escape. E2E setup/preview trees use platform-safe detached process-group cleanup, and the results scroll region has region semantics, visible focus, and real keyboard-scroll evidence at desktop and 375 pixels. `corepack pnpm check:quick` passes with 163 tests and 100% configured coverage; `corepack pnpm test:integration`, `corepack pnpm test:e2e` (four Chromium tests), and focused lifecycle/component tests also pass.

Revision note (2026-07-13 14:54Z / Codex): Completed the plan after independent specification and quality approval. The final production build, migration-history check, full local gate, and diff validation pass. The real local-inventory application and D1 health endpoint both return HTTP 200 on port 30001.

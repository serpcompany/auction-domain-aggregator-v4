# Execution plans

An execution plan, or ExecPlan, is a living repository-local specification that a human or coding agent can follow to deliver a working outcome. It must contain enough current context to resume the work using only the repository and the plan, without relying on chat history.

## When to use one

Create an ExecPlan for a multi-session feature, a significant architectural change or migration, or work with important unknowns that requires a proof of concept. Do not create one for a small, well-understood change that can be implemented and verified in one focused pass.

## Location and lifecycle

Store work in progress at `docs/plans/active/<descriptive-name>.md`. When the intended outcome is implemented and verified, move the plan to `docs/plans/completed/` and record the final outcome and remaining gaps.

Then cut the completed plan to an outcome summary of about 30 to 80 lines: what was built, the key decisions and why, the discoveries a later change could trip over, the evidence, and the follow-ups. Git holds the full plan, and the summary names the commit to `git show` it from. Progress logs, concrete steps, revision notes, and machine-specific paths do not survive into the summary. Current behavior belongs in `ARCHITECTURE.md` or `docs/technical-design/`, not in a completed plan.

Create the `active/` and `completed/` directories when the first plan reaches each state; empty directory scaffolding is unnecessary.

## Authoring and execution

Before authoring or implementing an ExecPlan, read this file in full. Begin with the required section structure below and replace every placeholder with repository-specific facts. Explain unfamiliar terms when they first appear and repeat context that the executor would otherwise have to infer.

Keep the plan accurate while work proceeds. Update progress at every stopping point, record unexpected evidence in `Surprises & Discoveries`, and record choices and rationale in `Decision Log`. Implementation should continue through milestones without treating each milestone as a new request for direction. Escalate only when a decision requires product judgment or authority not provided by the plan.

When research exposes a meaningful unknown, include an additive, runnable proof-of-concept milestone with explicit success and discard criteria. Do not let a prototype silently become production structure.

## Required qualities

Every ExecPlan must be self-contained, understandable to a repository newcomer, safe to resume, and aimed at observable behavior rather than file creation alone. It must state exact working directories and commands, expected results, validation beyond compilation, and recovery for steps that can fail partway through. It must name concrete repository-relative paths and be explicit about required interfaces and dependencies while leaving incidental implementation choices flexible.

Use prose for explanation and reserve checkboxes for `Progress`. Milestones must tell the story of the work: what becomes possible, what changes, how to run it, and what proves it works.

## Required sections

Every ExecPlan must contain these sections in this order:

1. `Purpose / Big Picture`: the outcome, why it matters, and how a person can observe it.
2. `Progress`: timestamped checkboxes that always reflect the actual state.
3. `Surprises & Discoveries`: unexpected behavior with concise evidence.
4. `Decision Log`: decisions, rationale, date, and author.
5. `Outcomes & Retrospective`: achieved behavior, gaps, and lessons, updated at milestones and completion.
6. `Context and Orientation`: the relevant current repository state, paths, and defined terms.
7. `Plan of Work`: narrative milestones and the edits each milestone requires.
8. `Concrete Steps`: exact commands, working directories, and short expected output.
9. `Validation and Acceptance`: observable behavior and the checks that prove it.
10. `Idempotence and Recovery`: safe reruns, cleanup, retry, and rollback behavior.
11. `Artifacts and Notes`: concise evidence worth preserving.
12. `Interfaces and Dependencies`: required packages, services, configuration, and stable interfaces.

End the file with a revision note describing every material plan change and why it was made. An ExecPlan that consists entirely of Markdown should not wrap itself in an outer code fence.

## Active plans

- [Paid SaaS: accounts, subscription, payment-gated access](active/saas-accounts-and-billing.md) (#27): read it before touching accounts, billing, or the website deploy.

## Completed plans

Read one to learn why something was built the way it was; current behavior is in the technical design.

- [Bootstrap the application harness](completed/bootstrap-application-harness.md): the Next.js, OpenNext, local D1, and check toolchain, and why each piece was chosen.
- [Dynadot domain table](completed/dynadot-domain-table.md): the first schema, the segmented guarded sync, and the first D1 table.
- [Domain table filtering and presentation](completed/domain-table-filtering-and-presentation.md): the URL filter contract, its null and bind-budget rules, and the isolated e2e harness.
- [Multi-provider ingestion](completed/multi-provider-ingestion.md): the provider-neutral adapter, sync, storage, and registry.
- [Ahrefs Domain Rating](completed/ahrefs-domain-rating.md): on-demand, write-once DR and its licence constraints.
- [GoDaddy ingestion](completed/godaddy-ingestion.md): the first file feed and the feed-published SEO metrics.
- [Indexed TLD and length facets](completed/indexed-tld-length-facets.md): generated columns, the facet read model, and the request benchmark.
- [Cloud ingestion](completed/cloud-ingestion.md): the cron-started Workflow, R2 staging, and the CPU measurements behind it.
- [UI redesign](completed/ui-redesign.md): the stock shadcn rebuild and its [approved mockups](completed/ui-redesign-mockups.html).

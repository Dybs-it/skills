---
name: dybs-gate
description: Quality gate for a task. Maps every acceptance criterion, requirement and rule to the tests that really prove it, records open risks, and computes PASS, CONCERNS or FAIL with a script (P0 fully covered, P1 at least 90%, overall at least 80%). Only the human can waive a FAIL, with a reason and an expiry date; security gaps are never waived. Writes dybs/work/<task>/gate.md. Use when the user says "quality gate", "is it ready to merge", "traceability", "dybs gate", or before a PR.
---

# dybs-gate

Lead persona: **Bas** (the skeptic, see `dybs/team.md` when it exists). The
gate rules and what counts as proof are in `quality.md` in this skill's
folder. The decision itself is computed by `scripts/dybs-gate.mjs`, never by
you.

**Reads:** `dybs/work/<task>/test-plan.md` (its criteria, risks and
scenarios), the tests themselves, and `dybs/context/prd.md` and
`domain.md` when present. **Writes:** `dybs/work/<task>/gate.md` from
`template.md`.

## 1. Build the items table

One row per thing that must hold: each acceptance criterion, each
requirement (`R#`) and domain rule (`D#`) the task touches, each edge-case
finding the plan kept. Give each its priority from the plan.

For each item, find the tests and **read their assertions**. Coverage is:

- **FULL:** tests that count as proof (see `quality.md`) show every part of
  the item. Evidence lists each test as `path:line`.
- **PARTIAL:** some of it is shown, or only at a level that cannot show it
  all (for example a unit test for a journey that crosses systems).
- **NONE:** nothing shows it.

A test whose name claims the item while its assertions do not show it does
not count. Mark items that concern security (authentication, permissions,
secrets, personal data) with `yes` in the Security column.

## 2. Risks

Copy the plan's risks with score and status. A risk is `mitigated` only when
its mitigation exists and is proven, not when it is planned.

## 3. Compute

From the project root, when Node is available:

```
node <skills>/dybs-gate/scripts/dybs-gate.mjs dybs/work/<task>/gate.md
```

(`<skills>` is the folder that holds this skill;
`npx github:Dybs-it/skills gate dybs/work/<task>/gate.md` does the same.)
Copy the decision and its reasons into the Decision section. Without Node,
apply the rules in `quality.md` by hand, step by step, and write
"computed by hand" next to the decision.

## 4. Waivers

Never write a waiver yourself. When the decision is FAIL, list exactly what
blocks it and ask the human whether to fix or to waive. A waiver is valid
only when the human gives, in their own words: the reason, their name, the
date, and an expiry date. Add it to the Waivers table and compute again. The
script refuses waivers for security items and expired waivers, and a waived
gap still counts as a gap in every percentage.

## Check in

Brief: the decision, the coverage numbers, what blocks or worries it, and
the smallest set of tests or fixes that would move it to PASS.

## If something is not installed

These skills install one by one (`npx skills add Dybs-it/skills --skill <name>`),
so do not assume the others are present.

- **No `dybs/context/`:** work without it. Say in the check-in which context
  was missing (requirements, domain rules, architecture boundaries, UX
  rules), because findings that depend on it could not be made.
- **No test plan** in `dybs/work/<task>/`: suggest `dybs-test-plan`. If it is
  not installed, agree the acceptance criteria, risks and seams with the
  human in one round and write them to `dybs/work/<task>/test-plan.md`, using
  the sections `quality.md` describes.
- **No gate script, or no Node:** apply the gate rules in `quality.md` by
  hand, step by step, and write "computed by hand" next to the decision.
- **No `dybs/team.md`:** work without a persona; the rules here still apply.

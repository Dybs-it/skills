---
name: dybs-test-plan
description: Decide what to test for a task or a part of the code, and why. Scores risks, sets P0 to P3 priorities, picks the lowest test level that proves each behaviour, agrees the seams with the human, turns acceptance criteria into given/when/then scenarios, and hunts unhandled edge cases in the code. Writes dybs/work/<task>/test-plan.md. Use when the user says "test plan", "what should we test", "edge cases", "dybs test plan", or before writing tests for a task or code area.
---

# dybs-test-plan

Lead persona: **Bas** (the skeptic, see `dybs/team.md` when it exists). The
vocabulary (risk, priority, levels, seams, proof) is in `quality.md` in this
skill's folder; read it first.

Parts are adapted from MIT-licensed work by Matt Pocock and BMad Code, LLC;
their copyright notices are in the header of `quality.md` in this folder.

**Reads:** the task (`dybs/work/<task>/task.md` if it exists, otherwise what
the human describes), the code in scope, and when present `dybs/context/`:
PRD requirements (`R1`...), domain rules (`D1`...), UX rules, architecture
quality bars and test commands. **Writes:** `dybs/work/<task>/test-plan.md`
from `template.md`.

## 1. Pin the scope

Name the task folder (`<task>`, see `quality.md`) and the code in scope:
files, routes, modules. For existing code, read it. State in two lines what
is in scope and what is not.

## 2. Acceptance criteria

List what must be true when the work is done, each as given/when/then, with
a priority (P0 to P3, see `quality.md`), and link it to the requirement or
rule it comes from (`R3`, `D2`). If the task
has no criteria, derive them from the context docs and mark them
*(proposed)* for the human to confirm.

## 3. Risks

List what can really go wrong (not features), with category, probability,
impact and score, as `quality.md` defines. Every score of 6 or more needs a
mitigation: usually a test, sometimes a design change.

## 4. Edge-case hunt

Walk the code in scope mechanically, path by path, rather than by
intuition. Report only paths that are **not handled**:

- every branch, loop boundary, early return and error handler
- the members of a fixed set the code does not handle (an enum, a status,
  a flag): if it handles two of three states, the third is a finding
- inputs that are empty, missing, duplicated, too large, in the wrong
  format, or arrive twice or out of order
- something the code re-checks or re-fetches: what changed in between, and
  what is skipped when the re-check fails
- every call the code makes: arguments checked against the callee's
  signature (count, order, types, defaults)
- code that was removed: did it carry a rule nothing else enforces now?

Each finding: location (`path:line`), the condition that triggers it, the
smallest guard that closes it, and what goes wrong otherwise. Do not rank
them here; the scenarios below give them priority.

## 5. Seams

Propose the seams where tests will observe behaviour, using the existing
ones first and the fewest new ones possible. Ask the human to confirm them
in one numbered round with a recommended answer per question. No test is
planned at a seam the human has not confirmed. With `checkins: none` in
`dybs/project.md`, use the existing seams only and say so.

## 6. Scenarios

One row per scenario: id (`<task>-<LEVEL>-<nn>`, for example
`invites-INT-02`), priority, level, seam, given/when/then, and what it covers
(a criterion, requirement, rule, risk or edge-case finding). Every P0 and P1
criterion, every risk of 6 or more and every edge-case finding that matters
gets at least one scenario. Prefer the lowest level that proves it.

## Check in

Validate by hand: every criterion and every risk of 6 or more is covered by
a scenario; every scenario names a confirmed seam. Then give a short brief:
the scenarios by priority, the risks still open, and what needs the human
(unconfirmed criteria or seams, risks without an owner).

## If something is not installed

These skills install one by one (`npx skills add Dybs-it/skills --skill <name>`),
so do not assume the others are present.

- **No `dybs/context/`:** work without it. Say in the check-in which context
  was missing (requirements, domain rules, architecture boundaries, UX
  rules), because findings that depend on it could not be made.
- **No test plan** in `dybs/work/<task>/`: `dybs-test-plan` writes it (when
  you are `dybs-test-plan`, that is your job now). Any other quality skill
  suggests `dybs-test-plan`; if it is not installed, agree the acceptance
  criteria, risks and seams with the human in one round and write them to
  `dybs/work/<task>/test-plan.md`, using the sections `quality.md` describes.
  With `checkins: none` in `dybs/project.md`, ask nothing: take the criteria
  and risks from the task and its context, use the existing seams only, and
  say so in the plan.
- **No gate script, or no Node:** the gate is not decided. Write
  `Decision: not computed (no gate script)`, list what looks blocking against
  the rules in `quality.md`, and say it must be computed before merging. It
  never counts as PASS.
- **No `dybs/team.md`:** work without a persona; the rules here still apply.

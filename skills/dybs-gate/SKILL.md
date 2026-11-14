---
name: dybs-gate
description: Quality gate for a task. Maps every acceptance criterion, requirement and rule to the tests that really prove it, records open risks, and computes PASS, CONCERNS or FAIL with a script (P0 fully covered, P1 at least 90%, overall at least 80%). Only the human can waive a FAIL, with a reason and an expiry date; security gaps are never waived. Writes dybs/work/<task>/gate.md. Use when the user says "quality gate", "is it ready to merge", "traceability", "dybs gate", or before a PR.
---

# dybs-gate

Lead persona: **Bas** (the skeptic, see `dybs/team.md` when it exists). The
gate rules and what counts as proof are in `quality.md` in this skill's
folder. The decision itself is computed by `scripts/dybs-gate.mjs`, never by
you.

Parts are adapted from MIT-licensed work by Matt Pocock and BMad Code, LLC;
their copyright notices are in the header of `quality.md` in this folder.

**Reads:** `dybs/work/<task>/test-plan.md` (its criteria, risks and
scenarios), `dybs/work/<task>/review.md` when present, the tests themselves, and `dybs/context/prd.md` and
`domain.md` when present. **Writes:** `dybs/work/<task>/gate.md` from
`template.md`.

## 1. Build the items table

Start from the script, so the same plan gives the same table every time.
From the project root:

```
node '<skills>/dybs-task/scripts/dybs-route.mjs' items 'dybs/work/<task>'
```

It prints the Items and Risks tables from `test-plan.md`: one row per
acceptance criterion and per requirement (`R#`) and domain rule (`D#`) the
criteria cite, with its priority (the item's own, raised to the highest of
any scenario covering it, **P0** when neither gives one) and its coverage
(FULL only when every covering scenario is green or proven and names its
test as `path:line`). Copy both tables into `gate.md` as printed.

Then check the script's claims against the tests. For each FULL row, **read
the assertions** of the tests it cites:

- A test whose name claims the item while its assertions do not show it
  does not count (see "What counts as proof" in `quality.md`). Lower the row
  to PARTIAL or NONE and say why in one line under the table.
- Lower to PARTIAL when the tests show only part of the item, or only at a
  level that cannot show it all (a unit test for a journey that crosses
  systems).

You may **lower** a row's coverage. Never raise one, never change a
priority, never drop a row. Set Security to `yes` on items that concern
authentication, permissions, secrets or personal data.

Without the script or Node, build the table by hand under the same rules,
and say so in the Decision section.

## 2. Risks

The script printed the plan's risks with category, P, I, score and status
(the gate script checks that the score is P × I). A risk is `mitigated` only when
its mitigation exists and is proven, not when it is planned.

Then read `review.md` when it exists. Every finding still open that is a
defect or a gap in proof becomes a row too: a missing or wrong behaviour as
an item (security `yes` when it concerns security), anything else as a risk
scored like the plan's. A finding the human decided not to fix stays a row
and needs a waiver like any other gap.

## 3. Compute

From the project root, when Node is available:

```
node '<skills>/dybs-gate/scripts/dybs-gate.mjs' 'dybs/work/<task>/gate.md'
```

(`<skills>` is the folder that holds this skill.) Keep both paths in single
quotes, and check `<task>` against the naming rule in `quality.md` first. A
path that holds a `'`, or a task folder named against that rule, is never put
in a command: stop and ask the human to rename it. The evidence must be
committed first: if `git status --porcelain --untracked-files=all` shows any change other than
this task's `gate.md`, `pr.md` and `log.md` (code, tests, and the gate's inputs such as
`review.md`, `test-plan.md`, `task.md` and the context docs all count),
ask the human to commit them (or do it on their word). If they would rather
not, write `commit: uncommitted` and say so: a gate on uncommitted work
proves nothing about a commit, it is stale and not decided. Then set `commit:` in
the frontmatter to the last commit that changed anything besides those three
files (`git log -1 --format=%h -- . ':(exclude,literal)dybs/work/<task>/gate.md'
':(exclude,literal)dybs/work/<task>/pr.md'
':(exclude,literal)dybs/work/<task>/log.md'`), once the tables are checked against
it, and run the script. In a git repository the script itself refuses to
decide (`STALE`, exit 3) while other changes are uncommitted, while a
tracked file is flagged assume-unchanged or skip-worktree (git status cannot
see its edits), while a test cited as FULL evidence is not a regular file in
the evidence commit (missing, ignored by Git, a link, outside the
repository, or cited with a `\` instead of `/`) or is cited at a line past its end, while a gate input (the
task's files or a context doc, or `dybs/context` itself) is ignored by Git, is a link, or is a FIFO, socket or device, while the task folder is named against the rule in `quality.md`, while `commit:` names another commit, or for any file that is not `dybs/work/<task>/gate.md`; never write a decision it did not give. The script proves the cited
tests and the gate's own inputs are committed; it does not prove the tests
pass from a clean checkout, and files Git ignores (dependencies, build
output, local config) are not looked at. Running the tests in a clean
checkout is CI's job: say so in the Decision section when no CI run on the
evidence commit is cited. Cite a test location as plain `path:line`, or in a
code span when the path holds a space, a comma or any Markdown character. Copy
the decision and its reasons into the Decision section. (Committing
`gate.md`, `pr.md` and `log.md` afterwards changes no evidence, so it never makes the
gate stale.) Without Node
or without the script, **do not decide**: write `Decision: not computed (no
gate script)`, list what looks blocking against the rules in `quality.md` as
findings, and say the gate must be computed before merging. A gate that was
not computed never counts as PASS.

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

Last, log the run (see "Model, effort and the run log" in `quality.md`), with
the decision as the note.

## If something is not installed

These skills install one by one (`npx skills add Dybs-it/skills --skill <name>`),
so do not assume the others are present.

- **No `dybs/context/`:** work without it. Say in the check-in which context
  was missing (requirements, domain rules, architecture boundaries, UX
  rules), because findings that depend on it could not be made.
- **No test plan** in `dybs/work/<task>/`: a task in the fast lane has none
  by design (see "Lanes" in `quality.md`). Otherwise `dybs-test-plan` writes it (when
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
- **No routing script** (`dybs-task/scripts/dybs-route.mjs`), or no Node: skip
  the run log and say so. Take the next step from the order in `quality.md`,
  and stay on the model you are.
- **No `dybs/team.md`:** work without a persona; the rules here still apply.

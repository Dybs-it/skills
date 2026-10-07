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

One row per thing that must hold: each acceptance criterion, each
requirement (`R#`) and domain rule (`D#`) the task touches, each edge-case
finding the plan kept. Its priority is fixed by one rule, never chosen:

1. the priority the plan gives the item itself (every criterion has one);
2. raised to the highest priority of any scenario that covers it;
3. **P0** when neither gives one (an unprioritised item is treated as the
   most important, never the least).

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

Copy the plan's risks with category, P, I, score and status (the script
checks that the score is P × I). A risk is `mitigated` only when
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
this task's `gate.md` and `pr.md` (code, tests, and the gate's inputs such as
`review.md`, `test-plan.md`, `task.md` and the context docs all count),
ask the human to commit them (or do it on their word). If they would rather
not, write `commit: uncommitted` and say so: a gate on uncommitted work
proves nothing about a commit, it is stale and not decided. Then set `commit:` in
the frontmatter to the last commit that changed anything besides those two
files (`git log -1 --format=%h -- . ':(exclude,literal)dybs/work/<task>/gate.md'
':(exclude,literal)dybs/work/<task>/pr.md'`), once the tables are checked against
it, and run the script. In a git repository the script itself refuses to
decide (`STALE`, exit 3) while other changes are uncommitted, while a
tracked file is flagged assume-unchanged or skip-worktree (git status cannot
see its edits), while a test cited as FULL evidence is not a regular file in
the evidence commit (missing, ignored by Git, a link, outside the
repository, or cited with a `\` instead of `/`) or is cited at a line past its end, while a gate input (the
task's files or a context doc, or `dybs/context` itself) is ignored by Git, is a link, or is a FIFO, socket or device, while the task folder is named against the rule in `quality.md`, while `commit:` names another commit, or for any file that is not `dybs/work/<task>/gate.md`; never write a decision it did not give. Copy
the decision and its reasons into the Decision section. (Committing
`gate.md` and `pr.md` afterwards changes no evidence, so it never makes the
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

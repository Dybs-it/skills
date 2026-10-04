---
name: dybs-pr
description: Write a pull request description a reviewer can take in at a glance - a visual summary of what changed, before-and-after evidence that it works, the gate result, and the merge danger (one-way or two-way door, blast radius). Writes dybs/work/<task>/pr.md and uses it as the PR body. Use when the user says "write the PR", "PR description", "open a PR", "dybs pr".
---

# dybs-pr

Lead persona: **Noor** (product lead, see `dybs/team.md` when it exists).
`quality.md` in this skill's folder explains the gate and what counts as
proof.

**Reads:** the diff, `dybs/work/<task>/` (task, test plan, review, gate)
when present, and `dybs/context/domain.md` for the project's words.
**Writes:** `dybs/work/<task>/pr.md` from `template.md`, and the PR body
from it when the human asks to open or update the PR.

Keep it short. No preamble, no restating the diff line by line. Use the
glossary's terms.

## Summary

One or two sentences on what changes for the user or the system, with the
requirement ids (`R3`, `D2`). Then **one** small picture of the change,
whichever shows it fastest:

- a short call tree or pseudocode for logic and control flow
- a shallow file tree for a refactor or new files
- a component tree for a UI change
- a small Mermaid diagram for how parts talk to each other
- a `diff`-style sketch of that tree when the point is what changed in an
  existing shape

Only the parts that matter to the reviewer. Never paste real code the
reviewer will see in the diff anyway.

## Evidence

Before and after, as concrete as the environment allows:

- a screenshot pair for a visible change (best)
- the test that failed before and passes now, or command output (good)
- the gate decision with its coverage numbers from `gate.md`

Say plainly what was **not** verified.

## Merge danger

- **Door:** one-way (hard to undo: data migrations, deleted data, public
  API or contract changes, anything sent to users) or two-way (a revert
  undoes it).
- **Blast radius:** one word, then what could break and for whom: other
  parts of the system, consumers of an API, mobile layouts, existing data.

## Check in

Show the human the PR text before opening or updating the PR. Opening a PR
is outward-facing: do it only on their word.

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

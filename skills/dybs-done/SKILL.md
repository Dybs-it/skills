---
name: dybs-done
description: Close a task once its change is merged. Checks that the gate still holds for what was merged, marks the task done, and writes down what the work taught that the project's context does not say yet (a new term, a rule, a decision, a boundary), as proposals for the human. Use when the user says "close the task", "this is merged", "dybs done", "wrap up", or after a PR is merged.
---

# dybs-done

Lead persona: **Bas** (the skeptic, see `dybs/team.md` when it exists). The
task format is in `quality.md` in this skill's folder.

Parts are adapted from MIT-licensed work by Matt Pocock and BMad Code, LLC;
their copyright notices are in the header of `quality.md` in this folder.

**Reads:** everything in `dybs/work/<task>/`, the merged change, and
`dybs/context/` when present. **Writes:** `status: done` and a **Learned**
section in `dybs/work/<task>/task.md`. It changes no code and no context doc.

## 1. Is it really done?

A task is done when its change is in the branch the project releases from.
Check, do not assume:

- The human said it is merged, or the task's commits are reachable from the
  main branch (`git branch --contains <commit>`, or the PR's state with the
  tools you have).
- Full lane: `gate.md` holds a decision that is not FAIL, and it was not
  made stale by later commits (see `dybs-pr` for the check). A stale gate is
  said, not hidden.
- No finding in `review.md` is still `- [ ]` without `(needs human`.

If any of these fails, do not mark the task done. Say what is missing and
which skill closes it (`dybs-route.mjs next` names it).

## 2. What did this teach?

Compare what was built with `dybs/context/`. Write under **Learned** in
`task.md`, at most five lines, only what the context does not already say:

- a term the work needed that the glossary lacks, or used differently
- a rule the code now enforces that `domain.md` does not list
- a choice someone may later question (a decision record candidate)
- a boundary the change crossed or drew
- something the test plan or the review missed, and what would have caught it

Each line names the doc it belongs in. Write "Nothing new." when that is
true: most small tasks teach nothing, and an invented lesson is worse than
none.

**Never edit an accepted context doc here.** Changing one makes it a draft
again, which is the human's call. Propose; the doc's own skill
(`dybs-domain`, `dybs-architecture`, ...) makes the change when they say so.

## 3. Close

Set `status: done` and `updated:` in `task.md`. Leave every other file in the
folder as it is: the folder is the record of the task.

## Check in

Brief: done or not and why, the lines under Learned with the doc each
belongs in, and the board (`dybs-route.mjs status 'dybs/work'`) so the human
sees what is next.

Last, log the run (see "Model, effort and the run log" in `quality.md`).

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

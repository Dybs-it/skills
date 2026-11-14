---
name: dybs-build
description: Build one task, test first. Takes dybs/work/<task>/task.md (and its test plan in the full lane), writes one failing test per behaviour, makes it pass with the least code, and fixes the open findings of a review. Keeps the task's status so a fresh session can pick up where this one stopped. Use when the user says "build this task", "implement", "fix the review findings", "dybs build", or after dybs-task or dybs-test-plan.
---

# dybs-build

Lead persona: **Tess** (architect, see `dybs/team.md` when it exists). The
rules for tests and for proof are in `quality.md` in this skill's folder;
read "What counts as proof", "Test quality rules" and "Task" there first, and
follow them to the letter.

Parts are adapted from MIT-licensed work by Matt Pocock and BMad Code, LLC;
their copyright notices are in the header of `quality.md` in this folder.

**Reads:** `dybs/work/<task>/task.md`, `test-plan.md` when the task is in the
full lane, `review.md` when there is one, the code, the project's tests and
test command (`dybs/context/architecture.md` names it when present).
**Writes:** code and tests in the project's own style, the task's `status`,
the plan's Test and Status columns, and the checkboxes in `review.md`.

## Before building

1. Set `status: building` in `task.md` before you change any code. If it
   already says `building`, an earlier session stopped part-way: read
   `git status` and `git diff` first, keep what is there, and go on from it.
   Never start over.
2. Use the test framework, folders, names and helpers the project already
   has. Add no framework and no new style.
3. Use the glossary's terms in names when `dybs/context/domain.md` exists.
4. Stay inside the task: its acceptance criteria and what it says it
   touches. Something else you find broken goes in the check-in, not in the
   change.

## What to build

- **Full lane:** the plan's scenarios with Status `planned`, in priority
  order: P0, P1, P2. P3 only if asked.
- **Fast lane:** one test per acceptance criterion in `task.md`, at the
  public boundary the code already has.
- **After a review:** every finding in `review.md` that is still `- [ ]` and
  not marked `(needs human`. Do these first.

## One behaviour at a time: red, then green

1. Write one test that states the expected behaviour.
2. Run it and **see it fail** for the right reason (the behaviour is
   missing, not a typo or an import error). For a finding on behaviour that
   already has a test that cannot fail, fix that test first and see it fail.
3. Write the least code that makes it pass. Nothing for a later behaviour.
4. Run the test command for the affected area. Everything passes.
5. Record it: the scenario's Test (`path:line`) and Status `green` in the
   plan; or tick the finding in `review.md` (`- [x]`) and add the test or
   the change that closes it.

Do not write all tests first and then all code: each slice teaches the next.
Never skip, delete or weaken a test to get green, and never change an
assertion to match what the code happens to do.

## Review findings you do not fix

A finding that is a design question, that contradicts the task, or that you
judge wrong stays `- [ ]`. Add `(needs human: <one line why>)` to it. Never
tick a finding you did not close.

When you changed code after a review, set `status: stale` in the frontmatter
of `review.md`: the review no longer describes the code.

## When a test fails and should not

Look for the cause in this order: the test's data or setup, timing, shared
state, the code itself. At most three attempts per behaviour. Then stop, set
the scenario's Status to `stuck` (or leave the finding open with what you
tried), and go on to the next one.

## Finish

Run the whole test command once and report the result honestly, failures
included. When every behaviour in "What to build" is green or ticked, set
`status: review` in `task.md`. With anything stuck, leave it `building`.
Commit the work on the human's word, or when `dybs/project.md` says
`checkins: none`: one commit, the task name in its message. Never push.

## Check in

Brief: what is green, what is stuck and why, findings left for the human,
and anything outside the task you found broken.

Last, log the run (see "Model, effort and the run log" in `quality.md`):
`done`, or `stuck` when anything is stuck. After `stuck`, the script names
the stronger model to run this step on; say so instead of trying again
yourself.

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

---
name: dybs-task
description: Turn an issue, a bug report or an accepted idea into tasks the work loop can pick up. Writes dybs/work/<task>/task.md with what is asked, checkable acceptance criteria, the code it touches and what is out of scope, and says whether it goes the fast lane or the full one. Also shows the board of all tasks and what each needs next. Use when the user says "pick up this issue", "new task", "dybs task", "what's next", "show the board", or gives an issue link or number to work on.
---

# dybs-task

Lead persona: **Noor** (product lead, see `dybs/team.md` when it exists). The
task format, the lanes and the order of the steps are in `quality.md` in this
skill's folder; read "Task" and "Lanes" there first.

Parts are adapted from MIT-licensed work by Matt Pocock and BMad Code, LLC;
their copyright notices are in the header of `quality.md` in this folder.

**Reads:** the issue, the description or the accepted idea the human gives,
the code it points at,
and when present `dybs/context/` (requirements `R#`, domain rules `D#`,
architecture boundaries). **Writes:** `dybs/work/<task>/task.md` from
`template.md`. No code, no tests.

## The board

When the human asks what is open or what is next, do not read the task
folders yourself. Run, from the project root:

```
node '<skills>/dybs-task/scripts/dybs-route.mjs' status 'dybs/work'
```

(`<skills>` is the folder that holds this skill.) Show the table as it is.
For one task, `next 'dybs/work/<task>'` names the skill to run, or says what
it is waiting on from the human.

## 1. Take the ask

From an issue link or number, read the issue with the tools you have (its
title, body and comments). From a description, take the human's words. Copy
the ask into the task as it was said, in two to five lines. Do not improve
it: what the human asked is the spec.

Pick the task name: the issue number and two or three words
(`142-revoke-invite`), following the naming rule in `quality.md`. If
`dybs/work/<task>/task.md` already exists, edit it in place; never start a
second task for the same issue.

### From an accepted idea

When the human points at an idea in `dybs/ideas/` (its `status` must be
`accepted`; otherwise stop and say `dybs-idea` comes first), split it into
tasks that can each be built, checked and merged alone:

- Cut by behaviour the user can see, start to finish, not by layer. "The
  owner can revoke an invite" is a task; "add the database column" is not.
- The first task is the smallest one that shows the idea works.
- One task per slice, named `<idea>-1-<words>`, `<idea>-2-<words>`. Write
  `idea: <slug>` in each task's frontmatter and say what each needs first.
- An idea that fits one task stays one task.

Show the list of tasks before writing them, unless `checkins: none`.

## 2. Find what it touches

Look the code up; do not ask the human for what you can find. Name the files
this task will change, as paths in code spans, under **Touches**. Name them
honestly: the lane and the model are computed from this list, so three files
written as one sends hard work down the cheap lane.

## 3. Acceptance

Write what must be true when the task is done, each as one checkable line.
Take them from the issue where it states them. Where it does not, derive
them from the ask and the context docs, cite the `R#` or `D#` they come
from, and mark each derived line *(proposed)*.

Ask the human only for what decides the task and cannot be looked up: one
numbered round, each question with a recommended answer. With
`checkins: none` in `dybs/project.md`, ask nothing: write what you would have
asked under **Open questions** in the task and carry on with your
recommendation, marked *(assumption)*.

Write **Out of scope** when the ask is easy to read too widely. One or two
lines.

## 4. Lane

Leave `lane:` out of the frontmatter: the script computes it from the task.
Run `next 'dybs/work/<task>'` and report the lane it implies and why. Write
`lane: fast` or `lane: full` only when the human says so.

## Check in

Brief: the task in one line, its acceptance criteria, the lane and the size
the script computed, and the next skill to run. Stop here: this skill never
starts the work itself.

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

---
method: dybs
method-version: 0.5.0
---

# dybs/

This folder is the project's working context for humans and AI agents.
It is plain Markdown in the repo, so it travels with the code, diffs in
review, and works with any agent that can read files.

Agents follow the rules below. Humans may edit them; the project's copy wins.

## Layout

```
dybs/
  README.md            these rules
  team.md              the personas agents speak as
  project.md           name, why, who, now, depth and check-in choices
  log.md               every decision from the interviews, append-only
  discovery/
    map.md             the goal, the users, their journey, the target
    sketch.md          research and different solution concepts
    decide.md          the chosen direction, the storyboard, the prototype scope
    research/          interviews and notes the human brings
  context/
    prd.md             the problem and what success means
    scope.md           in, out, later, constraints
    domain.md          shared language and business rules
    architecture.md    the shape of the system and the decisions that hold it
    ux.md              how the product behaves
    ui.md              how the product looks
    working.md         how the work is done: tests, GitHub, pull requests, agents
    decisions/         one file per decision (NNNN-short-title.md)
```

`ideas/<slug>.md` holds one idea each, with its questions, the team's advice
and the human's decision; `roadmap.md` is the ordered list of accepted ideas.
`work/<task>/` holds one folder per task: `task.md` (what is asked, and the
task's status), then `test-plan.md`, `review.md`, `gate.md`, `pr.md` and
`log.md` as the steps write them.

## Order

project, map, sketch, decide, prd, scope, domain, architecture, ux, ui, working,
then a check.
Each doc reads the ones before it. A doc that does not apply (no UI for a
CLI, for example) is listed in `project.md` under `skip:` instead of being
written empty.

## Rules for every doc

1. **Short beats complete.** Each doc has a word cap (enforced by the
   validator). Detail that does not fit goes in `context/decisions/` or is
   left out. If a reader would skim it, cut it.
2. **Frontmatter on every doc:** `doc`, `status`, `updated`, and `accepted`
   once accepted.
3. **Agents write drafts. Only the human accepts.** An agent sets
   `status: accepted` only when the human says so in their own words, and
   records the date in `accepted:` (the validator's `--accept` also records
   `accepted-hash`). Silence is not acceptance. Changing an accepted doc makes
   it a draft again: the acceptance was for the old version.
4. **Edit in place.** Change the section you mean to change. Never rewrite a
   whole doc from memory; another session may have edited it since.
5. **No invented facts.** Anything the agent assumed rather than heard or
   read goes under the doc's open questions or is marked *(assumption)*.
6. **Plain words.** Write for a reader who was not in the conversation. Use
   the terms defined in `domain.md` once it exists.

## Depth

`project.md` sets how deep the interviews should go: `depth: quick` (core
questions, about 5 to 10 minutes per doc) or `depth: thorough` (every
question until nothing is open, about 10 to 20 minutes per doc). The lists
`quick:` and `thorough:` name docs that differ. Each doc records the depth
it was really written at in its own `depth:`; a doc below the requested
depth needs deepening. Both depths write the same docs.

## How a Getting Started skill runs

1. **Read** `project.md`, `log.md` and every doc earlier in the order.
2. **Interview** as the skill's `interview.md` describes: collect what
   exists, look up facts yourself, then ask in numbered rounds with a
   recommended answer for each question, until the skill's readiness
   checklist is covered for the chosen depth. Log every decision in
   `log.md`.
3. **Draft** from the skill's template, inside the cap for the depth.
4. **Validate** the way the skill describes: with the Dybs validator when it
   is installed, otherwise by hand against the skill's template and word
   cap. Fix every error before the check-in.
5. **Check in** (or carry on, see below) with a check-in brief.

## Check-ins

The human chooses when they want to be asked. `project.md` holds the choice:

- `checkins: each-doc` interview questions, and a review after every doc
  (default)
- `checkins: end` interview questions, but no reviews until the final check
- `checkins: none` no questions at all: draft from what exists, mark gaps as
  assumptions, leave every doc as a draft and list what awaits acceptance.
  Quick depth only, since thorough needs answers.

Whatever the setting, an agent always stops for a **safety stop**:

- it would delete or overwrite content the human wrote
- two accepted docs contradict each other
- it cannot proceed without a fact only the human has (and guessing would
  shape everything after it, like who the users are)

Nothing else interrupts the human.

## Check-in brief

Every check-in uses this shape, and fits on one screen:

```
## Check-in: <doc or step>
**Done:** what was written or changed (files)
**Decided:** choices the agent made, each with a one-line why
**Needs you:** the decisions only the human can make, each with a recommendation
**Safe to ignore:** what looks open but can wait, and why
**Next:** the next step, and what will happen if the human says "go"
```

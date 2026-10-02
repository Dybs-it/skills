---
method: dybs
method-version: 0.1.0
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
  project.md           name, why, who, now, check-in choices
  context/
    prd.md             the problem and what success means
    scope.md           in, out, later, constraints
    domain.md          shared language and business rules
    architecture.md    the shape of the system and the decisions that hold it
    ux.md              how the product behaves
    ui.md              how the product looks
    decisions/         one file per decision (NNNN-short-title.md)
```

Later phases add `ideas/`, `roadmap.md` and `work/`. They do not exist yet.

## Order

project, prd, scope, domain, architecture, ux, ui, then a check.
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
   records the date in `accepted:`. Silence is not acceptance.
4. **Edit in place.** Change the section you mean to change. Never rewrite a
   whole doc from memory; another session may have edited it since.
5. **No invented facts.** Anything the agent assumed rather than heard or
   read goes under the doc's open questions or is marked *(assumption)*.
6. **Plain words.** Write for a reader who was not in the conversation. Use
   the terms defined in `domain.md` once it exists.

## How a Getting Started skill runs

1. **Read** `project.md` and every accepted or draft doc earlier in the order.
2. **Gather.** Existing code or docs: read them first and extract. Otherwise
   interview the human: one question at a time, each with a recommended
   answer they can accept with "yes". Stop asking as soon as there is enough
   to draft; open points become open questions, not more questions.
3. **Draft** from the skill's template, inside the cap.
4. **Validate:** `node <skills>/scripts/dybs-validate.mjs . --doc <name>`
   when Node is available. Fix every error before the check-in.
5. **Check in** (or carry on, see below) with a check-in brief.

## Check-ins

The human chooses when they want to be asked. `project.md` holds the choice:

- `checkins: each-doc` stop after every doc for review (default)
- `checkins: end` draft everything in order, stop once at the check
- `checkins: none` draft everything, report at the end, ask nothing

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

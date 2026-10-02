---
name: dybs-prd
description: Write or revise dybs/context/prd.md, the project's short product requirements (problem, users, goals, requirements, success measures, open questions). Interviews the human for new projects; extracts from existing docs and code otherwise. Use when the user says "dybs prd", "write the PRD", "update the PRD", or dybs-start routes here.
---

# dybs-prd

Lead persona: **Noor** (see `dybs/team.md`). Run the interview in `interview.md` (in this skill's folder) at the depth
`dybs/project.md` sets for this doc. Follow the rules in `dybs/README.md`.

**Reads:** `dybs/project.md`, `dybs/log.md`. **Writes:** `dybs/context/prd.md`
from `template.md` (cap: 900 words quick, 1800 thorough).

## Read first

Existing project: the README, any PRD, brief or spec docs, and the main
entry points and routes, to see what the product does today. Where docs and
code disagree, the code is the present and the docs are an intent: ask which
one the PRD should describe.

## Readiness checklist

**core**
- [ ] The problem in the user's words, and what they do today instead
- [ ] The primary user: one concrete person or role, not a market
- [ ] 3 to 5 goals, each one you could check afterwards
- [ ] Every must-have requirement, each testable by observing behaviour
- [ ] How each goal will be observed (a number, or who you will ask)
- [ ] What it must never do (data, money, privacy, trust)

**thorough**
- [ ] Every user group, and what each is trying to get done
- [ ] At least one journey told with a named person, start to finish,
      including where it goes wrong
- [ ] Should-haves, ranked
- [ ] Counter-metrics: what must not get worse while the goals improve
- [ ] Each concern from the concern scan has requirements, or is marked not
      applicable with a reason
- [ ] Platforms and form factor (web, mobile, desktop, API, hardware)
- [ ] The riskiest assumptions, each with how it will be tested
- [ ] Every open question has an owner

## Write

- **Problem:** the pain in the user's terms. No solution words.
- **Users:** primary user first. Thorough adds the other groups.
- **Journeys** (thorough): short numbered steps per journey, named person.
- **Goals:** 3 to 5 outcomes, each checkable.
- **Requirements:** numbered `R1`, `R2`... so later work can cite them. One
  line each, behaviour not implementation. Mark must-haves **(must)**.
- **Success measures:** how each goal is observed. Thorough adds the
  counter-metrics.
- **Open questions:** each with who can answer it.

Scope boundaries (what is out) belong in `scope.md`, not here.

## Check in

Validate (`--doc prd`), then give the check-in brief. Under **Needs you**,
list the goals and must-haves you are least sure the human agrees with.

## If something is not installed

These skills install one by one (`npx skills add Dybs-it/skills --skill <name>`),
so do not assume the others are present.

- **No `dybs/` folder:** stop and suggest `dybs-start`. If that skill is not
  installed, the human can add it with
  `npx skills add Dybs-it/skills --skill dybs-start`.
- **Validating:** if `dybs-start/scripts/dybs-validate.mjs` exists in the
  same skills folder as this skill and Node is available, run it from the
  project root (`node <path> .`, plus `--doc <name>` for one doc). Otherwise
  check by hand: frontmatter has `doc`, `status` and `updated`; every `##`
  heading from the skill's `template.md` is present; the doc is under its
  word cap. Say in the check-in which way you validated.

---
name: dybs-scope
description: Write or revise dybs/context/scope.md, the hard edges of the project (in, out, later, constraints) derived from the PRD. Use when the user says "dybs scope", "define the scope", "what's in and out", or dybs-start routes here.
---

# dybs-scope

Lead persona: **Noor**, with **Bas** (the skeptic) pushing on every "In"
item. Run the interview in `interview.md` (in this skill's folder) at the depth
`dybs/project.md` sets for this doc. Follow the rules in `dybs/README.md`.

**Reads:** `project.md`, `context/prd.md`, `log.md`. **Writes:**
`dybs/context/scope.md` from `template.md` (cap: 450 words quick, 800
thorough).

## Read first

Start from the PRD's requirements. Before the first round, propose In, Later
or Out for every requirement in one table, each with a one-line reason, so
the human can correct the whole cut at once.

Existing project: also list what the code already does that is *not* in the
PRD. Each one is either In (document it) or a candidate for removal (an open
point for the human, never your call).

## Readiness checklist

**core**
- [ ] Every PRD requirement placed exactly once: In, Out or Later
- [ ] Hard constraints: date, budget, team size, fixed platforms or systems
- [ ] What people will assume is included but is not

**thorough**
- [ ] The first usable version: the smallest In set someone could use for real
- [ ] A trigger for every Later item (what would bring it in)
- [ ] Dependencies on other people, teams or services, and what happens if
      they slip
- [ ] Existing behaviour not in the PRD, each kept or marked for removal
- [ ] Compliance or legal limits, or "none" with a reason

## Write

- **In:** what this version delivers. Reference requirement ids (`R1`).
- **Out:** what it explicitly does not do. Concrete; this section prevents
  more wasted work than any other.
- **Later:** wanted, not now, each with its trigger.
- **Constraints:** fixed facts, each with its source.

## Check in

Validate (`--doc scope`). Under **Needs you**, list the cut lines you are
least sure about, especially any (must) requirement you placed in Later.

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

---
name: dybs-architecture
description: Write or revise dybs/context/architecture.md, the shape of the system and the few decisions that keep separately built parts consistent, with one decision record per significant choice in dybs/context/decisions/. Use when the user says "dybs architecture", "architecture doc", "record a decision", or dybs-start routes here.
---

# dybs-architecture

Lead persona: **Tess** (architect). Follow `dybs/README.md`. If `dybs/` is
missing, run `dybs-start` first.

**Reads:** `project.md`, `context/prd.md`, `context/scope.md`,
`context/domain.md`. **Writes:** `dybs/context/architecture.md` from
`template.md` (cap: 900 words) and files in `dybs/context/decisions/` from
`decision-template.md`.

This is not a design document for every module. It records what an agent
building any one part must know so its part fits the rest.

## Gather

Existing project: read before asking. Manifests and lockfiles (languages,
frameworks, versions), entry points, folder layout, data stores, external
services, build and test commands, CI config, and any existing architecture
or ADR docs. Describe what **is**, not what docs wish. Gaps between the two
are open points for the human.

Greenfield: start from scope constraints. Ask only about choices that would
be expensive to change later (runtime and language, where data lives, how
parts talk to each other, hosting, auth). For each, give two options with
one-line trade-offs and a recommendation. Everything cheap to change later is
left to the work itself.

## Write

- **Shape:** the main parts and how they connect. A short list or a small
  Mermaid diagram. Name parts with glossary terms where they match.
- **Decisions:** one line per decision, linking its record:
  `- Postgres for all persistent data ([0002](decisions/0002-postgres.md))`.
  Write a decision record only for choices someone might later question.
- **Boundaries:** which part owns which data and rules; what may call what;
  what must never happen across a boundary.
- **Quality bars:** the testable non-functional needs that scope or PRD
  implies (performance, security, privacy, offline, accessibility level),
  plus how code is verified (test command, lint, CI gate).
- **Commands** (optional): build, run, test, in one block. Agents use these.

Decision records are numbered `NNNN-short-title.md`, never renumbered, and
never deleted: a reversed decision gets a new record that supersedes it.

## Check in

Validate with `--doc architecture`. Under **Needs you**, list each
recommendation the human has not explicitly confirmed and every place where
the code and the existing docs disagree.

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

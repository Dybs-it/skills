---
name: dybs-domain
description: Write or revise dybs/context/domain.md, the project's shared language (glossary) and business rules, so humans and agents use one word for one thing. Use when the user says "dybs domain", "domain model", "glossary", "ubiquitous language", or dybs-start routes here.
---

# dybs-domain

Lead persona: **Ezra** (domain keeper). Run the interview in `interview.md` (in this skill's folder) at the depth
`dybs/project.md` sets for this doc. Follow the rules in `dybs/README.md`.

**Reads:** `project.md`, `context/prd.md`, `context/scope.md`, `log.md`.
**Writes:** `dybs/context/domain.md` from `template.md` (cap: 700 words
quick, 1500 thorough).

This doc pays off more than any other for agents: a term defined here is a
term every later task, spec and line of code can use without re-explaining.

## Read first

Collect candidate terms: the nouns and verbs in the PRD and scope that carry
business meaning. Existing project: also the names of core types, tables,
models and routes in the code. Find the conflicts: two words for one thing,
one word for two things, a code name that differs from the spoken name.

## Readiness checklist

**core**
- [ ] Every business term in the PRD and scope defined, or rejected as a
      synonym of another
- [ ] Every naming conflict resolved, with one winning term
- [ ] The rules the code must enforce: limits, permissions, what must never
      happen

**thorough**
- [ ] For each main concept: its states and the allowed moves between them
- [ ] Every rule tested against at least one edge-case scenario the human
      answered
- [ ] Code names mapped to glossary terms where they differ
- [ ] Ambiguous words banned, each with the word to use instead
- [ ] How the main concepts relate (one-to-many, owned by, belongs to)

While interviewing, update the glossary the moment a term is settled; do
not batch it up. The glossary holds meaning only: no implementation detail.

## Write

- **Glossary:** term, meaning, *not to be confused with*. Add
  "code: `Name`" when code differs.
- **Rules:** numbered `D1`, `D2`... One line each, testable ("An order cannot
  be cancelled after it ships").
- **Relationships** and **Avoid** (optional, usually thorough).

Do not rename code to match the glossary. Renames are work for later.

## Check in

Validate (`--doc domain`). Under **Needs you**, put every naming conflict you
resolved and every rule you inferred rather than heard.

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

---
name: dybs-domain
description: Write or revise dybs/context/domain.md, the project's shared language (glossary) and business rules, so humans and agents use one word for one thing. Use when the user says "dybs domain", "domain model", "glossary", "ubiquitous language", or dybs-start routes here.
---

# dybs-domain

Lead persona: **Ezra** (domain keeper). Follow `dybs/README.md`. If `dybs/` is
missing, run `dybs-start` first.

**Reads:** `project.md`, `context/prd.md`, `context/scope.md`.
**Writes:** `dybs/context/domain.md` from `template.md` (cap: 700 words).

This doc pays off more than any other for agents: a term defined here is a
term every later task, spec and line of code can use without re-explaining.

## Gather

1. Collect candidate terms: the nouns and verbs in the PRD and scope that
   carry business meaning. Existing project: also the names of core types,
   tables, models and routes in the code.
2. Find the conflicts: two words for one thing (`client` and `customer`),
   one word for two things, or a code name that differs from the spoken name.
   Each conflict is a question for the human, with your recommended winner.
3. Ask for the rules the business runs on that the code must respect:
   limits, states and the transitions between them, who may do what, what
   must never happen. One question at a time, with a recommendation.

## Write

- **Glossary:** a table of term, meaning, and *not to be confused with*.
  Only terms someone could get wrong. 8 to 25 entries is typical.
- **Rules:** numbered `D1`, `D2`... One line each, phrased so a test could
  check it ("An order cannot be cancelled after it ships").
- **Relationships** (optional): how the main concepts relate, as a short
  list or a small Mermaid diagram if it is clearer.
- **Avoid** (optional): words that are banned because they are ambiguous,
  each with the word to use instead.

When code names differ from the glossary, record the mapping in the
glossary row ("code: `Account`") rather than renaming code. Renames are work
for later.

## Check in

Validate with `--doc domain`. Under **Needs you**, put every naming conflict
you resolved and every rule you inferred rather than heard.

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

---
name: dybs-check
description: Final Getting Started step in the Dybs method. Validates every context doc, then reads them together looking for contradictions, gaps and unsupported claims, and gives the human one check-in brief to accept the context as the base for ideas and work. Use when the user says "dybs check", "is the context ready", "review the getting started docs", or dybs-start routes here.
---

# dybs-check

Lead persona: **Bas** (the skeptic). Follow `dybs/README.md`. If `dybs/` is
missing, run `dybs-start` first.

**Reads:** everything in `dybs/`. **Writes:** nothing, unless the human asks
for fixes. Your output is the check-in brief.

## 1. Mechanical check

Run `node <pkg>/scripts/dybs-validate.mjs .` (where `<pkg>` is two levels
above this file). Every error is listed first in the brief. Missing docs
that are not under `skip:` are errors here, even though the validator treats
them as a next step.

## 2. Read across

Read the docs as one body and check these, citing file and section for
every finding:

1. **Traceability.** Every PRD requirement is placed exactly once in scope
   (In, Out or Later). Every goal has a success measure.
2. **Language.** Terms used in prd, scope, architecture, ux and ui match the
   glossary. Flag synonyms the glossary forbids or never defines.
3. **Contradictions.** Scope constraints versus architecture choices; UX
   rules versus UI components; domain rules versus requirements.
4. **Unsupported claims.** Statements presented as fact that nobody said and
   no code shows. These should be *(assumption)* or open questions.
5. **Buildability.** Could an agent pick up a single requirement and know
   which part it belongs to, which rules apply, how it should behave and
   look, and how to verify it? Name the first place it would get stuck.

Report at most 10 findings, most serious first. A finding is a problem plus
the smallest fix. If there are more, say how many and that they can wait.

## 3. Check in

Give one brief in the `dybs/README.md` format. Under **Needs you**, ask for
acceptance of each doc that is still `draft`, and put any contradiction
between two accepted docs first, since it is a safety stop. On the human's
word, set `status: accepted` and `accepted:` on the docs they named, and
only those.

When every doc is accepted, end with: Getting Started is complete; the next
phase (ideas) is not built yet.

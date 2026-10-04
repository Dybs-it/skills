# Sources

What this repo adapts from other projects, from which version, and where it
lives here. Adapted text is rewritten into our own method; nothing syncs
automatically. To see what changed upstream since, diff the upstream file
between the commit below and its current head, then decide what to bring in.

All text sources below are MIT licensed; the one Apache 2.0 source is used as an idea only, with no text taken. Keep their notice in the adapted file
and in [NOTICE.md](../NOTICE.md).

| Our file or part | Adapted from | Upstream version |
|---|---|---|
| `skills/*/interview.md` (rounds, frontier, recommended answers, facts looked up) | [mattpocock/skills](https://github.com/mattpocock/skills) `skills/productivity/grilling/SKILL.md` | `d81f3a183412e71a5b1e84ca21bc1a35eea03a60` (2026-09-29) |
| `dybs-domain` (sharpen terms, edge-case scenarios, check against code) | mattpocock/skills `skills/engineering/domain-modeling/SKILL.md` | `d81f3a1` |
| `dybs-architecture` (three tests for a decision record) | mattpocock/skills `skills/engineering/domain-modeling/SKILL.md` | `d81f3a1` |
| `interview.md` (collect first, concern scan, decision log); `dybs-prd` thorough items (journeys with a named person, counter-metrics) | [BMad Method](https://github.com/bmad-code-org/BMAD-METHOD) `bmad-prd` | 6.12.0 |
| `team.md` (personas as lenses) | BMad Method agents | 6.12.0 |
| `quality.md` risk scoring, priorities, test levels, test quality rules, gate rules and waivers; `dybs-test-plan` acceptance scenarios; `dybs-tests` coverage widening; `dybs-gate` | [BMad Test Architect module](https://github.com/bmad-code-org/bmad-method-test-architecture-enterprise): `testarch-test-design`, `testarch-atdd`, `testarch-automate`, `testarch-test-review`, `testarch-trace` and its knowledge files | v1.27.0 (`4ca1db6`) |
| `dybs-test-plan` edge-case hunt | BMad Method `bmad-review` lens `lens-edge-case-hunter.md` | 6.12.0 |
| `dybs-review` verification axis | BMad Method `bmad-review` lens `lens-verification-gap.md` | 6.12.0 |
| `dybs-review` standards and spec axes, smell baseline, no reranking across axes | mattpocock/skills `skills/engineering/code-review/SKILL.md` | `d81f3a1` |
| `dybs-tests` red then green, vertical slices, seams agreed first, tautological tests | mattpocock/skills `skills/engineering/tdd/SKILL.md` | `d81f3a1` |
| `dybs-pr` summary, evidence, merge danger | mattpocock/skills `skills/engineering/pr/SKILL.md` | `d81f3a1` |
| `dybs-pr` "one small picture" menu (idea only, our own words) | Dex Horthy, [humanlayer](https://github.com/humanlayer/humanlayer) `show-me`, Apache License 2.0 | not copied |

When you adapt something new, add a row in the same commit.

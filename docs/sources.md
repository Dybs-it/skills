# Sources

What this repo adapts from other projects, from which version, and where it
lives here. Adapted text is rewritten into our own method; nothing syncs
automatically. To see what changed upstream since, diff the upstream file
between the commit below and its current head, then decide what to bring in.

All sources below are MIT licensed. Keep their notice in the adapted file
and in [NOTICE.md](../NOTICE.md).

| Our file or part | Adapted from | Upstream version |
|---|---|---|
| `skills/*/interview.md` (rounds, frontier, recommended answers, facts looked up) | [mattpocock/skills](https://github.com/mattpocock/skills) `skills/productivity/grilling/SKILL.md` | `d81f3a183412e71a5b1e84ca21bc1a35eea03a60` (2026-09-29) |
| `dybs-domain` (sharpen terms, edge-case scenarios, check against code) | mattpocock/skills `skills/engineering/domain-modeling/SKILL.md` | `d81f3a1` |
| `dybs-architecture` (three tests for a decision record) | mattpocock/skills `skills/engineering/domain-modeling/SKILL.md` | `d81f3a1` |
| `interview.md` (collect first, concern scan, decision log); `dybs-prd` thorough items (journeys with a named person, counter-metrics) | [BMad Method](https://github.com/bmad-code-org/BMAD-METHOD) `bmad-prd` | 6.12.0 |
| `team.md` (personas as lenses) | BMad Method agents | 6.12.0 |

When you adapt something new, add a row in the same commit.

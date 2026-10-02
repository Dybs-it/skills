# Field test protocol

The unit tests prove the validator. They cannot prove the skills are good.
That takes real projects. Run each step on real work and record the result
in `tests/runs/<date>-<project>.md` (copy the record below).

## Pick two projects, one per depth

1. **Greenfield, quick:** an idea you actually want to build. Small is fine.
   Target: under 30 minutes for all docs.
2. **Existing, thorough:** a real codebase you know well (Dybs itself is a
   good hard case), so you can judge whether extraction is accurate.
   Target: 1 to 2 hours, then the agent-ready test in `dybs-check`.

Use a fresh branch or a copy. Nothing here should touch code, only `dybs/`.

## Per step

For each skill in order, run it, then answer:

| Check | Pass when |
|---|---|
| **Questions** | Numbered rounds, each question with a recommendation you could accept with "yes". Nothing asked that it could have looked up. |
| **Depth respected** | quick: at most two rounds, core items only. thorough: kept going until nothing was open. |
| **Log** | Every decision you made is in `dybs/log.md`. |
| **Accuracy** (existing) | No claim about the code that you know is false. Count the false ones. |
| **Assumptions marked** | Inferred facts say *(assumption)* or are open questions. |
| **Readable** | You read the whole doc without skimming. Time it. |
| **Useful** | You would give this doc to a new colleague, human or agent. |
| **Validator** | `--doc <name>` passes before the check-in. |
| **Check-in** | The brief fits one screen and "Needs you" holds real decisions only. |
| **Respected check-ins** | With `end` or `none`, it did not stop outside the safety stops. |

## The real test

After `dybs-check`, hand the `dybs/` folder to a fresh agent session with
one requirement from the PRD and ask: "Which part of the system does this
touch, which rules apply, how should it behave and look, and how will you
verify it?" Then judge the answer. If it is right without the agent reading
code beyond the files it would change, the context works.

## Record

```
# <date> <project> (<greenfield|existing>), depth: <quick|thorough>, checkins: <setting>

| Step | Rounds | Questions | Minutes | False claims | Validator | Verdict |
|---|---|---|---|---|---|---|
| start | | | | | | |
| prd | | | | | | |
| scope | | | | | | |
| domain | | | | | | |
| architecture | | | | | | |
| ux | | | | | | |
| ui | | | | | | |
| check | | | | | | |

**Real test:** <requirement used> → <right / partly / wrong>, why
**Change for next version:** <one or two concrete edits to a skill>
```

## Compare with BMad

On the existing project, note how long the same ground took with BMad
(product brief, PRD, architecture, UX) and how many words it produced.
Words and minutes are crude, but they are the complaint we are testing.

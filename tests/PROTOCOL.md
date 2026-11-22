# Field test protocol

The unit tests prove the validator. They cannot prove the skills are good.
That takes real projects. Run each step on real work and record the result
in `tests/runs/<date>-<project>.md` (copy the record below).

## Pick projects, one per combination that matters

1. **Greenfield, quick:** an idea you actually want to build. Small is fine.
   Target: under 30 minutes for all docs.
2. **Existing, thorough, `checkins: each-doc`:** a real codebase you know
   well (Dybs itself is a good hard case), so you can judge whether
   extraction is accurate. Target: 1 to 2 hours, then the agent-ready test
   in `dybs-check` with a genuinely fresh sub-agent.
3. **Thorough, `checkins: end`:** it asks interview questions but no
   reviews, and puts the summaries in the final check.
4. **Quick, `checkins: none`:** it asks nothing, every doc stays a draft,
   and the final report lists what awaits acceptance.
5. **Deepen one doc:** accept a quick doc, then deepen it. It must become a
   draft again, `--accept` must stamp it, and editing it afterwards must
   fail validation until it is a draft again.

The workflow counts as verified only after these runs are recorded. Unit
tests prove consistency, not interview quality or timing.

Use a fresh branch or a copy. Nothing here should touch code, only `dybs/`.

## Per step

For each skill in order, run it, then answer:

| Check | Pass when |
|---|---|
| **Questions** | Numbered rounds, each question with a recommendation you could accept with "yes". Nothing asked that it could have looked up. |
| **Depth respected** | quick: at most two rounds, core items only. thorough: kept going until nothing was open. The doc's `depth:` says what really happened. |
| **Check-ins respected** | `each-doc` reviewed per doc; `end` asked questions but no reviews; `none` asked nothing and left drafts. |
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
| working | | | | | | |
| check | | | | | | |

**Real test:** <requirement used> → <right / partly / wrong>, why
**Change for next version:** <one or two concrete edits to a skill>
```

## Compare with BMad

On the existing project, note how long the same ground took with BMad
(product brief, PRD, architecture, UX) and how many words it produced.
Words and minutes are crude, but they are the complaint we are testing.

## Ideas, roadmap and the work loop

Run on a real codebase with `dybs/context/` accepted.

1. `dybs-idea` on something you are honestly unsure about. Decide it.
2. `dybs-roadmap` with at least three accepted ideas.
3. `dybs-task` on the first one, and on one real issue.
4. Follow `dybs-route.mjs next` until it says done. Answer every stop.
5. Kill the terminal once in the middle of `dybs-build`, then run it again.

| Check | Pass when |
|---|---|
| **Idea** | The questions changed what you thought, or showed it was already clear. The advice was not four times "go". Nothing was decided for you. |
| **Roadmap** | Links only. The order had a reason you could argue with. |
| **Task** | The ask is in your words. The lane it computed is the lane you would have chosen. |
| **Next** | You never had to know which skill came next, and it never ran a step twice for nothing. |
| **Stops** | Every stop was a decision only you could make. Count the ones that were not. |
| **Fix loop** | Ticked findings were really closed. It ended. |
| **Resume** | After the kill, nothing was redone and nothing was skipped. |
| **Done** | The lines under Learned were true and worth reading, or it said "Nothing new." |

Record it as `tests/runs/<date>-<project>-loop.md`: steps, minutes and
tokens per step, stops that were noise, and one or two concrete edits to a
skill. `tests/harness/loop.sh` runs the same loop unattended on a small
task; it is a smoke test, not this run.

## Ideas from meeting notes

Run `dybs-ideas` on a real folder of meeting notes (a Granola or Fireflies
export) in a project with `dybs/context/` accepted. Use at least two notes
that share a subject.

1. By hand: `/dybs-ideas <folder>`.
2. Headless, as a schedule would: `claude -p "/dybs-ideas"` in the project
   folder, with no new notes. Then add one note and run it again.
3. Run it a third time with nothing new.

| Check | Pass when |
|---|---|
| **Proposals** | Every idea is named as a proposal you could act on, not a topic. |
| **Needs** | At least one idea comes from a need nobody asked a feature for, if the notes hold one. |
| **Quotes** | Every quote is in its note, word for word (`verify` passes, and you spot-check three). Who and date are right or say unknown. |
| **One idea, one file** | The shared subject became one idea with mentions from both notes. |
| **Headless** | It asked nothing and the last line was the summary. |
| **Twice** | The third run read 0 notes and changed no file. |
| **Missed** | Count the ideas you see in the notes that it missed, and the ones it wrote that you would not. |

Record it as `tests/runs/<date>-<project>-ideas.md`: the notes (names
only), minutes and tokens per run, the counts above, and one or two
concrete edits to the skill.

## Quality skills

Run on one real task in a real codebase, ideally one with a known bug or a
recent change, so you can judge whether the skills find what you know is
there.

1. `dybs-test-plan` on the task or code area.
2. `dybs-tests` for the P0 and P1 scenarios.
3. `dybs-review` against the base branch.
4. `dybs-gate`, then `dybs-pr`.

| Check | Pass when |
|---|---|
| **Edge cases** | The hunt names real unhandled paths, including the ones you already knew about. Count false alarms. |
| **Seams** | It asked you to confirm the seams before writing any test. |
| **Proof** | Every new test was seen failing (new code) or proven by breaking the code (existing code). No test that cannot fail. |
| **Review axes** | Findings sit under their axis and are not ranked across axes. The context axis cites your `dybs/context` rules. |
| **Gate** | The script computed the decision; nothing was waived without your words. |
| **PR** | The picture explains the change faster than the diff; "not verified" is honest. |

Record it as `tests/runs/<date>-<project>-quality.md`: the task, minutes per
step, false alarms, missed issues you know about, and one or two concrete
edits to a skill. The quality skills count as verified only after this run.


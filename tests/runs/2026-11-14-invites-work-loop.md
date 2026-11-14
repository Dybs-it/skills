# 2026-11-14 invites (synthetic), the whole circle, checkins: none

Skills on the branch that adds the work loop, ideas and the roadmap. A
machine run, not the human field run `tests/PROTOCOL.md` asks for. Driven by
`tests/harness/loop.sh`: `dybs-route.mjs next` names each step, `route` its
model and effort, one fresh headless Claude Code session runs it. Everything
ran on Sonnet (the task is size S). Where the loop stopped for the human,
the harness answered as a human would and said so in the file.

## Full lane: one issue from text to done

The issue asked for `revokeInvite` with four behaviours. Nothing was built
beforehand.

| # | Step | Turns | Tokens | Cost | What happened |
|---|---|---|---|---|---|
| 1 | task | 4 | 172k | $0.10 | `task.md`: the ask as given, 6 acceptance lines (2 marked proposed), 2 files. Lane full: it cites domain rules |
| 2 | test-plan | 4 | 185k | $0.14 | plan with scenarios |
| 3 | build | 8 | 397k | $0.19 | red then green; 11 tests pass; status `review` |
| 4 | review | 6 | 295k | $0.17 | findings as checklist items on five axes |
| 5 | build | 5 | 247k | $0.14 | closed S1, S2, V1, V2; marked the review stale |
| 6 | review | 5 | 250k | $0.15 | round 2: confirmed the four closed, added V4 |
| | **stop: findings** | | | | 3 findings marked `(needs human)`: a change to what `createInvite` returns, and two that depend on it |
| 7 | gate | 6 | 303k | $0.13 | tables from `dybs-route.mjs items`; the script computed PASS |
| 8 | pr | 5 | 218k | $0.11 | `pr.md` |
| | **stop: merge** | | | | merged by the harness |
| 9 | done | 7 | 302k | $0.12 | status `done`; three lines under Learned; no context doc touched |
| | **Total** | **50** | **2.37M** | **$1.25** | |

Three more gate sessions (843k tokens, $0.36) were wasted by a bug, see
below. They are not in the total.

## Fast lane

A one-line ask: rename the reason for an expired invite to `invite-expired`.

| Step | Turns | Tokens | What happened |
|---|---|---|---|
| task | 4 | 169k | lane fast: one file, one criterion, no rule cited |
| build | 4 | 174k | changed, test updated |
| review | 5 | 215k | C1: the new word contradicts domain rule D4, which says `expired` |
| build | 4 | 175k | closed V1; left C1 for the human |
| review | 5 | 219k | round 2 |
| **stop: findings** | | | D4 is an accepted doc; changing it is the human's call |
| **Total** | **22** | **0.95M ($0.48)** | |

The ask was chosen to conflict with the context. The fast lane has no test
plan and no gate, and the review still caught the conflict and stopped.

## Ideas and roadmap, once each

- `dybs-idea` (168k tokens): captured `list-invites`, wrote five questions
  with recommended answers marked as assumptions, advice from four personas
  (two "go", two "change"), left the decision empty with status `grilled`.
- The harness accepted the idea in the file.
- `dybs-roadmap` (158k): one line under Now, linking the idea.
- `dybs-task` from the idea (226k): one task with `idea: list-invites`; the
  board showed it open, full lane, next step test-plan.

## What it shows

- **The script ran the loop.** No session decided what came next, and every
  stop was one the rules name.
- **The fix loop works and ends:** findings, a build that closes what it
  can, a second review that checks the ticks, then the human.
- **The stops were real questions**, not noise: an API change, an accepted
  rule the ask contradicts, the merge.
- **The fast lane cost 40% of the full lane** up to its stop, and was not
  blind for it.
- **The gate table from the script** gave PASS on a plan whose earlier
  agent-built tables gave FAIL, FAIL and PASS. One run; not yet a proof that
  decisions now agree.
- **`dybs-done` proposed and did not edit** the context docs.

## What went wrong

- **The loop ran the gate three times.** The gate step wrote "PASS.
  Coverage: ..." and `next` looked for "Decision: PASS" in `gate.md`. Fixed:
  `next` asks the gate script itself, reads `gate.md` leniently when the
  script is absent, and stops a gate or PR step that ran twice without its
  result. Tests pin all three.
- **The gate script refused risk names with Markdown** when the table came
  from the plan. Fixed: `items` makes the name plain text; a test feeds the
  result to the gate script's parser.
- **How the human answers a finding was not written down.** Fixed in
  `quality.md`: tick it with the decision, or delete `(needs human: ...)`.
- **`dybs-task` did not log its run** in either lane (the task folder does
  not exist when it starts). Not fixed.
- **Project text used em dashes** (the idea's advice lines). The skills ask
  for plain words but do not forbid them in a project's files. Not fixed.

## Not covered

A human at the check-ins, a repository larger than 60 lines, a task of size
L or XL (so Opus and Fable never ran), a step that gets stuck, a session
killed mid-build, a parked or dropped idea, and other agents.

**Change for next version:** the launcher should write the run-log line and
the token count itself; split a larger idea into several tasks and check the
order they name.

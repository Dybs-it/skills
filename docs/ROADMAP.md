# Roadmap

Only phase 1 is built. Each later phase is drafted here, so its design can be
argued with before any skill exists. Each phase ships only after the
previous one passes the field test (`tests/PROTOCOL.md`).

## 0. Distribution (v0.1, built)

`npx dybs-skills install|update|uninstall|status|validate` into
`.claude/skills`, `.agents/skills` and `.opencode/commands`, with a
per-target manifest so user edits are never overwritten. Every later phase
ships as more skills in the same package.

## 1. Getting Started (v0.1, built)

`dybs-start`, `-prd`, `-scope`, `-domain`, `-architecture`, `-ux`, `-ui`,
`-check`. Output: `dybs/` with an accepted context.

## 2. Ideas (next)

```
dybs/ideas/<slug>.md    one idea, its grilling, the team's advice, the human's decision
```

- `dybs-idea`: capture an idea in a few lines: the problem, who it is for,
  and which requirement or goal it serves (or that it is new).
- `dybs-grill`: interrogate one idea against the context, one question at a
  time with recommended answers. Then each relevant persona gives **advice**
  (go / change / park / drop, with reasons and what would change their mind).
  Bas always speaks.
- The **human decides**, in the idea file: accepted, parked or dropped, with
  a line why. Agents never decide.

Borrowed: grilling with recommendations (Matt Pocock), multi-persona review
(BMad party mode, much smaller).

## 3. Roadmap

```
dybs/roadmap.md         an ordered list of links to accepted ideas, nothing else
```

- `dybs-roadmap`: propose an order (value, risk, dependencies), the human
  reorders. Kept as links so it can never drift from the ideas.

## 4. Work loop

```
dybs/work/<id>.md       one file per task; status lives in its frontmatter
```

- `dybs-to-tasks`: split an accepted idea into tasks. Each task cites its
  idea, the requirements and domain rules it touches, and acceptance checks.
  Vertical slices that can each be verified alone.
  Candidate, unproven: a ready test per task. A fresh agent reads the task
  and the code and lists what it had to guess. Build only if field runs of
  `dybs-build` show rework caused by missed callers or modules.
- `dybs-build`: implement one task test-first against the context.
- `dybs-review`: check the change against the task's acceptance, the domain
  rules and the quality bars. Findings, then fixes.
- `dybs-checkin`: the one-screen brief at the moments the human chose.

Rules decided now, from lessons in the Dybs repo:

- **One file per task, never one shared board file.** A shared status file
  lost every row three times when parallel agents rewrote it. The board is
  derived by reading task frontmatter.
- **Check-ins are configured per idea**, with per-task overrides:
  `after-grill`, `after-tasks`, `before-build`, `after-review`, `none`.
- **Safety stops are fixed and few:** destructive or outward actions,
  contradictions with accepted context, repeated failure.

Interruption and resume (decision 0002, proposed, unproven). The human may
close the terminal at any moment. A fresh agent running the same skill must
pick up from the task file alone:

- **Write the step before acting.** Task frontmatter holds `status` and
  `step`, edited in place before each step that changes files or runs
  commands.
- **Mark a run in flight.** `run:` holds the start time and is cleared at
  each check-in. A skill that finds it set says which step was interrupted
  and checks that step's effect on disk before doing it again.
- **Steps are safe to run twice.** Edit in place, re-run tests, never
  append blindly. No runtime can promise a prompt was not already sent.
- **A deliberate stop is recorded.** `status: stopped` with a line why. A
  skill never restarts a stopped task; only the human clears it.
- **Runtime state is not work state.** An agent going idle, exiting or
  being resumed never moves a task. Only review and the human's word do.

Pass when a field run kills the terminal mid-`dybs-build`, and a fresh
session names the interrupted step and neither redoes nor skips it.

Borrowed: TDD loop and issue slicing (Matt Pocock), story structure and
code review lenses (BMad).

## 5. Dybs app integration

The Dybs app reads `dybs/` natively: Getting Started shows doc status from
the validator's `--json` output, ideas and roadmap become views, tasks
become the board. BMad projects stay supported through a read-only adapter.

Runtime (decision 0002): the app may use Herdr as an optional backend, so a
closed view or app does not kill a running agent. Work state comes from
`dybs/`, process state from the runtime; the mapping between them lives in
the app's own storage, not the repo. Spike first, on a spare Mac.

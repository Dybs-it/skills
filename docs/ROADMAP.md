# Roadmap

Built: Getting Started (phase 1), ideas and the roadmap (phases 2 and 3)
and the work loop (phase 4). Getting Started and the work loop each have
one recorded machine run; ideas and the roadmap have none. No phase has the
human field run yet. What follows says what each phase holds and what is
still open. Each phase ships only after the
previous one passes the field test (`tests/PROTOCOL.md`).

## 0. Distribution (v0.2, built)

Installed through package managers: `npx skills add Dybs-it/skills` (18+
agents) and the Claude Code plugin marketplace. The `dybs-skills` CLI adds
only `validate` and a safe `update` that never overwrites user edits. Every
later phase ships as more skills in the same repo. See decision 0002.

Later: make the repo public with a license, publish the CLI to npm, list it
on skills.sh.

## 1. Getting Started (v0.3, built)

`dybs-start`, `-prd`, `-scope`, `-domain`, `-architecture`, `-ux`, `-ui`,
`-check`. Output: `dybs/` with an accepted context. Two depths, quick and
thorough, share one interview method (`interview.md`) and one doc format.
See decision 0003.

### Follow-ups for Getting Started

- **Interview state with stable ids.** Give every checklist item an id
  (`prd.core.3`) and persist the interview's open, blocked, answered and
  parked items, with sources and supersession, in a machine-readable file.
  Today `log.md` records decisions in prose and resuming relies on the agent
  rebuilding the frontier.
- **Acceptance bound to content.** `--accept` writes `accepted-hash`; the
  Dybs app should accept through it rather than by editing frontmatter.

## 2. Ideas (v0.5, built, not run)

```
dybs/ideas/<slug>.md    one idea, its grilling, the team's advice, the human's decision
```

- `dybs-idea`: captures an idea in a few lines, questions it against the
  context in rounds with recommended answers, and collects each relevant
  persona's advice (go, change, park or drop, with the reason and what
  would change their mind). Bas always speaks. One skill, not two: capture
  without questions is a note, and questions without a file are lost.
- The **human decides**, in the idea file: accepted, parked or dropped, with
  a line why. Agents never decide.

## 3. Roadmap (v0.5, built, not run)

```
dybs/roadmap.md         an ordered list of links to accepted ideas, nothing else
```

- `dybs-roadmap`: proposes an order (what unblocks, what serves a must, what
  teaches cheaply), the human reorders. Kept as links so it can never drift
  from the ideas. A delivered idea leaves the roadmap; its file stays.
- `dybs-task` splits an accepted idea into tasks, and `dybs-done` says when
  the last one closes. See decision 0008.

## 4. Work loop (v0.5, built, one machine run)

```
dybs-task → (dybs-test-plan) → dybs-build → dybs-review → (dybs-gate) → dybs-pr → merge → dybs-done
```

```
dybs/work/<task>/       one folder per task
  task.md               what is asked; its status is the task's state
  test-plan.md, review.md, gate.md, pr.md, log.md   written by the steps
```

- `dybs-task`: an issue or an idea becomes one task with acceptance
  criteria and the files it touches. Shows the board.
- `dybs-build`: builds test first, fixes open review findings, resumes
  from the task's status.
- `dybs-review`, `dybs-gate`, `dybs-pr`: as before; findings are checklist
  items so the loop can see what is open.
- `dybs-done`: closes a merged task and proposes what the context should
  learn.
- `dybs-test-plan`, `dybs-tests`: the plan for the full lane, and tests for
  existing code outside the loop.

A script (`dybs-task/scripts/dybs-route.mjs`) computes the lane (fast or
full), the next step, the board, the task's size and the model and effort
per step. See decisions 0004, 0005, 0006 and 0007.

Rules, from lessons in the Dybs repo:

- **One folder per task, never one shared board file.** A shared status
  file lost every row three times when parallel agents rewrote it. The board
  is derived by reading each task's `task.md`.
- **Safety stops are fixed and few:** a gate FAIL, findings that are
  questions, a step that gave up twice, three reviews without closing the
  findings, a stopped task, and the merge.
- **Runtime state is not work state.** An agent going idle, exiting or being
  resumed never moves a task. Only its files do.

Open:

- **Check-ins per task.** The loop follows `checkins:` in `project.md`; there
  is no per-task setting yet.
- **The gate's items table** now comes from a script. Whether the decisions
  agree across runs has to be measured again; the scenarios and their
  `Covers` column are still agent-written.
- **Resume inside a step.** `status: building` says a build stopped
  part-way; there is no `step:` marker finer than that. Pass when a field
  run kills the terminal mid-`dybs-build` and a fresh session neither redoes
  nor skips work.
- **Measured only at size S.** The fast-lane limits, the size bounds and the
  Opus and Fable rows of the routing table need an L and an XL task.
- **A per-task ready test** (candidate, unproven): a fresh agent reads the
  task and the code and lists what it had to guess.

## 5. Dybs app integration

The Dybs app reads `dybs/` natively: Getting Started shows doc status from
the validator's `--json` output, ideas and roadmap become views, tasks
become the board. BMad projects stay supported through a read-only adapter.

Runtime (decision 0006): the app may use Herdr as an optional backend, so a
closed view or app does not kill a running agent. Work state comes from
`dybs/`, process state from the runtime; the mapping between them lives in
the app's own storage, not the repo. Spike first, on a spare Mac.

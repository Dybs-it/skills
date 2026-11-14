# Roadmap

Built: phase 1 (Getting Started) and phase 4 (the work loop: task, test
plan, build, review, gate, PR, done). Ideas and the roadmap, phases 2 and 3,
are not built: a task starts from an issue or a description. Each later
phase is drafted here, so its design can be argued with before any skill
exists. Each phase ships only after the
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

- **Split an idea into several tasks** (`dybs-to-tasks`). Today one issue is
  one task.
- **Check-ins per task.** The loop follows `checkins:` in `project.md`; there
  is no per-task setting yet.
- **The gate's items table is agent-built.** Six runs of one task gave three
  decisions. Build the table by script from the test plan.
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

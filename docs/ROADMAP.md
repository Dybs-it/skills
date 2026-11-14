# Roadmap

Built: phase 1 (Getting Started) and the quality skills (test plan, tests,
review, gate, PR), which work on their own. The work loop that will connect
them is not built. Each later phase is drafted here, so its design can be
argued with before any skill exists. Each phase ships only after the
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

## 4. Work loop

**Built ahead of the loop (v0.4):** `dybs-test-plan`, `dybs-tests`,
`dybs-review`, `dybs-gate` and `dybs-pr` work on any task or part of the
code, writing to `dybs/work/<task>/`. The loop below will create `task.md`
there and call them; a task is a folder, not a single file. See decision
0004.

**Model routing and run log (built, unverified above S):** a script scores
each task S, M, L or XL from its test plan and names the model and effort
per step; every run appends a line to the task's `log.md`. See decision
0005. Next: build the gate's items table by script (six runs on one task
gave three different decisions), and measure an L and an XL task.


```
dybs/work/<task>/       one folder per task
  task.md               what is asked; status lives in its frontmatter
  test-plan.md, review.md, gate.md, pr.md   written by the quality skills
```

- `dybs-to-tasks`: split an accepted idea into tasks. Each task cites its
  idea, the requirements and domain rules it touches, and acceptance checks.
  Vertical slices that can each be verified alone.
- `dybs-build`: implement one task test-first against the context.
- `dybs-review` (built): check the change against the task's spec, the
  repo's standards, the domain rules and boundaries, and verification gaps.
- `dybs-checkin`: the one-screen brief at the moments the human chose.

Rules decided now, from lessons in the Dybs repo:

- **One folder per task, never one shared board file.** A shared status
  file lost every row three times when parallel agents rewrote it. The board
  is derived by reading each task's `task.md` frontmatter.
- **Check-ins are configured per idea**, with per-task overrides:
  `after-grill`, `after-tasks`, `before-build`, `after-review`, `none`.
- **Safety stops are fixed and few:** destructive or outward actions,
  contradictions with accepted context, repeated failure.

Borrowed: TDD loop and issue slicing (Matt Pocock), story structure and
code review lenses (BMad).

## 5. Dybs app integration

The Dybs app reads `dybs/` natively: Getting Started shows doc status from
the validator's `--json` output, ideas and roadmap become views, tasks
become the board. BMad projects stay supported through a read-only adapter.

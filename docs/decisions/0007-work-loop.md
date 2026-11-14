---
decision: 0007
status: proposed
date: 2026-11-14
---

# 0007. The work loop: a task file, two lanes, and a script that says what is next

## Context

The quality skills worked on a task, but nothing created the task, built
it, applied a review's findings or closed it. A human had to know which
skill came next. The measured runs showed two things that shape the loop:
tokens are mostly fixed context times turns, so a step that is not run saves
far more than a cheaper model; and what an agent judges differs from run to
run, so what runs next should not be an agent's call.

## Decision

- **Three skills close the loop:** `dybs-task` (intake), `dybs-build`
  (build and fix), `dybs-done` (close-out).
- **`task.md` holds the state.** Its `status` is `open`, `building`,
  `review`, `done` or `stopped`. `dybs-build` writes `building` before it
  changes code, so a fresh session resumes instead of starting over
  (decision 0006).
- **Two lanes, computed from the task:** fast (build, review, PR, done) for a
  task that touches at most two files of at most 600 lines, has at most
  three acceptance criteria and cites no domain rule; full (test plan,
  build, review, gate, PR, done) for everything else. The human overrules it
  with `lane:`.
- **A script names the next step** (`dybs-route.mjs next`) and prints the
  board (`status`), from the files alone. No shared board file.
- **Findings are checklist items** in `review.md`. Open ones send the task
  back to `dybs-build`; a build that changes code marks the review stale and
  it is reviewed again, at most three times.
- **The loop stops for the human:** a gate FAIL, findings marked
  `(needs human)`, a step stuck twice, the third review with findings still
  open, a task marked `stopped`, and the merge.
- **`dybs-done` proposes, never edits, context docs.** Changing an accepted
  doc makes it a draft, and that is the human's call.

## Options considered

- **Script decides the next step (chosen):** reproducible, costs no agent
  turn, one rule for a terminal user and for a launcher such as the Dybs
  app. Cost: the artifacts must stay machine-readable (status, checkboxes).
- **An orchestrating skill:** works without Node, but every decision is a
  turn, and the answer can differ between runs.
- **One lane:** simpler, but a typo fix would pay for a test plan and a gate.
- **`dybs-tests` as the build step:** it already goes red then green, but it
  has no task status, no fix loop and no fast lane, and it stays useful on
  its own for covering existing code.

## Consequences

- The fast-lane limits are a first guess. A task named too small goes down
  the cheap lane; `dybs-task` is told to name what it touches honestly, and
  the review still runs.
- The Dybs app should ask this script what is next rather than hold its own
  copy of the order.
- Ideas and the roadmap (phases 2 and 3) still feed nothing into the loop:
  a task starts from an issue or a description.

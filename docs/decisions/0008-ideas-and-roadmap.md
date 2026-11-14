---
decision: 0008
status: proposed
date: 2026-11-14
---

# 0008. Ideas and the roadmap: one skill each, and the human decides

## Context

The work loop started from an issue or a description. Nothing recorded why
a piece of work was worth doing, what was considered and dropped, or in
which order accepted work should be built. The roadmap drafted two skills
for ideas, `dybs-idea` (capture) and `dybs-grill` (question), and one for
the roadmap.

Every skill's name and description is loaded into every session, used or
not. Fewer skills is fewer tokens on every turn.

## Decision

- **`dybs-idea` captures and questions in one skill.** One file per idea in
  `dybs/ideas/`, holding the idea as said, the questions and answers, each
  relevant persona's advice (go, change, park, drop) and the decision.
- **Only the human decides** an idea: accepted, parked or dropped, in their
  words. Until then its status is `grilled`.
- **`dybs-roadmap` keeps a list of links** to accepted ideas under Now, Next
  and Later, with one line of reason each, and nothing else. Status and
  detail stay in the idea and its tasks.
- **No `dybs-to-tasks`.** `dybs-task` splits an accepted idea into tasks,
  each carrying `idea: <slug>`. `dybs-done` says when an idea's last task
  closes; `dybs-roadmap` then takes it off the roadmap.
- **No `dybs-checkin`.** Every skill ends with the check-in brief from
  `dybs/README.md`, and `dybs-task` prints the board.

## Options considered

- **One skill for ideas (chosen):** one description in every session, and
  the file is always both captured and questioned. Cost: a quick note still
  gets one round of questions, which the human can skip.
- **Capture and grill apart:** a clearer name per step, but an idea that is
  captured and never questioned looks the same as one that was.
- **A roadmap with estimates and status:** more to read at a glance, and a
  second copy of what the tasks already say.

## Consequences

- Neither skill has been run. They count as unverified until a field run.
- The planning skills share no file, so nothing keeps their wording in step
  with the others except review.

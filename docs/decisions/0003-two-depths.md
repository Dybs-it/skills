---
decision: 0003
status: accepted
date: 2026-10-02
---

# 0003. Two interview depths, one doc format

## Context

v0.2 capped every interview at about five questions so Getting Started
stayed fast. That suits a side project, but for a long-term product it left
gaps that agents later filled by guessing. A BMad-style PRD, architecture
and UX pass takes hours, which is worth it for a long-term product and not
for a weekend idea.

## Decision

- `dybs-start` runs a kickoff like an agency would: the idea in a few lines,
  one round of at most six questions (type, audience, stage, horizon,
  builders, hard limits), then advice with options: quick start, thorough
  kickoff, custom, or park it. The human chooses; single docs can differ.
- Every skill has a readiness checklist; items are **core** (both depths)
  or **thorough** (thorough only).
- One interview method for all skills (`interview.md`, an identical copy per
  skill): collect what exists, look facts up, then ask numbered rounds with
  recommended answers. Quick stops after core items or two rounds; thorough
  stops when nothing is open. Adapted from Matt Pocock's `grilling` (MIT).
- Both depths write the same docs and sections. Thorough allows about twice
  the words; the reasoning goes to `dybs/log.md`, append-only.
- `dybs-check` adds an agent-ready test at thorough depth: fresh sub-agents
  get one requirement and `dybs/` only, and every guess they make is a gap.

## Options considered

- **Two depths, one format (chosen):** fits both side projects and long-term
  products; downstream tools never care which depth was used; quick docs can
  be deepened later.
- **Thorough only:** complete, but too slow for small projects.
- **Quick only:** fast, but leaves gaps for agents to guess.
- **Separate quick and thorough skill sets:** clearer per skill, but twice the
  skills to maintain and no path from quick to thorough.

## Consequences

- `interview.md` changes must be made in `dybs-start` and copied to every
  skill (a test enforces identical copies).
- Word caps are per depth in the validator's `DOCS`.

---
decision: 0010
status: proposed
date: 2026-11-15
---

# 0010. Discovery before requirements: Map, Sketch, Decide

## Context

Getting Started questioned the human about one idea and wrote it down. It
never made anyone look at alternatives before choosing, and it treated
every project the same: a fresh idea, a product mid-way, a team with
customer interviews, a client project.

The owner wants an intake that helps a builder think before they build,
based on the first three days of Jake Knapp's Design Sprint, facilitated by
agents, with the human as the only decider.

## Decision

- **One skill, `dybs-discover`,** runs Map, Sketch and Decide as one
  facilitator. Each stage has its own file, read only when that stage runs,
  so the fixed cost in every session is one skill description.
- **Three docs in the contract,** before the PRD: `discovery/map.md`,
  `sketch.md` and `decide.md`, validated and accepted like the others. The
  PRD and scope are then drafted from them, mostly without new questions.
  `dybs-task` turns the prototype scope into the first tasks.
- **Two kickoff answers adapt it,** instead of a menu of modes: `exists`
  (nothing, research, code) and `decides` (one, team, client). With
  `exists: code`, the map is rebuilt from the code for the human to confirm
  and the other stages run only for a new direction. A throwaway skips
  discovery.
- **Every claim carries its origin:** heard, read, researched with a link,
  a real interview, or an assumption. A simulated customer is never
  evidence.
- **Specialists on demand:** market research, customer research and counsel
  run as sub-agents only when the idea calls for them. Counsel is never
  legal advice.
- **Respect the decider:** the strongest objection is said once, the
  decision and the objection are logged, and the human moves on.

## Options considered

- **One skill, stages loaded as needed (chosen):** one coherent guide, low
  fixed cost, the existing docs intact.
- **A skill per stage:** each rerunnable on its own, but three descriptions
  in every session and three tools instead of one guide.
- **Rebuild the intake around the stages:** no overlap with the PRD, but it
  breaks the contract and every project already set up.

## Consequences

- Projects set up before this have no discovery docs; the validator names
  `map` as the next step. The human may skip discovery in `project.md`.
- Overlap with the PRD is real: Map and the PRD both name users and goals.
  The PRD now reads discovery first and asks only what it leaves open.
- Live collaboration for a team is app work. The skill records answers by
  person and shows disagreement; it does not hold a live session.
- Not run with a human yet. Thursday and Friday of the Design Sprint
  (building and testing the prototype) are left to the work loop and to the
  human.

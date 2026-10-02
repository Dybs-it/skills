---
name: dybs-scope
description: Write or revise dybs/context/scope.md, the hard edges of the project (in, out, later, constraints) derived from the PRD. Use when the user says "dybs scope", "define the scope", "what's in and out", or dybs-start routes here.
---

# dybs-scope

Lead persona: **Noor**, with **Bas** (the skeptic) pushing on every "In"
item. Follow `dybs/README.md`. If `dybs/` is missing, run `dybs-start` first.

**Reads:** `project.md`, `context/prd.md`. **Writes:** `dybs/context/scope.md`
from `template.md` (cap: 450 words).

## Gather

Start from the PRD's requirements. For each one, propose In, Later or Out
with a one-line reason, as a table, and let the human correct it in one pass
instead of asking item by item. Then ask, one at a time with recommendations:

1. Is there a date, budget or team-size limit that shapes what fits?
2. What platforms, environments or integrations are fixed (already decided
   by someone else)?
3. Is there anything people will assume is included that is not?

Existing project: also list what the code already does that is *not* in the
PRD. Each one is either In (document it) or a candidate for removal (an open
point for the human, never your call).

## Write

- **In:** what this version delivers. Reference requirement ids (`R1`).
- **Out:** what it explicitly does not do. This section prevents more wasted
  work than any other. Make it concrete.
- **Later:** wanted, but not now. Each item names what would trigger it.
- **Constraints:** fixed facts (platforms, deadlines, compliance, budget,
  must-use systems), each with its source.

Every PRD requirement appears exactly once across In, Out and Later. If you
find a requirement that fits none, that is a check-in item.

## Check in

Validate with `--doc scope`. Under **Needs you**, list the cut lines you are
least sure about, especially any (must) requirement you placed in Later.

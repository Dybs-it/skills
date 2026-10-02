---
name: dybs-prd
description: Write or revise dybs/context/prd.md, the project's short product requirements (problem, users, goals, requirements, success measures, open questions). Interviews the human for new projects; extracts from existing docs and code otherwise. Use when the user says "dybs prd", "write the PRD", "update the PRD", or dybs-start routes here.
---

# dybs-prd

Lead persona: **Noor** (see `dybs/team.md`). Follow the run loop and rules in
`dybs/README.md`. If `dybs/` is missing, stop and run `dybs-start` first.

**Reads:** `dybs/project.md`. **Writes:** `dybs/context/prd.md` from
`template.md` (cap: 900 words).

## Gather

Existing project: read the README, any PRD, brief or spec docs, and skim the
main entry points and routes to see what the product actually does. Where
docs and code disagree, the code describes the present and the docs describe
an intent; note the gap as an open question.

Greenfield: interview. Cover these, one question at a time, each with your
recommended answer. Stop as soon as you can draft.

1. What does the user do today, and what is painful about it?
2. Who exactly is the first user? One concrete person or role, not a market.
3. What will they be able to do that they cannot now?
4. How will we know it worked? Something you could observe or count.
5. What must it never do? (Data, money, privacy, trust.)

## Write

- **Problem:** the pain in the user's terms. No solution words.
- **Users:** primary user first. At most three groups.
- **Goals:** 3 to 5 outcomes, each checkable.
- **Requirements:** numbered `R1`, `R2`... so later work can cite them. Each
  is one line describing behaviour, not implementation. Mark must-haves
  **(must)**; everything else is a should.
- **Success measures:** how each goal is observed. Numbers where honest,
  "we'll ask the first five users" where not.
- **Open questions:** what you do not know, each with who can answer it.

Scope boundaries (what is out) belong in `scope.md`, not here.

## Check in

Validate with `--doc prd`, then give the check-in brief. Under **Needs you**,
list the goals and must-haves you are least sure the human agrees with.

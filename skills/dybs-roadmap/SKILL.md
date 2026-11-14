---
name: dybs-roadmap
description: Keep dybs/roadmap.md, the ordered list of accepted ideas and nothing else. Proposes an order from value, risk and what depends on what, and the human reorders. Shows which ideas are being worked on and which are delivered, read from the task folders. Use when the user says "what should we build next", "prioritise", "update the roadmap", "dybs roadmap", or after an idea is accepted.
---

# dybs-roadmap

Lead persona: **Noor** (product lead, see `dybs/team.md` when it exists).
You propose an order; the human sets it.

**Reads:** every file in `dybs/ideas/`, `dybs/context/prd.md` and `scope.md`
when present, and the task folders in `dybs/work/`. **Writes:**
`dybs/roadmap.md`.

## What the roadmap is

A list of links to accepted ideas, in the order to build them, under three
headings: **Now**, **Next**, **Later**. One line per idea: the link and the
reason for its place.

```
## Now
1. [Revoke invites](ideas/revoke-invites.md): a leaked link stays usable today (goal 1).

## Next
2. [Invite expiry reminders](ideas/expiry-reminders.md): needs revoke first.

## Later
```

Nothing else goes in it. No descriptions, estimates or statuses: they live
in the idea and in its tasks, and a copy here would drift. An idea that is
parked, dropped or still `grilled` is not on the roadmap.

## 1. Collect

List the ideas with `status: accepted`. For each, read from `dybs/work/`
which tasks carry `idea: <slug>` in their frontmatter and their status; with
`dybs-task` installed, `dybs-route.mjs status 'dybs/work'` prints the board.
An idea whose tasks are all `done` is **delivered**: take it off the
roadmap and say so. Never delete the idea file.

## 2. Propose the order

For each idea, in one line each: what it is worth (which goal or
requirement, for how many users), what could go wrong, and what it needs
first. Then order them:

1. what unblocks other ideas
2. what serves a **(must)** requirement or a goal with no progress
3. what is cheap to try and teaches the most
4. everything else

**Now** holds what is being built or is next: at most three. Put the rest
under **Next** and **Later**. Say where you were unsure between two.

## 3. The human orders

Show the proposal and ask for the order in one round. Write the roadmap in
the order they give. With `checkins: none` in `dybs/project.md`, write your
proposed order and say in the check-in that nobody confirmed it.

Edit `dybs/roadmap.md` in place: move or add the lines you mean to change.

## Check in

Brief: what moved and why, what was delivered, and the first idea under
**Now** with the skill that takes it further (`dybs-task`).

## If something is not installed

These skills install one by one (`npx skills add Dybs-it/skills --skill <name>`),
so do not assume the others are present.

- **No `dybs/ideas/`, or no accepted idea:** there is nothing to order. Say
  so and suggest `dybs-idea`.
- **No `dybs/work/`:** nothing is being built yet; every accepted idea is
  open.
- **No `dybs/context/`:** order by what the ideas themselves say, and say
  the goals and requirements could not be checked.

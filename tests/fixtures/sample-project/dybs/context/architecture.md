---
doc: architecture
status: accepted
updated: 2026-10-02
accepted: 2026-10-02
---

# Architecture: Tidy

## Shape

- Web app (server-rendered) talking to one Postgres database.
- A scheduled job advances rotations.

## Decisions

- Postgres for all persistent data ([0001](decisions/0001-postgres.md))

## Boundaries

- Only the rotation job changes assignments, so D1 holds.

## Quality bars

- **Verify:** `npm test`, `npm run lint`, CI on every push.

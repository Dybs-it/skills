---
doc: architecture
status: accepted
updated: 2026-11-01
accepted: 2026-11-01
depth: quick
---

# Architecture: Invites

## Shape
One module, `src/invites.mjs`, holding invites in memory. Callers use its exported functions only.

## Decisions
- Plain Node ESM, no dependencies.

## Boundaries
- Tests use the exported functions, never the internal map.

## Quality bars
- `npm test` (node:test) must pass. Time is passed in as `now`, never read from the clock in tests.

## Commands
`npm test`

---
task: {{task}}
status: draft
updated: {{YYYY-MM-DD}}
---

# Test plan: {{task}}

## Scope

<!-- In scope: files, routes, modules. Out of scope: what this plan does not cover. -->

## Acceptance criteria

<!-- Given/when/then, each with a priority and linked to R#/D#. Mark (proposed) if not yet confirmed. -->
- **AC1** ({{P0}}, {{R1}}): given {{...}}, when {{...}}, then {{...}}

## Risks

| Risk | Category | P | I | Score | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|---|
| {{what can go wrong}} | {{security}} | {{2}} | {{3}} | {{6}} | {{scenario id or change}} | {{name}} | open |

## Edge cases

<!-- Unhandled paths only. Location, trigger, smallest guard, consequence. -->
- `{{path:line}}`: {{trigger}}. Guard: {{...}}. Otherwise: {{...}}

## Seams

<!-- Confirmed by the human. -->
- {{seam}} (confirmed {{YYYY-MM-DD}})

## Scenarios

| Id | Priority | Level | Seam | Given / when / then | Covers | Test | Status |
|---|---|---|---|---|---|---|---|
| {{task}}-UNIT-01 | P0 | unit | {{seam}} | {{...}} | AC1, R1 | {{path:line}} | planned |

---
doc: domain
status: accepted
updated: 2026-10-02
accepted: 2026-10-02
---

# Domain: Tidy

## Glossary

| Term | Meaning | Not to be confused with |
|---|---|---|
| Household | The group of people sharing one board | Flat (the building) |
| Member | A person in a household (code: `User`) | Guest |
| Chore | A recurring task with a weekly due day | Task (one-off) |
| Rotation | The fixed order in which chores pass between members | Assignment |

## Rules

- **D1:** A chore has exactly one member assigned in any week.
- **D2:** Rotation advances every Monday at 00:00 household time.

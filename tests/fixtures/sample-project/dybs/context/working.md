---
doc: working
status: accepted
depth: quick
updated: 2026-10-02
accepted: 2026-10-02
github: yes
issues: github
pull-requests: per-task
runtime: none
---

# How we work: Tidy

## Testing

- **Levels:** unit for the chore rules, integration for the API against a real Postgres. No end-to-end tests yet.
- **Commands:** `npm test`, `npm run lint`. CI runs both on every pull request.
- **Never ships untested:** anything that decides whose turn a chore is.

## Source control

- **Repository:** GitHub, default branch `main`.
- **Issues:** GitHub issues; a task names its issue under `source:`.
- **Branches and commits:** one branch per task, named after the task.

## Pull requests

- **Policy:** a pull request per task.
- **Opens:** an agent may open a draft; the human marks it ready.
- **Merges:** the human, with CI green.

## Agents and runtime

- **Agents:** Claude Code.
- **Unattended:** build, review and gate may run alone. Nothing reaches `main` without the human.
- **Runtime:** none.
- **Budget:** the smallest model that passes the gate. *(assumption)*

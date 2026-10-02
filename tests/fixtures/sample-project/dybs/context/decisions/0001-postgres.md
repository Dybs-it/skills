---
decision: 0001
status: accepted
date: 2026-10-02
---

# 0001. Postgres for all persistent data

## Context

Small relational data, one developer.

## Decision

Use one Postgres database.

## Options considered

- **Postgres:** relational, hosted cheaply.
- **SQLite:** simpler, but harder to host for a multi-user web app.

## Consequences

One database to back up.

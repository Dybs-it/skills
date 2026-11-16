---
decision: 0011
status: accepted
date: 2026-11-16
---

# 0011. Apps read a saved validation; they never run a project's scripts

## Context

The Dybs app shows a project's Getting Started state: which docs exist,
which are valid, which are accepted. Only the validator can say whether a
doc is valid and really accepted (its `accepted-hash`). But the validator
ships inside the project (`.claude/skills/...`), and a cloned repository is
untrusted: if the app ran it when a project was opened, opening a project
would mean running code from it.

The owner chose (2026-11-16): the human runs the validator, the app reads its
result.

## Decision

- **`dybs-validate.mjs . --save`** validates the whole project and writes
  `dybs/.validation.json`: every doc's status, whether it is valid, its error
  and warning counts, and the **sha256 of its exact bytes** as validated.
- **A reader trusts a verdict only while the bytes still match.** A doc
  changed after the run is stale, not valid, whatever the file says.
- **`--save` only with a whole-project run.** With `--doc`, `--accept` or
  `--set` it is refused: the report must describe the whole project.
- **Written safely:** a fresh temporary file renamed into place; never
  through a symlink or over something that is not a regular file.
- Every skill's validating step uses `--save` for a whole-project run, so the
  saved result follows the human's normal work.

## Consequences

- The app never executes project code to show state.
- A saved file is the project's own claim, as the docs' frontmatter is. It is
  not a security boundary: it decides what the app shows, nothing more.
- The file changes on every run (`generatedAt`). Projects may commit it or
  ignore it; the app reads the working tree either way.

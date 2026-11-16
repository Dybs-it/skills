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
  and warning counts, and the **sha256 of its exact bytes** as validated:
  hashed from the same read the verdict came from, never a second read.
- **`acceptedUnchanged`** is true only for a doc accepted through `--accept`
  (it has an `accepted-hash`) and unchanged since. It says the fingerprint
  still matches, not that a person accepted: anyone can write a fingerprint.
  An acceptance written by hand is shown as accepted but not verified, as
  the method rule says.
- **A reader trusts a verdict only while the bytes still match.** A doc
  changed after the run is stale, not valid, whatever the file says.
- **Every verdict also depends on `project.md` and on the validator.**
  `basis` records the sha256 of both; a reader treats the whole report as
  stale when `project.md` no longer matches (its depth and check-ins decide
  the verdicts), and may show which validator wrote it.
- **`--accept` and `--set` refresh a saved report** when one exists, since
  both rewrite a doc; they never create one.
- **`--save` only with a whole-project run.** With `--doc`, `--accept` or
  `--set` it is refused: the report must describe the whole project.
- **Written safely:** inside the `dybs/` folder that was checked, never
  through a link (the process enters the folder it opened and confirms it by
  device and inode, so a folder swapped for a link meanwhile changes nothing);
  a fresh temporary file renamed into place and removed on any failure; never
  over something that is not a regular file.
- Every skill's validating step uses `--save` for a whole-project run, so the
  saved result follows the human's normal work.

## Consequences

- The app never executes project code to show state.
- A saved file is the project's own claim, as the docs' frontmatter is. It is
  not a security boundary: it decides what the app shows, nothing more. A
  cloned repository can commit a report whose verdicts all match its docs, so
  the app must not present it as proof that anyone checked or accepted
  anything. Keeping the report out of the repository, or binding it to this
  machine, is open (review of PR 11, X1).
- The file changes on every run (`generatedAt`). Projects may commit it or
  ignore it; the app reads the working tree either way.

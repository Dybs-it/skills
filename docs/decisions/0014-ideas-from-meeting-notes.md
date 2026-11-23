---
decision: 0014
status: accepted
date: 2026-11-22
---

# 0014. Ideas from meeting notes run in the user's own agent

## Context

The Dybs app can scan one transcript at a time by sending it to a provider
API with the user's key. Ideas then depend on a key, on the app being open,
and on someone clicking through each file. Customers drop ideas in meetings
all the time, often as a problem they describe rather than a feature they
ask for, and the same idea comes back across meetings.

The owner chose (2026-11-22): "Repeating tasks via cli. No api would be
best."

## Decision

- **A skill, not an API call.** `dybs-ideas` runs in the user's own coding
  agent (Claude Code, Codex), by hand or headless from a schedule:
  `claude -p "/dybs-ideas <folder>"` in the project folder. It asks
  nothing, and ends with one summary line or one failure line.
- **The folder is an argument**, remembered per device in
  `dybs/ideas/.folder`, which the script lists in `dybs/ideas/.gitignore`.
  The app keeps its folder per device and passes it; nothing shared holds
  a personal path. The whole folder is read, also notes added later. Single
  notes are skipped through `dybs/ideas/.skip` (per device, one file name
  per line, ignored by git): a skipped note is never opened and never
  marked read, so removing it from the list makes it new again. Owner
  decision 2026-11-23 (design boards W25 and Settings 8g).
- **The ledger is `dybs/ideas/.read.json`**, keyed by a hash of each note's
  content, so a renamed note is not read again and a changed one is.
  A note is marked only after its ideas are written and verified.
- **An idea is a proposal** in the `dybs-idea` format, `status: captured`,
  with a **Mentions** section: one line per quote with who, the meeting
  date, the source file and the version of it (`<file>@<12 hex>` of its
  content hash), and whether it was asked or a need. A repeated
  idea gets a mention in the existing file, never a second file.
- **Quotes are checked by a script**, not trusted: `dybs-ideas.mjs verify`
  fails a quote that is not in its source after folding spaces, line
  breaks, subtitle timings, Markdown quote marks and curly quotes, a quote
  under three words, and the same quote from the same note in two places.
  A mention is checked against the version it cites, under any name; once
  that version is gone (re-exported, removed) it is counted, never failed,
  so a later export cannot cost an idea its evidence. The first `new` of a
  run notes which mention lines exist (`dybs/ideas/.run.json`, per device,
  dropped by `mark`); every other line is checked strictly, and problems in
  the older ones are listed without failing, so a line nobody can fix now
  never blocks a scheduled run and a new line can never pass as old.
- **Notes are data.** The project prompt (`dybs/transcript-prompt.txt`)
  adds focus; text inside a note never instructs the agent.

## Options considered

- **The user's agent, scheduled (chosen):** no key, no app open, runs on
  what the user already pays for. Cost: the agent's judgement of "same
  idea" is not code and must be field tested.
- **Provider API from the app:** what exists today; needs a key per user
  and a click per transcript, and cannot run unattended.
- **A ledger by file name:** simpler, but a renamed export is read twice
  and an updated one is missed.

## Consequences

- The skill is unverified until a field run on a real transcript.
- The app can show ideas from notes without any new channel: it reads
  `dybs/ideas/` as before, and the Mentions lines have one fixed format.

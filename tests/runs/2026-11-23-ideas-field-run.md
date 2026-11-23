# 2026-11-23 dybs-ideas field run (one real meeting export)

The skill as of b82ef1e, in a fresh git project with no `dybs/` folder and
no project prompt. The input was a real meeting export supplied by the
owner. It stays on the owner's machine, outside any repository. This
record holds counts and behaviour only: no names, quotes, idea titles or
meeting titles.

**Input:** 1 note (`.md`, exported with timestamps), 96,048 characters,
about 85 minutes, two meetings back to back in one file. Speaker labels
exist only in part of the second meeting.

| Run | Command | Seconds | Read | New ideas | Mentions added | Files changed |
|---|---|---|---|---|---|---|
| 1 | `claude -p "/dybs-ideas <folder>" --allowedTools "Read,Write,Edit,Bash(node:*)"` | 62 | 1 | 5 | 10 | ideas, ledger, `.gitignore`, `.folder` |
| 2 | same, without the folder | 9 | 0 | 0 | 0 | none |
| 3 | a second export of the note on `.skip`, its name in other case | 8 | 0 | 0 | 0 | none |

| Check | Result |
|---|---|
| **Proposals** | 5 of 5 named as a proposal, `status: captured`, `serves: new` (no PRD, said so) |
| **Needs** | 6 of the 10 mentions are `need`, 4 are `asked` |
| **Quotes** | `verify`: 10 checked, 0 problems. Each quote was also found by hand at the moment it cites |
| **Who** | 8 `unknown speaker` (no speaker labels there), 2 a named speaker; none guessed |
| **Headless** | asked nothing; the last line was the summary line every time |
| **Twice** | run 2 read 0 notes and changed no file |
| **Skip** | the skipped note was never opened or marked; off the list, `new` listed it as new again |
| **Git** | `.folder`, `.skip` and `.run.json` never showed in `git status` |
| **Missed** | not judged by the owner yet |

**What it showed:**

- A mention had a date but no time, so in a file with two meetings nothing
  said which meeting a quote came from.
- 4 of the 5 ideas came from the first quarter of the file, the shorter
  meeting; the longer second meeting gave 1. The end of a long note got
  less attention than its start.
- Without a PRD, ideas about the team's own way of working and ideas about
  the product look the same.

**Changes made from it (round 6):** every mention carries the time its quote
starts at, checked by `verify` (`no time` when the note shows none); a long
note is read in parts of about 20,000 characters, ticked off one by one,
and `mark` waits for every part. Telling product ideas from process ideas
needs the PRD and is a follow-up.

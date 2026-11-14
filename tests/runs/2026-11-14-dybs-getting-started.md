# 2026-11-14 Dybs (existing), depth: quick, checkins: none

Skills at `main` after PR 7. A machine run, not the human field run
`tests/PROTOCOL.md` asks for: nobody answered a question and nobody judged
the docs line by line. One fresh headless Claude Code session per skill, on
Sonnet at medium effort, in a copy of the Dybs repository
(`claude -p "/dybs-<skill>" --setting-sources project --strict-mcp-config`).
The kickoff answers were given in the first prompt, since `dybs-start` is a
conversation and a headless session cannot hold one.

| Step | Turns | Tokens | Cost | Validator | Words |
|---|---|---|---|---|---|
| start | 9 | 394k | $0.24 | draft, valid | 199 |
| prd | 8 | 394k | $0.25 | draft, valid | 727 |
| scope | 5 | 249k | $0.22 | draft, valid, near the cap | 408 |
| domain | 8 | 398k | $0.25 | draft, valid | 562 |
| architecture | 7 | 412k | $0.29 | draft, valid | 652 |
| ux | 12 | 660k | $0.35 | draft, valid, near the cap | 674 |
| ui | 9 | 479k | $0.29 | draft, valid, near the cap | 648 |
| check | 6 | 333k | $0.27 | no errors | |
| **Total** | **64** | **3.32M** | **$2.17** | | |

## What worked

- **All seven docs validate** at quick depth and stay under their caps.
  Nothing outside `dybs/` was changed and nothing was committed.
- **Check-ins were respected:** no question asked, every doc left a draft,
  20 `needs-you` lines in `dybs/log.md` for the human, 17 statements marked
  *(assumption)*.
- **Accuracy, spot-checked on `architecture.md`** against what this session
  read in the Dybs code: Electron with CommonJS, one IPC module per domain,
  `ok`/`fail` results, `path-access.js` as the single gate, the Git flag
  enforced in the main process, `userData` for observations. No false claim
  found in that doc. The other six were not checked line by line.
- **It found what the docs hide.** The PRD it derived says "no upload, no
  account"; the architecture pass then listed Linear, Notion and Obsidian
  sync, a licence check, a companion server and an MCP server in the code,
  and `dybs-check` reported the contradiction as its second finding.
- **`dybs-check` did its job:** seven findings, each with the smallest fix,
  including one against the skills themselves (below).

## What went wrong

- **A decision record was written as `accepted`** though it was inferred
  from `CLAUDE.md` and nobody accepted it. The skill never said a record
  starts proposed, and the template offered `accepted` as a value. Fixed in
  the same branch: the template says `status: proposed`, the skill states
  the rule, and a test pins both.
- **`dybs-start` has no unattended kickoff.** It works when the answers are
  in the prompt, but the skill does not say so. A launcher has to know. Fixed
  in the same branch: `dybs-start` has a "When nobody can answer" section.
- **Tokens:** 3.3M for the eight steps. `CLAUDE.md` in this repository is
  about 10k tokens and 92 other skills add about 4k of descriptions, both
  read again on every turn, so roughly 0.9M of the total is fixed context
  that has nothing to do with the skills.

**Real test:** not run. It needs a fresh agent, one requirement and a human
to judge the answer.
**Change for next version:** validate decision records (status, numbering)
in the validator; cut the fixed context a launcher loads.

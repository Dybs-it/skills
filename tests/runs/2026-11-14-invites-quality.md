# 2026-11-14 invites (existing, synthetic), quality skills, checkins: none

Skills under test: branch `quality-skills` at `53760ce` (PR #3), not `main`.
Run headless with Claude Code 2.1.325, one fresh session per skill, as the
Dybs app would launch them:
`claude -p "/<skill> revoke-invite" --model <m> [--effort <e>] --setting-sources project --strict-mcp-config`.

This is a machine run, not the human field run `tests/PROTOCOL.md` asks for.
It measures tokens and whether known defects are found. It does not judge
interview quality, seams being confirmed by a human, or check-ins. One run
per cell, so differences under about 10% are noise.

## Task

A 30-line in-memory invite module with `dybs/context` (prd, domain,
architecture) and `dybs/work/revoke-invite/task.md`. The change under review
adds `revokeInvite` with four planted defects:

1. no owner check (breaks D1 and the `not-owner` criterion; security)
2. the `revoked` check runs after `expired` and `used-up` (breaks D4)
3. a test that cannot fail (`assert.ok(result !== undefined)`)
4. no test for `not-found` or for "revoked wins"

`dybs-review` ran on the untouched change. `dybs-test-plan`, `dybs-tests`,
`dybs-gate`, `dybs-pr` ran as a chain on a second copy.

## Results

Tokens are input + cache write + cache read + output, summed over the five
sessions. Cost is the CLI's own estimate.

| Run | Tokens | Output | Turns | Cost | Defects found in review | Code fixed, tests green | Gate (script) |
|---|---|---|---|---|---|---|---|
| Haiku 5.5 | 3.01M | 81k | 79 | $0.11 | 4 of 4 | yes, 9 tests | FAIL (P1 60%) |
| Sonnet 5.5 | 1.42M | 20k | 32 | $0.75 | 4 of 4 | yes, 11 tests | FAIL (P1 50%) |
| Opus 5.5 | 2.05M | 29k | 40 | $2.75 | 4 of 4 | yes, 10 tests | PASS |
| Sonnet, slimmed skills | 1.36M | 18k | 30 | $0.70 | 4 of 4 | yes, 9 tests | PASS |
| Sonnet, slimmed, `--effort low` | 1.28M | 16k | 29 | $0.63 | 4 of 4 | yes, 9 tests | PASS |
| Haiku, slimmed, `--effort low` | 2.57M | 51k | 57 | $0.08 | 4 of 4 | yes, 8 tests | CONCERNS |

Per step, Sonnet baseline: review 262k, test plan 179k, tests 373k, gate
397k, PR 208k.

"Slimmed" was a throwaway prototype: the "If something is not installed"
section moved to a `fallback.md` read only when needed, the licence
paragraph dropped from `SKILL.md` (it stays in `quality.md`), and the
staleness catalogue in `dybs-gate` step 3 and `dybs-pr` cut to the rule plus
"follow the script's message". About 25% less skill text.

## What it shows

- **About 97% of all tokens are cache reads.** Each turn re-reads the whole
  session: about 36k tokens of fixed context here, before any skill text.
  A skill's own text is 3k to 4k of that. Tokens are roughly fixed context
  times turns.
- **Slimming skill text saved about 4.5%**, inside the noise. Low effort
  saved about another 6%.
- **Fewest tokens is Sonnet, not Haiku.** Haiku takes about 2.5 times the
  turns and 4 times the output. It is the cheapest in money and the most
  expensive in tokens.
- **Opus bought nothing on this task.** Same defects found, 3.7 times the
  cost of Sonnet. The task is small; this says nothing about hard tasks.
- **The gate is not reproducible.** Six runs on the same task gave FAIL,
  FAIL, PASS, PASS, PASS, CONCERNS. The script is deterministic; the items
  table the agent feeds it is not (6 to 15 items, different priorities).
- **Nothing was logged.** No run left a record of model, effort, tokens,
  minutes or which step ran. The numbers above exist only because the
  harness kept the CLI's JSON output.
- `dybs-tests` fixed the product code on its own (red, then green). That is
  what the skill says for new behaviour, but it means "tests" is really
  "build" until `dybs-build` exists.
- Sonnet's review said it ran the axes itself "because the diff is small",
  against the skill's "run the axes in parallel". Harmless here.
- Haiku runs left `gate.md` and `pr.md` uncommitted (allowed) and one Haiku
  run wrote no separate commits per step.

## Not covered

Getting Started skills, thorough depth, interviews, a large repo, other
agents (Codex, Gemini), and a human judging the docs. `npm test` on the
branch: 649 of 657 pass here; the 8 failures are permission tests and this
container runs as root (not checked as a normal user).

**Change for next version:** (1) a deterministic items table for the gate,
built by a script from `test-plan.md`; (2) a run log line per skill run in
`dybs/work/<task>/`.

---
decision: 0004
status: accepted
date: 2026-10-04
---

# 0004. Quality skills before the work loop; the gate is code

## Context

The work loop (tasks, build, review) is not designed yet, but testing,
review and a merge gate are useful on any task or part of the code today.
BMad's Test Architect module, BMad's review lenses and Matt Pocock's `tdd`,
`code-review` and `pr` skills hold good, MIT-licensed practice for this.

## Decision

- Five skills, usable now and later from the loop: `dybs-test-plan`,
  `dybs-tests`, `dybs-review`, `dybs-gate`, `dybs-pr`.
- Results live in `dybs/work/<task>/`, one folder per piece of work. The
  roadmap's "one file per task" becomes "one folder per task": still no
  shared board file.
- One shared vocabulary, `quality.md`, copied into each skill.
- The gate decision is computed by `dybs-gate.mjs`, not by an agent:
  P0 fully covered, overall at least 80%, P1 at least 80% (90% for PASS),
  open risk 9 fails, open risk 6 to 8 raises concerns. FULL needs a test
  location. Only the human waives a FAIL, with reason, name, date and expiry;
  security gaps are never waived; waived gaps still count as gaps.
- Review axes are reported side by side and never reranked against each
  other. A third axis checks the change against the project's own
  `dybs/context` rules.

## Options considered

- **Build now, standalone (chosen):** useful immediately, shapes the loop.
- **Wait for the loop:** consistent from the start, but nothing to use now.
- **Gate as agent judgement:** simpler, but arithmetic and waiver rules are
  exactly what an agent should not decide.

## Consequences

- The work loop must create tasks as folders under `dybs/work/`.
- Waiver authority is the project's human, not a role list as in BMad.
- Thresholds are fixed for now; a project override can come later if needed.

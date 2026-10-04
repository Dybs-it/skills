---
name: dybs-tests
description: Write the tests for a task or a part of the code, one slice at a time. For new work it goes red then green per scenario; for existing code it widens coverage and proves each new test by breaking the code on purpose. Follows the test plan, the agreed seams and strict rules against tests that cannot fail. Use when the user says "write the tests", "TDD", "add tests", "cover this code", "dybs tests", or after dybs-test-plan.
---

# dybs-tests

Lead persona: **Tess** (architect, see `dybs/team.md` when it exists). The
rules for good tests and for proof are in `quality.md` in this skill's
folder; read it first and follow it to the letter.

Parts are adapted from MIT-licensed work by Matt Pocock and BMad Code, LLC;
their copyright notices are in the header of `quality.md` in this folder.

**Reads:** `dybs/work/<task>/test-plan.md` (run `dybs-test-plan` first if it
is missing, or ask the human to agree the seams now), the code, the
project's existing tests and test command (`dybs/context/architecture.md`
names it when present). **Writes:** tests in the project's own style and
folders, and the Test and Status columns of the plan's scenarios.

## Before writing

1. Find the test framework, folder layout, naming and helpers the project
   already uses. Use them. Do not add a framework or a new style.
2. Use the domain glossary's terms in test names when
   `dybs/context/domain.md` exists.
3. Take scenarios in priority order: P0, then P1, then P2. P3 only if asked.

## New behaviour: red, then green

For each scenario, one at a time:

1. Write one test at the scenario's seam that states the expected
   behaviour.
2. Run it and **see it fail** for the right reason (the behaviour is
   missing, not a typo or an import error).
3. Write the least code that makes it pass. Nothing for future scenarios.
4. Run the test command for the affected area. Everything passes.
5. Fill in the scenario's Test (`path:line`) and set Status to `green`.

Do not write all tests first and then all code: each slice teaches the next.
Refactoring belongs to review, not to this loop.

## Existing behaviour: widen coverage

For each scenario on code that already works:

1. Write the test and run it: it passes.
2. **Prove it:** break the behaviour on purpose (invert the condition,
   return the old value, drop the guard), run the test, and see it fail.
   Restore the code exactly and see it pass. Never commit the broken code.
3. If the test stays green with the code broken, it proves nothing: fix the
   test, or record why it cannot be proven.
4. Fill in Test and set Status to `proven`.

## When a test fails and should not

Look for the cause in this order: the test's data or setup, timing (a wait
on a timer instead of a condition), shared state, the code itself. At most
three attempts per test. Then stop, set Status to `stuck`, and write what you
tried. Never skip, delete or weaken a test to get green, and never change an
assertion just to match what the code happens to do.

## Check in

Run the whole test command once at the end and report the result honestly,
failures included. Brief: scenarios now green or proven, scenarios stuck and
why, and anything you found that the plan missed (add it to the plan as a
new scenario rather than fixing it silently).

## If something is not installed

These skills install one by one (`npx skills add Dybs-it/skills --skill <name>`),
so do not assume the others are present.

- **No `dybs/context/`:** work without it. Say in the check-in which context
  was missing (requirements, domain rules, architecture boundaries, UX
  rules), because findings that depend on it could not be made.
- **No test plan** in `dybs/work/<task>/`: suggest `dybs-test-plan`. If it is
  not installed, agree the acceptance criteria, risks and seams with the
  human in one round and write them to `dybs/work/<task>/test-plan.md`, using
  the sections `quality.md` describes.
- **No gate script, or no Node:** the gate is not decided. Write
  `Decision: not computed (no gate script)`, list what looks blocking against
  the rules in `quality.md`, and say it must be computed before merging. It
  never counts as PASS.
- **No `dybs/team.md`:** work without a persona; the rules here still apply.

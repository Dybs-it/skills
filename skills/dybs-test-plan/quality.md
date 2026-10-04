# Dybs quality vocabulary

Shared by `dybs-test-plan`, `dybs-tests`, `dybs-review`, `dybs-gate` and
`dybs-pr`. An identical copy sits in each of those skill folders so each one
works on its own. Edit it in `dybs-test-plan` and copy it to the others.

Adapted, not copied, from: BMad Method's Test Architect module (risk scoring,
priorities, test levels, test quality rules, the quality gate) and review
lenses (edge-case hunting, verification gaps), MIT License, Copyright (c)
2025 BMad Code, LLC; and Matt Pocock's skills (`tdd`, `code-review`, `pr`),
MIT License, Copyright (c) 2026 Matt Pocock. See `docs/sources.md` in the
Dybs skills repo for versions.

## Where results live

Everything about one piece of work goes in `dybs/work/<task>/`:

```
dybs/work/<task>/
  task.md         what is asked (written later by the work loop, or by hand)
  test-plan.md    dybs-test-plan
  review.md       dybs-review
  gate.md         dybs-gate
  pr.md           dybs-pr
```

`<task>` is the work loop's task id when there is one, otherwise a short
kebab-case name for the feature or code area (`invite-links`, `rotation-job`).
Edit these files in place; never rewrite one from memory.

## Test plan layout

`test-plan.md` has frontmatter (`task`, `status: draft|accepted`, `updated`)
and these sections, in this order, so any quality skill can write or read it
without `dybs-test-plan` installed:

- **Scope:** in scope (files, routes, modules) and out of scope.
- **Acceptance criteria:** `AC1`, `AC2`, ... each given/when/then, with a
  priority and the `R#`/`D#` it comes from; `(proposed)` until confirmed.
- **Risks:** a table `Risk | Category | P | I | Score | Mitigation | Owner |
  Status` (see Risk below).
- **Edge cases:** unhandled paths only: location, trigger, smallest guard,
  consequence.
- **Seams:** the seams the human confirmed, each with its date.
- **Scenarios:** a table `Id | Priority | Level | Seam | Given / when / then |
  Covers | Test | Status`. `Id` is `<task>-<LEVEL>-NN`, `Covers` names the
  `AC#`/`R#`, `Test` is the `path:line` that proves it, and `Status` is
  `planned`, then `green` (written first, now passing), `proven` (seen
  failing with the behaviour broken) or `stuck` (see dybs-tests).

## Risk

A risk is something that can go wrong, not a feature. Give each one a
category (security, data, business, performance, technical, operations), a
**probability** 1 to 3 (unlikely, possible, likely) and an **impact** 1 to 3
(minor, serious, critical). **Score = probability × impact.**

| Score | Action |
|---|---|
| 1 to 3 | note it |
| 4 to 5 | watch it |
| 6 to 8 | mitigate before release, with an owner; the gate says CONCERNS while it is open |
| 9 | blocks release; the gate says FAIL while it is open |

## Priority

Priority says how much the behaviour matters, not how risky the code is.

- **P0:** money, security, data that can be lost or corrupted, legal or
  compliance, or something that broke before. No safe workaround.
- **P1:** a core or frequent path for many users; a workaround is painful.
- **P2:** secondary behaviour, fewer users, an acceptable workaround.
- **P3:** rare, cosmetic or experimental.

Raise one step when most users are affected, a customer reported it, or it
spans several systems. Lower one step when it sits behind a flag, rolls back
easily, or is well isolated. Domain rules (`D1`, `D2`...) and must-have
requirements (`(must)`) are at least P1.

## Test levels

Prove each behaviour at the **lowest level that can prove it**:

- **unit:** logic with no side effects
- **integration:** storage, contracts between parts, middleware, a real
  database or queue
- **end-to-end:** critical user journeys across systems, and what only a
  real user path can show

Do not prove business logic end-to-end, test the framework, or test a
third-party library. Overlap between levels only for P0 paths.

## Seams

A **seam** is the public boundary a test observes behaviour through: a
function's interface, an API route, a screen. Tests live at seams, never
against internals. Agree the seams with the human before writing tests.

## What counts as proof

A test proves a behaviour only when it runs in the normal test command and
an assertion would fail if the behaviour broke. These prove nothing:

- skipped tests, `.only` left behind, tests outside the normal run
- no assertion, or an assertion that cannot fail (it recomputes the expected
  value the way the code does, or compares a value with itself)
- assertions only on a mock the test set up itself
- only "it did not throw", "it is defined", or a snapshot nobody checked
- a title that claims the behaviour while the assertions show nothing about it

Expected values come from an independent source: a known-good literal, a
worked example, the spec.

## Test quality rules

| Severity | Rule broken |
|---|---|
| critical | the test cannot fail (see above) |
| high | waits on a timer instead of a condition; depends on the real clock or on another test; conditional assertions; shared state that is not reset; only checks type or presence |
| medium | a promise not awaited; one test covering several unrelated behaviours; the same literal payload copied around |
| low | fragile selectors (prefer test ids, then roles, then text); a name that describes implementation instead of behaviour; magic values |

Every new test for new behaviour is **seen failing first** (red, then
green). A test added for existing behaviour is checked by breaking the code
on purpose for a moment: the test must fail, then pass again once the code
is restored. A test that stays green with the code broken proves nothing.

Never skip, delete or weaken a test to get green.

## Gate decision

Coverage per item is **FULL** (proven by tests that count), **PARTIAL** or
**NONE**. FULL needs a test location (`path:line`).

1. Any P0 item not FULL: **FAIL**.
2. Any open risk scored 9: **FAIL**.
3. Less than 80% of all items FULL, or less than 80% of P1 items FULL: **FAIL**.
4. Less than 90% of P1 items FULL, or an open risk scored 6 to 8: **CONCERNS**.
5. Otherwise: **PASS**.

Only the human can waive a FAIL, never an agent. A waiver needs a reason,
the human's name, a date no later than today, and an expiry date. Security
items are never waived, and a risk without a known category is treated as
security. A waived gap still counts as a gap.

The decision is computed by `dybs-gate/scripts/dybs-gate.mjs`, never by an
agent. Without the script the gate is **not computed**, and a gate that was
not computed never counts as PASS.

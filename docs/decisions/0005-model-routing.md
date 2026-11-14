---
decision: 0005
status: proposed
date: 2026-11-14
---

# 0005. Route model and effort by step and complexity; log every run

## Context

The human wants the fewest tokens per task without losing quality. A
measured run of the five quality skills on one small task
(`tests/runs/2026-11-14-invites-quality.md`) showed:

- About 97% of tokens are cache reads: the session's fixed context, read
  again on every turn. Skill text is a tenth of that context or less.
- Sonnet used the fewest tokens. Haiku needed about 2.5 times the turns.
  Opus found nothing more on a small task, at 3.7 times Sonnet's cost.
- Nothing recorded which model ran, or how hard the task was.

Some tasks do need a stronger model. Which ones must be known before the
step starts, and a wrong guess must be corrected cheaply.

## Decision

- **One table, as code:** `dybs-task/scripts/dybs-route.mjs` maps step
  and complexity (S, M, L, XL) to a model and an effort.
- **Complexity is computed, not felt:** from the test plan and the code it
  names: files and lines in scope, folders touched, scenarios, test levels.
  What the planning agent only judged (risk scores, priorities) adds one
  point at most, because six runs on the same task disagreed on it. The
  human overrules the score with `complexity:` in the plan's frontmatter.
- **The launcher picks the model.** A skill cannot change the model it runs
  on, so `route --flags` prints the flags for whoever starts the step: the
  Dybs app, a shell alias or the human.
- **No `model:` or `effort:` in skill frontmatter.** It cannot follow
  complexity, a model switch inside a long session writes the whole context
  to the cache again, and other agents' handling of unknown frontmatter is
  not verified.
- **Escalate on evidence:** a step that ends `stuck` is run again one model
  up, never on the same model.
- **Every step appends one line to `dybs/work/<task>/log.md`:** step,
  event, complexity, routed model and effort, and the model it says it ran
  on. The gate treats the log as an output, like `pr.md`, never as evidence.

## Options considered

- **Route by step and complexity, launcher picks (chosen):** follows the
  task, works for any agent that takes a model flag, one home for the rule.
  Cost: without a launcher the human must pass the flags.
- **Static `model:` per skill:** no launcher needed, but blind to
  complexity and Claude Code only.
- **Skill delegates to a sub-agent on the routed model:** works inside one
  session and gives the work a small context. Not measured yet; a candidate
  for `dybs-build`.
- **Always the strongest model:** simplest, and the most tokens.

## Consequences

- Token counts are not in the log: a skill cannot see its own usage. The
  launcher records them (the Dybs app, or `claude -p --output-format json`).
- The thresholds and the table are a first guess, measured only at S. They
  need runs on L and XL tasks before they count as verified.
- The gate's items table is still built by the agent and still differs
  between runs. A script that builds it from the test plan is the next step.

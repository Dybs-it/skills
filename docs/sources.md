# Sources

Every Dybs skill, what it does, what is our own, and what is adapted from
which project at which version. Adapted text is rewritten into our own
method; nothing syncs automatically. To see what changed upstream since,
diff the upstream file between the version below and its current head, then
decide what to bring in.

When you add or change a skill, update its section here in the same commit.
When you adapt something new, check the license first and keep its notice in
the adapted file and in [NOTICE.md](../NOTICE.md).

## Upstream projects

| Short name | Project | License | Version used |
|---|---|---|---|
| **Matt** | [mattpocock/skills](https://github.com/mattpocock/skills) | MIT, Copyright (c) 2026 Matt Pocock | commit `d81f3a183412e71a5b1e84ca21bc1a35eea03a60` (2026-09-29) |
| **BMad** | [BMad Method](https://github.com/bmad-code-org/BMAD-METHOD) | MIT, BMad Code, LLC | 6.12.0 |
| **TEA** | [BMad Test Architect module](https://github.com/bmad-code-org/bmad-method-test-architecture-enterprise) | MIT, Copyright (c) 2025 BMad Code, LLC | v1.27.0, commit `4ca1db6` |
| **show-me** | [humanlayer](https://github.com/humanlayer/humanlayer) `show-me` skill by Dex Horthy | Apache License 2.0 | idea only, no text taken |

BMad, BMAD-CORE and BMAD-METHOD are trademarks of BMad Code, LLC; they are
not used as names here.

## Shared files

### `interview.md` (in every Getting Started skill)

How every Getting Started interview runs: two depths, how depth combines with
check-ins, collect first, ask in numbered rounds, sharpen, confirm, log,
deepen later, re-accept after a change.

- **Our own:** quick and thorough depth with requested versus written depth,
  the depth and check-ins table, the decision log format, the rule that a
  changed accepted doc becomes a draft, the round file (`dybs/.round.json`)
  each round is written to for the Dybs app.
- **Adapted from Matt** `skills/productivity/grilling/SKILL.md`: rounds over
  a frontier of open questions, a recommended answer per question, facts
  looked up rather than asked.
- **Adapted from BMad** `bmad-prd`: collect everything first, the concern
  scan, keeping a decision log.

### `quality.md` (in every quality skill)

The shared vocabulary for testing, review and the gate: where results live,
risk, priority, test levels, seams, what counts as proof, test quality rules,
gate rules and waivers.

- **Our own:** `dybs/work/<task>/` as the home for results, the human as the
  only waiver authority, "prove a test on existing code by breaking the code
  on purpose".
- **Adapted from TEA** (`testarch-test-design`, `testarch-test-review`,
  `testarch-trace` and the knowledge files `probability-impact.md`,
  `test-priorities-matrix.md`, `test-levels-framework.md`,
  `test-quality.md`, `risk-governance.md`): risk score as probability ×
  impact and its actions, P0 to P3, test level selection, quality rules by
  severity, gate thresholds and waiver requirements.
- **Adapted from Matt** `skills/engineering/tdd/SKILL.md`: seams, tests that
  cannot fail (tautological), red before green.

### `dybs-start/assets/team.md`

The personas (Noor, Ezra, Tess, Mila, Jun, Bas) as lenses: who leads, what
they care about, what they always ask, what they won't accept.

- **Our own:** the six personas, their names and questions.
- **Inspired by BMad** agents: personas as a way to make an AI team feel
  like a team. No text taken.

### Validator and gate script

`dybs-start/scripts/dybs-validate.mjs` (doc contract, depths, acceptance),
`dybs-gate/scripts/dybs-gate.mjs` (gate decision) and
`dybs-start/scripts/dybs-probe.mjs` (what the repository shows, read-only),
`dybs-task/scripts/dybs-route.mjs` (task complexity, model and effort
per step, the run log).

- **Our own:** all code. The gate rules it computes are adapted from TEA, as
  described under `quality.md`.

## Getting Started skills

### `dybs-start`

Runs the kickoff like an agency would: the idea in a few lines, a few sharp
questions, then advice (quick, thorough, custom, park it) and routing
through the docs.

- **Our own:** the kickoff flow, the advice options, the route table by
  project type, the status and routing.
- **Adapted:** the interview method via `interview.md` (see above).

### `dybs-discover`

Discovery before requirements: Map (goal, users, journey, the questions
that could sink it, one target), Sketch (research and several different
concepts) and Decide (critique, the human's choice, rejected alternatives,
storyboard, prototype scope). Specialist briefs for market research,
customer research and counsel.

- **Our own:** the three docs and their contract, the origin tags on every
  claim, the two kickoff answers (`exists`, `decides`) that adapt the
  stages, "respect the decider", and the rule that a simulated customer is
  never evidence.
- **Adapted from the Design Sprint** by Jake Knapp, John Zeratsky and
  Braden Kowitz, as described in *Sprint* (Simon & Schuster, 2016): the
  first three days (Map, Sketch, Decide), the long-term goal, sprint
  questions, the journey map and target, lightning demos, distinct solution
  sketches, the decider and the storyboard. The method is followed; no text
  is taken from the book.
- **Questions in rounds** follow the shared `interview.md` (adapted from
  Matt Pocock's `grilling`, see above).

### `dybs-prd`

Writes `context/prd.md`: problem, users, goals, numbered requirements,
success measures, open questions.

- **Our own:** the short PRD shape, `R#` requirements, the core checklist.
- **Adapted from BMad** `bmad-prd`: journeys told with a named person,
  counter-metrics, the concern scan (thorough items).

### `dybs-scope`

Writes `context/scope.md`: in, out, later and constraints, with every
requirement placed exactly once.

- **Our own:** all of it.

### `dybs-domain`

Writes `context/domain.md`: the glossary and the testable business rules
(`D#`).

- **Our own:** the doc shape, `D#` rules, code names mapped in the glossary.
- **Adapted from Matt** `skills/engineering/domain-modeling/SKILL.md`:
  sharpening vague terms, testing rules with edge-case scenarios, checking
  the human's statements against the code, updating the glossary the moment
  a term is settled.

### `dybs-architecture`

Writes `context/architecture.md` and decision records: shape, decisions,
boundaries, quality bars.

- **Our own:** the doc shape, the decision record template, "describe what
  is" for existing code.
- **Adapted from Matt** `skills/engineering/domain-modeling/SKILL.md`: a
  decision record only when a choice is hard to reverse, surprising later,
  and a real trade-off.

### `dybs-ux`

Writes `context/ux.md`: principles, key flows with their failures, behaviour
rules, accessibility.

- **Our own:** all of it.

### `dybs-ui`

Writes `context/ui.md`: tone, token roles, components, do and don't, pointing
to tokens in code when they exist.

- **Our own:** all of it.

### `dybs-working`

How the work is done on this project: what is tested and how, GitHub and
where issues live, the pull request policy, and which agents and runtime do
the work. The work loop reads it. Ships no script of its own; it uses
`dybs-start/scripts/dybs-probe.mjs`.

- **Our own:** the doc, its machine-readable frontmatter, and the rule that
  facts are probed and only decisions are asked.
- **Inspired by TEA** `testarch-framework` and `testarch-ci`: a project
  states its test levels and what CI must show. No text taken.

### `dybs-check`

Validates every doc, reads them together for contradictions and gaps,
checks readiness and depth, runs the agent-ready test, and asks for
acceptance.

- **Our own:** all of it, including the agent-ready test with a fresh
  sub-agent and the generated readiness checklists.

## Planning skills

### `dybs-idea`

Captures one idea in `dybs/ideas/<slug>.md`, questions it against the
context, collects each persona's advice, and records the human's decision.

- **Our own:** the idea file, the four words of advice (go, change, park,
  drop), the rule that only the human decides.
- **Adapted from Matt** `skills/productivity/grilling/SKILL.md`: numbered
  rounds of questions, each with a recommended answer. The notice is in the
  skill.
- **Inspired by BMad** party mode: several personas reviewing one thing.
  Much smaller; no text taken.

### `dybs-ideas`

Reads new meeting notes and transcripts from a folder, writes each idea in
them as a proposal in `dybs/ideas/<slug>.md` with the exact quotes behind
it, and adds a mention to an existing idea instead of a duplicate. Asks
nothing, so it runs headless on a schedule. Ships `scripts/dybs-ideas.mjs`
(the ledger of read notes, the check that every quote is in its source,
the per-device skip list and the record of which mentions a run found).

- **Our own:** all of it: the mention line, the asked and need kinds, the
  ledger keyed by content, the verbatim check, the summary and failure
  lines. The "need" kind (a problem described without asking for a
  feature) follows common product discovery practice; no text taken.

### `dybs-roadmap`

Keeps `dybs/roadmap.md`: links to accepted ideas in build order, nothing
else.

- **Our own:** all of it. A roadmap of links, so it cannot drift from the
  ideas, is a lesson from a shared status file that lost its rows.

## Quality skills

### `dybs-task`

Turns an issue or an idea into `dybs/work/<task>/task.md`: the ask, checkable
acceptance criteria, the files it touches, what is out of scope. Shows the
board. Ships `scripts/dybs-route.mjs`.

- **Our own:** the task format, the fast and full lanes computed from the
  task, the board derived from task folders, and the script.
- **Inspired by Matt** `skills/engineering` issue slicing and **BMad** story
  files: one unit of work with its own acceptance. No text taken.

### `dybs-build`

Builds one task test first, fixes open review findings, and keeps the task's
status so a fresh session can resume.

- **Our own:** the status rules, the fix loop over checklist findings, the
  fast-lane rule of one test per acceptance criterion.
- **Adapted from Matt** `skills/engineering/tdd/SKILL.md`: one behaviour at a
  time, red then green, the least code that passes (shared with
  `dybs-tests`).
- **Adapted from TEA** `testarch-test-review`: the order for looking into a
  failing test (shared with `dybs-tests`).

### `dybs-done`

Closes a merged task and writes down what the work taught that the context
does not say yet, as proposals for the human.

- **Our own:** all of it. The idea that a retrospective feeds the next
  piece of work is common practice; BMad's `bmad-retrospective` does it per
  epic. No text taken.

### `dybs-test-plan`

Decides what to test for a task or part of the code: acceptance criteria as
given/when/then, risks, an edge-case hunt, seams agreed with the human, and
prioritised scenarios.

- **Our own:** the plan shape in `dybs/work/<task>/test-plan.md`, linking
  scenarios to `R#` and `D#` from `dybs/context`.
- **Adapted from TEA** `testarch-test-design` and `testarch-atdd`: risk
  assessment, priorities, levels, acceptance criteria as scenarios, scenario
  ids.
- **Adapted from BMad** `bmad-review` lens `lens-edge-case-hunter.md`:
  mechanical path-by-path tracing, implicit branches of a fixed set,
  re-checks, call signatures, removed code.
- **Adapted from Matt** `skills/engineering/tdd/SKILL.md`: agree seams with
  the human before any test.

### `dybs-tests`

Writes the tests, one slice at a time: red then green for new behaviour,
proven by breaking the code for existing behaviour; at most three attempts
on a failing test, never weakened.

- **Our own:** proving tests on existing code by breaking it on purpose, the
  plan status columns.
- **Adapted from Matt** `skills/engineering/tdd/SKILL.md`: red before green,
  vertical slices, refactoring belongs to review.
- **Adapted from TEA** `testarch-automate` and `test-healing-patterns.md`:
  widening coverage of existing code, a limit on attempts to fix a failing
  test.

### `dybs-review`

Reviews a change on four axes reported side by side and never reranked:
standards, spec, the project's `dybs/context` rules, and verification gaps.

- **Our own:** the context axis (glossary, domain rules, architecture
  boundaries, UX rules), `review.md` in the task folder.
- **Adapted from Matt** `skills/engineering/code-review/SKILL.md`: standards
  and spec axes as separate sub-agents, a code-smell baseline as judgement
  calls that a repo standard overrides, no reranking across axes.
- **Adapted from BMad** `bmad-review` lens `lens-verification-gap.md`: the
  verification axis (regression, missing adoption, tests that cannot fail;
  read a test before claiming what it covers).

### `dybs-gate`

Builds the requirement-to-test matrix, records open risks, and lets
`scripts/dybs-gate.mjs` compute PASS, CONCERNS or FAIL; only the human
waives, never for security.

- **Our own:** the gate as code, the `gate.md` table format, "FULL needs a
  test location", the human as the only waiver authority.
- **Adapted from TEA** `testarch-trace`: the traceability matrix, coverage
  levels, gate thresholds, waiver requirements, security never waived, a
  waived gap still counting as a gap.

### `dybs-pr`

Writes the PR description: one small picture of the change, before and after
evidence, the gate result, one-way or two-way door and blast radius.

- **Our own:** linking the gate result and `R#`/`D#`, "say what was not
  verified", asking before opening a PR.
- **Adapted from Matt** `skills/engineering/pr/SKILL.md`: summary, evidence
  and merge danger sections, door and blast radius.
- **Idea from show-me** (Apache 2.0, via Matt's `pr`): pick one small
  picture (call tree, file tree, diagram, diff sketch) to summarise a
  change. Written in our own words.

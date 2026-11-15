# Dybs.it skills

The Dybs method as agent skills, from a first idea to a merged change: a
short, human-accepted project context (**Getting Started**), **ideas** and
a **roadmap**, and a **work loop** that takes one issue through build,
review, the quality gate and the PR. Agents draft and advise; you decide.
What is built and what is still unproven: [docs/ROADMAP.md](docs/ROADMAP.md).

## Install

With the [skills](https://skills.sh) package manager (Claude Code, Codex,
Cursor, Gemini CLI, Copilot and more):

```
npx skills add Dybs-it/skills --skill '*'          # all skills, you pick the agents
npx skills add Dybs-it/skills --skill dybs-start   # one skill
npx skills add Dybs-it/skills                      # pick skills and agents from a list
```

In Claude Code, as a plugin:

```
/plugin marketplace add Dybs-it/skills
/plugin install dybs@dybs-it
```

While this repo is private, both work for anyone with read access to it on
GitHub (they clone with your git credentials).

## Use

In your agent, say **"dybs start"**. It runs a kickoff like a good agency
would: you describe your idea in a few lines, it asks a handful of sharp
questions (type of project, who it is for, where it stands, how long it
should live), then advises how to continue and lets you choose: a quick
start, a thorough kickoff, a custom mix, or park it for later.

```
project → prd → scope → domain → architecture → ux → ui → working → check
```

| Skill | Writes | Lead persona |
|---|---|---|
| `dybs-start` | the kickoff: `dybs/project.md`, `log.md`, `README.md`, `team.md`; routes to the next step | Noor |
| `dybs-prd` | `context/prd.md` | Noor |
| `dybs-scope` | `context/scope.md` | Noor, with Bas |
| `dybs-domain` | `context/domain.md` | Ezra |
| `dybs-architecture` | `context/architecture.md`, `context/decisions/` | Tess |
| `dybs-ux` | `context/ux.md` | Mila |
| `dybs-ui` | `context/ui.md` | Jun |
| `dybs-working` | `context/working.md` (tests, GitHub and issues, pull requests, agents and runtime) | Tess, with Bas |
| `dybs-check` | nothing; one check-in brief across all docs | Bas |

### Quick or thorough

The kickoff recommends thorough unless the project is a throwaway: agents
build from these docs many times, so a gap left now is a guess repeated in
every task. You choose:

| | quick | thorough |
|---|---|---|
| For | side projects, experiments, a first try | long-term products |
| Time | about 5 to 10 minutes per doc | about 10 to 20 minutes per doc (1 to 2 hours in total) |
| Interview | core questions, at most two rounds | every question, until nothing is open |
| Gaps | marked *(assumption)* with an open question | answered, or parked by you with a reason |
| Check | consistency across docs | plus an agent-ready test by fresh sub-agents |

Both write the same docs, so agents and tools never care which you chose.
Each doc records the depth it was really written at; the validator reports
`needs thorough` for a doc below the requested depth, and never promotes a
doc because a setting changed. Changing an accepted doc makes it a draft
again; `--accept` fingerprints the accepted version so a later edit is caught.

Depth decides which questions get asked; check-ins decide when you review.
`each-doc` and `end` both ask interview questions (`end` saves the reviews
for the final check); `none` asks nothing and leaves every doc a draft, so it
only combines with quick.
Single docs can differ (`thorough: architecture` in a quick project), and a
quick doc can be deepened later without starting over.

Every interview works the same way (`interview.md` in each skill): it first
collects what you have and looks up facts itself, then asks numbered rounds
of questions, each with a recommended answer you can accept with "yes".
Every decision lands in `dybs/log.md`.

Every skill works on its own. Without `dybs-start` installed, a skill says
which one to add; without the validator, it checks the doc by hand.

## Ideas and roadmap

```
dybs-idea → the human decides → dybs-roadmap → dybs-task
```

| Skill | Does | Writes |
|---|---|---|
| `dybs-idea` | Captures one idea, questions it against the context in rounds with recommended answers, and collects each persona's advice: go, change, park or drop. You decide | `dybs/ideas/<slug>.md` |
| `dybs-roadmap` | Proposes an order for the accepted ideas; you set it. Links only, so it cannot drift from the ideas | `dybs/roadmap.md` |

## Quality: test, review, gate, PR

Five skills that also work on their own, on any task or part of the code. Results go in
`dybs/work/<task>/`, one folder per piece of work.

| Skill | Does | Writes |
|---|---|---|
| `dybs-test-plan` | Risks (probability × impact), P0 to P3, the lowest test level that proves each behaviour, seams agreed with you, given/when/then scenarios, and a mechanical hunt for unhandled edge cases | `test-plan.md` |
| `dybs-tests` | Red then green, one slice at a time; for existing code each new test is proven by breaking the code on purpose. Never skips or weakens a test | tests, plan status |
| `dybs-review` | Separate axes, never ranked against each other: standards, spec, your `dybs/context` rules, security, and changed behaviour no test would catch | `review.md` |
| `dybs-gate` | Requirement → test matrix that counts only tests that really prove it; PASS, CONCERNS or FAIL computed by a script. Only you can waive, with a reason and an expiry; security gaps never | `gate.md` |
| `dybs-pr` | PR text: one small picture of the change, before and after evidence, the gate result, one-way or two-way door and blast radius | `pr.md` |

They share one vocabulary, `quality.md`, copied into each so every skill
works on its own.

### The work loop: an issue from start to merge

```
dybs-task → (dybs-test-plan) → dybs-build → dybs-review → (dybs-gate) → dybs-pr → merge → dybs-done
```

| Skill | Does | Writes |
|---|---|---|
| `dybs-task` | Turns an issue or an idea into one task: the ask, checkable acceptance, the files it touches. Shows the board | `task.md` |
| `dybs-build` | Builds the task test first, fixes open review findings, keeps the task's status so a fresh session can resume | code, tests |
| `dybs-done` | Closes a merged task and proposes what the context should learn from it | `task.md` |

A small task (at most two files, three acceptance criteria, no domain rule)
goes the **fast lane** and skips the test plan and the gate. Everything
else goes the **full lane**. A script decides, from the task file, and you
overrule it with `lane:` in the task's frontmatter:

```
node .claude/skills/dybs-task/scripts/dybs-route.mjs status dybs/work          # the board
node .claude/skills/dybs-task/scripts/dybs-route.mjs next dybs/work/<task>     # the next skill, or what it waits on from you
```

The loop stops for you, and never decides for you: a gate FAIL, review
findings that are questions, a step that gave up twice, three reviews
without closing the findings, and the merge itself. See decision 0007.

### The right model for the task

Tokens are mostly fixed context times turns, so the cheapest run is the
smallest model that gets it right in few turns. A script scores each task
**S, M, L or XL** from its test plan and the code it names, and holds one
table of model and effort per step:

```
node .claude/skills/dybs-task/scripts/dybs-route.mjs score dybs/work/<task>
claude $(node .claude/skills/dybs-task/scripts/dybs-route.mjs route dybs/work/<task> tests --flags) "/dybs-tests <task>"
```

Small and medium tasks run on Sonnet; large ones plan, build and review on
Opus; the gate and the PR text stay on Sonnet at low effort. A step that
gets stuck names the next model up instead of trying again. You overrule
the score with `complexity: L` in the plan's frontmatter. Every run appends
one line to `dybs/work/<task>/log.md`: step, complexity, the routed model
and the model it really ran on. The table is a first guess from one small
measured task (`tests/runs/`); see decision 0005.

## The dybs-skills CLI

For what a package manager can't do. Until it is on npm, run it from GitHub:

```
npx github:Dybs-it/skills validate                # check the project's dybs/ context
npx github:Dybs-it/skills validate --doc prd --json
npx github:Dybs-it/skills validate . --accept prd      # on your word: accepted, dated, fingerprinted
npx github:Dybs-it/skills validate . --set working pull-requests=none   # what the app's settings call
npx github:Dybs-it/skills update --dry-run        # what a safe update would change
npx github:Dybs-it/skills update                  # update installed Dybs skills
npx github:Dybs-it/skills status                  # where they are installed
```

`update` finds Dybs skills in every `.<agent>/skills/` folder (and your home
folder with `--global`), follows the link a package manager makes for a
whole skill folder, and only touches skills that are already installed. **It never overwrites your edits:** a file is replaced
only when it still matches a version this package shipped. Anything you
changed is reported and left alone; `--force` replaces it and keeps a `.bak`.
A file you changed that a release no longer ships stays too, and with
`--force` the rest of the skill is updated around it.
A replaced file keeps its permissions and owner. Extended attributes and ACLs
on it are not carried over (Node has no portable way to read them), so give
such a file its attributes again after an update, or leave the skill to
update by hand.
A skill with anything that needs you is left completely unchanged, so it
never mixes files from two releases. Links inside a skill are never followed
or written through, `--force` included. `--dry-run --json` prints the plan.
Discovery covers `.<agent>/skills/` folders directly under the project (and
home with `--global`), not every place a package manager or plugin can live.
A skill that resolves outside the folder you asked for (say, through a
linked `.claude` folder) is reported and left alone. Each installed skill
folder is updated as one unit: if writing fails halfway, the files already
changed in that folder are put back. Folders updated before it stay updated,
and the error names them.

`npx skills update` also works, but replaces skill files whole.

## Principles

- **Short beats complete.** Every doc has a word cap, enforced by the validator.
- **Agents draft, humans accept.** Only your explicit word marks a doc accepted.
- **You choose the check-ins:** `each-doc`, `end` or `none`. Agents only
  interrupt outside those for a small, fixed set of safety stops.
- **In your repo, in your control.** Plain Markdown in `dybs/`. No service.

## Develop

```
npm test                 # validator contract, safe update, CLI, skill consistency
npm run sync-rules       # after changing MANUAL_RULES or any readiness checklist
npm run record-hashes    # after changing any file under skills/ (tests fail until you do)
claude plugin validate . # plugin and marketplace manifests
```

- `skills/dybs-start/scripts/dybs-validate.mjs` (`DOCS`) is the single home
  for required sections and word caps. Change a template and the contract
  together; the tests fail if they drift.
- `src/update.mjs` owns the safe-update rule. `src/known-hashes.json` is
  append-only: it is how an untouched install of any released version is
  told apart from a user's edit.
- How to field-test the skills on real work: [tests/PROTOCOL.md](tests/PROTOCOL.md).

## Credits

Inspired by the [BMad Method](https://github.com/bmad-code-org/BMAD-METHOD)
(MIT), especially its personas, and by
[Matt Pocock's skills](https://github.com/mattpocock/skills), especially
grilling with recommended answers and a shared domain language. No text is
copied verbatim from either. See [NOTICE.md](NOTICE.md) and
[docs/sources.md](docs/sources.md) for exactly what was adapted, from which version.

---
decision: 0009
status: proposed
date: 2026-11-14
---

# 0009. Intake asks how the work is done, after a script has looked up the facts

## Context

Getting Started asked about the product: problem, scope, domain,
architecture, experience and looks. It did not ask how the work itself is
done: what must be tested, whether the code and the issues are on GitHub,
whether every task ends in a pull request, which agents run and whether a
runtime such as Herdr is used. The work loop needs exactly those answers and
had no place to read them from.

The owner wants the intake to question the human thoroughly. Questions cost
the human time and the agent turns, and many of these are not questions at
all: a script can see the remote, the `gh` CLI, the test tools and the CI
workflows.

## Decision

- **A probe runs first.** `dybs-start/scripts/dybs-probe.mjs` reports what
  the repository and the machine show. It is read-only: it lists files,
  reads manifests, runs `git` for the remote and `gh auth status` for the
  sign-in state, and looks agents and runtimes up on `PATH` without running
  them. What it reports is a fact and is not asked.
- **An eighth doc, `dybs/context/working.md`,** written by `dybs-working`:
  Testing, Source control, Pull requests, Agents and runtime. Its
  frontmatter (`github`, `issues`, `pull-requests`, `runtime`) is what
  scripts read; the prose is for people.
- **The work loop follows it.** `dybs-route.mjs next` skips the PR step when
  `pull-requests: none`; `dybs-task` reads issues with `gh` when the doc
  says GitHub; `dybs-pr` opens a pull request only where the doc lets an
  agent do so, or on the human's word.
- **Thorough is the kickoff's recommendation,** quick the exception. Agents
  build from these docs many times; a gap left at intake is a guess repeated
  in every task.
- **Tools are the human's to install.** With GitHub wanted and `gh` missing
  or signed out, the skill gives the commands and lists it under Needs you.
  It installs nothing and signs in nowhere.
- **A runtime is recorded, never required** (decision 0006). `runtime:
  herdr` is the human's choice for a launcher to read; no skill depends on
  it.

## Options considered

- **A new doc (chosen):** one place, validated like the others, readable by
  a script. Cost: an eighth step at intake.
- **More frontmatter in `project.md`:** no new step, but no room for the
  reasons, and `project.md` is capped at 250 words.
- **Fold it into `architecture.md`:** testing commands are already there,
  but pull requests and agents are not architecture, and that doc is already
  the longest.
- **Ask everything, probe nothing:** simpler, and the human answers
  questions the repository already answers.

## Consequences

- Projects set up before this have no `working.md`. Every skill works
  without it and says so; the validator reports the doc as the next step.
- The probe sees two folders deep and only common tools. What it misses is
  asked, not assumed absent: "none found" is not "none".
- Not run with a human yet.

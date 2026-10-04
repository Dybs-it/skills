---
name: dybs-review
description: Review a change against a fixed point (commit, branch or main) on separate axes that are never ranked against each other - standards (the repo's rules plus a code-smell baseline), spec (does it do what was asked), context (the project's domain rules, architecture boundaries and UX rules) and verification (changed behaviour no test would catch). Runs the axes as parallel sub-agents and writes dybs/work/<task>/review.md. Use when the user says "review", "code review", "review this branch", "dybs review", or before a PR.
---

# dybs-review

Lead persona: **Bas** (the skeptic, see `dybs/team.md` when it exists). The
meaning of proof and of a good test is in `quality.md` in this skill's
folder.

**Reads:** the diff, the task and test plan in `dybs/work/<task>/` when
present, the repo's own standards, and `dybs/context/` when present.
**Writes:** `dybs/work/<task>/review.md` from `template.md`. Findings only:
fix nothing unless the human asks.

## 1. Pin the change

Ask for the fixed point if the human did not give one (a commit, branch,
tag or `main`). Check that it resolves and that the diff is not empty before
anything else. Use `git diff <point>...HEAD` (against the merge base) and
`git log <point>..HEAD --oneline`.

## 2. Gather the sources

- **Spec:** `dybs/work/<task>/task.md`, issue references in the commits, or
  a spec file the human names. If there is none, the spec axis reports "no
  spec available" and is skipped.
- **Standards:** files that say how code is written here (`CONTRIBUTING.md`,
  `AGENTS.md`, `CLAUDE.md`, a style guide). Skip what linters already
  enforce.
- **Context:** `dybs/context/domain.md` (glossary and rules),
  `architecture.md` (boundaries and quality bars), `ux.md`, `ui.md`.

## 3. Run the axes in parallel

Give each axis its own sub-agent with the diff command, the commit list and
only the sources it needs, so one axis cannot colour another. Each returns
at most 400 words, quoting the line or rule behind each finding. Without
sub-agents, run the axes one after another and write each down before
starting the next.

**Standards.** Every place the diff breaks a written repo standard (cite
file and rule), plus these smells as judgement calls, never as hard
violations. A written repo standard always overrides the baseline:

- a name that does not say what the thing does or holds
- the same logic in more than one place in the change
- a function that works mostly on another object's data
- the same few values always passed around together (a missing type)
- a plain string or number standing in for a domain concept
- the same switch on the same type in several places
- one change that forces edits scattered over many files
- one file changed for several unrelated reasons
- hooks, options or abstractions the spec does not need
- long chains of calls through other objects
- a layer that only passes calls on
- a subclass that ignores most of what it inherits

**Spec.** Requirements missing or partly done; behaviour nobody asked for;
requirements that look done but look wrong. Quote the spec line each time.

**Context.** Terms that contradict the glossary; domain rules (`D#`) the
change breaks or bypasses; calls across a boundary `architecture.md`
forbids; UX behaviour rules (loading, empty, error, destructive actions) the
change ignores. Skip this axis when `dybs/context/` does not exist, and say
so.

**Verification.** For each behaviour the change alters (output, error,
side effect, default, contract), name the smallest realistic way it could
break where it is used, then find the test that would catch that. A finding
is a changed behaviour no test would catch, a place that should use the new
behaviour but does not, or a test that looks like it covers the change but
cannot fail (see "What counts as proof" in `quality.md`). Read a test before
claiming what it covers; search the whole repo before claiming none exists.
Say how far you looked. Unchanged legacy code without tests is not a
finding.

## 4. Write the review

One section per axis, findings as the sub-agent gave them, lightly cleaned.
**Do not merge or rerank across axes:** code can follow every standard and
still do the wrong thing, or do the right thing against every convention,
and one axis must not hide the other. End with one line: the number of
findings per axis and the most serious one within each axis.

## Check in

Brief: the summary line, then what needs the human (findings that are
design questions rather than fixes). Hand fixes to the person or agent doing
the work; with the human's go, fix them and run `dybs-review` again.

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

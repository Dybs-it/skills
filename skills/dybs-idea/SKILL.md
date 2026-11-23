---
name: dybs-idea
description: Capture one idea and test it before anyone builds it. Writes dybs/ideas/<slug>.md with the problem, who it is for and what it serves, questions it against the project's context one round at a time with recommended answers, and collects each persona's advice (go, change, park or drop). The human decides. Use when the user says "I have an idea", "what if we", "should we build", "grill this idea", "dybs idea", or wants a feature thought through before it becomes work.
---

# dybs-idea

Lead persona: **Bas** (the skeptic, see `dybs/team.md` when it exists).
Agents advise here; the human decides. Never write a decision for them.

The questioning in rounds with recommended answers is adapted from Matt
Pocock's `grilling` skill (https://github.com/mattpocock/skills), MIT License,
Copyright (c) 2026 Matt Pocock.

**Reads:** what the human says, `dybs/context/` when present (PRD goals and
requirements, scope, domain rules, architecture boundaries), the other files
in `dybs/ideas/`, and the code where a question can be answered by looking.
**Writes:** `dybs/ideas/<slug>.md` from `template.md`. No code, no task.

## 1. Capture

Write the idea down as it was said, in a few lines: the problem, who has
it, and what would be different. No solution detail the human did not give.
Name the file with two to four words in kebab-case (`revoke-invites`).

Say what it serves: a goal or requirement in the PRD (`R#`), or that it is
new. An idea that the scope lists under **Out** is still captured: say so in
the first line of the advice, it is the human's call to change the scope.

If an idea file on the same subject exists, edit that one.

An idea found in meeting notes by `dybs-ideas` has **Mentions**: quotes
with who said them and when. Read them as the evidence for the problem, and
never edit them.

## 2. Grill

Test the idea against what the project already says. Look up what can be
looked up; ask only what the human alone knows. One numbered round at a
time, at most five questions, each with your recommended answer:

```
**Q1. <short title>**
<the question, with options where that helps>
→ Recommended: <your answer, and why in one line>
```

Ask about, most important first:

- **The problem:** who has it today, how often, and what they do instead.
- **The smallest version** that would show whether it works.
- **What it breaks or bends:** a domain rule, a boundary, a scope line, an
  existing flow. Name the rule.
- **What it costs later:** data to migrate, a contract to keep, something
  hard to undo.
- **How we would know it worked.**

Stop when another round would not change the advice. With `checkins: none`
in `dybs/project.md`, ask nothing: write each question with your
recommended answer, marked *(assumption)*.

Record every question and answer under **Grilling** in the file, one line
each. Edit in place; never rewrite the file from memory.

## 3. Advise

An idea big enough to change the product's direction (a new audience, a
new problem, a pivot) deserves more than a grilling: recommend a new round
of `dybs-discover`, which reopens the map and explores concepts before
anyone decides.


Each persona the idea touches gives one line of advice: **go**, **change**
(to what), **park** (until what) or **drop**, with the reason and what would
change their mind. Bas always speaks. Leave out a persona with nothing to
add; four voices saying the same is noise.

Then one recommendation of your own, in one line. Advice that is all "go"
on a first pass deserves a second look: say what the strongest objection
would be.

## 4. The human decides

Ask for the decision: **accepted**, **parked** or **dropped**, with a line
why. Write it under **Decision** only in their words, and set `status:` and
`decided:` in the frontmatter. Until then the status stays `grilled`.
Silence is not a decision.

## Check in

Brief: the idea in one line, what the grilling changed, the advice, and what
the human is asked to decide. For an accepted idea, the next step is
`dybs-roadmap` to place it, or `dybs-task` to turn it into work.

## If something is not installed

These skills install one by one (`npx skills add Dybs-it/skills --skill <name>`),
so do not assume the others are present.

- **No `dybs/` folder:** create `dybs/ideas/` and work without the context.
  Say in the check-in that nothing could be checked against requirements,
  scope or domain rules, and suggest `dybs-start`.
- **No `dybs/team.md`:** give the advice as yourself, under the same four
  words (go, change, park, drop).
- **No `dybs-task`:** an accepted idea still becomes work; the human writes
  the task, or installs it with `npx skills add Dybs-it/skills --skill dybs-task`.

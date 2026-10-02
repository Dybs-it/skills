# The Dybs interview

Every Dybs Getting Started skill gathers what it needs this way. The skill
supplies the **readiness checklist**; this file supplies the method. An
identical copy sits in every skill folder so each skill works on its own.

The rounds-and-frontier method is adapted from Matt Pocock's `grilling`
skill (https://github.com/mattpocock/skills), MIT License,
Copyright (c) 2026 Matt Pocock. The brain dump, concern scan and decision
log are ideas from the BMad Method (MIT).

## Depth

The human chooses how deep to go. Read it from `dybs/project.md`:
`depth: quick | thorough` for every doc, and the lists `quick:` and
`thorough:` for docs that differ. Unset means quick.

| | quick | thorough |
|---|---|---|
| For | side projects, experiments, a first try | long-term products you will build on for months |
| Time | about 5 to 10 minutes per doc | about 15 to 30 minutes per doc |
| Covers | checklist items marked **core** | every checklist item |
| Rounds | at most two | until nothing is open |
| Gaps | written as *(assumption)* plus an open question | each answered, or parked by the human with a reason |
| Before drafting | summary folded into the check-in | summary confirmed by the human |

Both depths write the same doc with the same sections. Thorough allows a
longer doc, but the reasoning belongs in `dybs/log.md`, not in the doc.

## 1. Collect first

Ask once: "What do you already have? Notes, docs, links, designs, code,
anything else?" Read all of it. Use sub-agents for large sources and keep
only what they extract.

**Facts are your job, decisions are the human's.** Never ask something you
can find in the code, the repo or the material you were given. Look it up,
and cite where you found it.

## 2. Map what is open

Turn the readiness checklist into a tree of open questions. Mark each item:

- **settled:** already answered by the material, an earlier doc or the log
  (note the source)
- **open:** needs the human
- **blocked:** depends on another open item

Thorough only: also run a **concern scan**. Name the concerns this product
really carries (privacy, money, compliance, integrations, offline use,
scale, accessibility, safety, or whatever applies) and add a branch for
each one. A concern that does not apply is settled as "not applicable", with
the reason.

## 3. Ask in rounds

The **frontier** is every open item whose prerequisites are settled. Ask the
whole frontier in one round, at most seven questions; if there are more,
ask the most fundamental ones first. Number every question and give your
recommended answer:

```
**Q1. <short title>**
<the question, with options where that helps>
→ Recommended: <your answer, and why in one line>
```

The human can answer briefly: "all yes", "Q2: no, it's the admin",
"park Q4: later". After each round:

1. Append every decision to `dybs/log.md` (see below).
2. Recompute the frontier: settled answers unblock new questions.
3. Ask the next round.

While asking, **sharpen**:

- When a word is vague or used two ways, propose one precise term
  ("account: the customer or the login?").
- Test rules with a concrete scenario that sits on the edge
  ("A flatmate leaves mid-week. Who does their chore?").
- When the human says how something works and code exists, check the code.
  If they disagree, ask which one is right.

**Stop:**

- **quick:** when every core item is settled, or after two rounds. Every
  core item still open becomes an *(assumption)* in the doc and an open
  question.
- **thorough:** when nothing is open. An item the human parks needs a reason
  and goes to the doc's open questions.

## 4. Confirm, then draft

Summarise what you understood in at most ten bullets.

- **thorough:** ask "Is anything wrong or missing?" and wait. Draft only after
  the human confirms.
- **quick:** draft straight away and put the summary in the check-in.

Record the depth in the doc's frontmatter (`depth: quick` or
`depth: thorough`).

## Decision log

`dybs/log.md` is the interview's memory, so nothing is lost and a later run
can resume. Create it if missing. Append one line per decision; never edit or
remove earlier lines:

```
- 2026-10-02 prd Q3: The first user is the household admin, not every flatmate. (human)
- 2026-10-02 prd: Payments are out; other apps do this well. (human, parked R5)
- 2026-10-02 architecture: Postgres, because the data is relational. (read from package.json)
```

## Going deeper later

A quick doc can be deepened at any time: run the skill again at thorough
depth. Start from the existing doc and its log lines, mark what they cover as
settled, and ask only about what is still open. Then update the doc and set
`depth: thorough`.

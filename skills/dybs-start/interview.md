# The Dybs interview

Every Dybs Getting Started skill gathers what it needs this way. The skill
supplies the **readiness checklist**; this file supplies the method. An
identical copy sits in every skill folder so each skill works on its own.

The rounds-and-frontier method is adapted from Matt Pocock's `grilling`
skill (https://github.com/mattpocock/skills), MIT License,
Copyright (c) 2026 Matt Pocock. The brain dump, concern scan and decision
log are adapted from the BMad Method
(https://github.com/bmad-code-org/BMAD-METHOD), MIT License,
Copyright (c) 2025 BMad Code, LLC.

## Depth

The human chooses how deep to go. Two things are recorded, and they are not
the same:

- **Requested depth**, in `dybs/project.md`: `depth: quick | thorough` for
  every doc, and the lists `quick:` and `thorough:` for docs that differ.
  Unset means quick.
- **Written depth**, in each doc's own frontmatter `depth:`: how deep the
  interview behind that doc really went. Write it honestly. A doc without it,
  or written at quick where thorough is requested, **needs deepening**; it is
  never thorough because a setting changed.

| | quick | thorough |
|---|---|---|
| For | side projects, experiments, a first try | long-term products you will build on for months |
| Time | about 5 to 10 minutes per doc | about 10 to 20 minutes per doc |
| Covers | checklist items marked **core** | every checklist item |
| Rounds | at most two | until nothing is open |
| Gaps | written as *(assumption)* plus an open question | each answered, or parked by the human with a reason |
| Before drafting | summary folded into the check-in | summary confirmed by the human (with `checkins: each-doc`) |

Both depths write the same doc with the same sections. Thorough allows a
longer doc, but the reasoning belongs in `dybs/log.md`, not in the doc.

## Depth and check-ins

Depth decides **which questions** need an answer. Check-ins (`checkins:` in
`project.md`) decide **when the human reviews**. Interview questions are not
check-ins: they are the work itself. Safety stops (see `dybs/README.md`)
apply at every setting.

| `checkins` | Interview rounds | Summary before drafting | Review |
|---|---|---|---|
| `each-doc` | asked | thorough: confirmed before drafting; quick: in the check-in | after every doc |
| `end` | asked | collected for the final check | once, at `dybs-check` |
| `none` | not asked: open items become *(assumption)* plus an open question | none | none: docs stay `draft`, the final report lists what awaits acceptance |

Thorough needs the human's answers, so it does not combine with `none`. If
`project.md` says both anyway, interview at quick depth, write
`depth: quick` in the doc, and say so in the final report.

## 1. Collect first

Read `dybs/project.md` and the `kickoff` lines in `dybs/log.md` first: the
kickoff already collected the idea and the sources. Ask only for what is new
for this doc: "Anything else I should read for this part?" Without a
kickoff, ask once: "What do you already have? Notes, docs, links, designs,
code, anything else?" Read all of it. Use sub-agents for large sources and keep
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

- **thorough with `each-doc`:** ask "Is anything wrong or missing?" and
  wait. Draft only after the human confirms.
- **otherwise:** draft straight away; the summary goes into the check-in, or
  into the final check with `end`.

Record the depth the interview really reached in the doc's frontmatter
(`depth: quick` or `depth: thorough`). Write `thorough` only when every
checklist item is answered or parked by the human.

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

A quick doc can be deepened at any time:

1. If the project is quick overall, add the doc to `thorough:` in
   `dybs/project.md`, so the requested depth says so too.
2. Run the skill again. Start from the existing doc and its log lines, mark
   what they cover as settled, and ask only about what is still open.
3. Update the doc, set `depth: thorough`, and make it a draft again (below).

## Changing an accepted doc

An accepted doc means the human accepted **that version**. Any real change,
deepening included, makes it a draft again: set `status: draft` and remove
`accepted` and `accepted-hash`. The human then accepts the new version.
Fixing a typo is not a real change; anything that changes meaning is.

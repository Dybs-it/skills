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
| Gaps | written as *(assumption)* plus an open question | each answered, or waiting on someone the human named |
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
code, anything else?" With `checkins: none`, ask neither: use what is already
in `dybs/`, `dybs/log.md` and the repo. Read all of it. Use sub-agents for large sources and keep
only what they extract.

A doc listed under `skip:` in `project.md` is not read, even if a file is
there. Work without it, and write what it would have answered as an open
question in your doc.

When Node is available, `dybs-start/scripts/dybs-probe.mjs` (in the folder
that holds the skills) reports what the repository itself shows: source
control and GitHub, the `gh` CLI, test tools and commands, CI, UI libraries,
design tokens, a style guide, and the agents and runtime on this machine.
Run it rather than ask.

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

**Answers.** For each question the human has four answers, and may give
them briefly, one line per question:

- **Accept** the recommendation: `Q1: accept` (or "all yes", "yes to all
  but Q3").
- **Their own answer:** `Q2: <answer>`, such as "Q2: no, it's the admin".
- **Not clear:** `unclear Q3` or `unclear Q3: <what is unclear>`. The
  question stays open: explain it or reword it in the next round. Never
  take the recommendation for it.
- **Ask someone else:** `ask Q4: <who>: <what to ask>`. The human has no
  answer yet and names who has. The question now waits on that person (see
  **Waiting on someone** below).

There is no "later": a question is set aside only while someone has no
answer yet, and then it waits on a named person. The Dybs app sends the
answers as one message headed `Answers to round <id> (from Dybs):`, with
one line per question in these forms; read it as if the human typed it. A
`park Q3: <reason>` line (from an older app) is read as `unclear`: the
question stays open and is asked again next round. Say so in one line.

**Waiting on someone.** Write each `ask` answer into the doc's open
questions (its **Open questions** section; a doc without one gets a short
`## Open questions` at the end) as one list item, exactly:

```
- **Waiting on Anna** (since 2026-11-18): May we keep salaries? Ask: does finance allow storing them?
```

The name as the human gave it, `since` the date of the answer, then the
question, then `Ask:` and what to ask. The validator reads this form (rule
`waiting`, and `waiting` per doc in its JSON) and reports any other line
that starts `**Waiting on`. A doc with a waiting question is **not
accepted**: the validator refuses `--accept` and fails an accepted one. It
is completed in the flow, when the answer comes (see **Questions waiting on
someone**). The agent's own *(assumption)* items at quick depth are not
waiting on anyone and do not block acceptance.

**The round file.** Before asking a round in the session, write it to
`dybs/.round.json` as well, replacing the round before it, so the Dybs app
can show it on screen. Asking in the session stays exactly as it is, and
answers may come from either. After reading the human's answers, set its
`status` to `answered`.

```json
{
  "version": 1,
  "id": "discovery-map-2",
  "stage": "Discovery", "doc": "map", "round": 2,
  "title": "Who has this problem, exactly?",
  "asker": "Noor", "skeptic": { "name": "Bas", "remark": "Everyone is not a user." },
  "intro": "Most of the map is settled. A round or two to go.",
  "questions": [
    { "n": 1, "title": "The first user", "question": "Who feels this first?", "recommended": "The household admin.", "why": "They set the house up." }
  ],
  "settled": [ { "text": "Chores are shared weekly.", "tag": "heard" } ],
  "status": "open",
  "next": "round"
}
```

- `id` is new for every round and never reused: `<stage>-<doc>-<round>`
  in lowercase, with hyphens for spaces (`getting-started-prd-1`), plus
  the date when a doc is interviewed again. `stage` is `Kickoff`,
  `Discovery` or `Getting Started`; `doc` is the doc being written.
- `questions` are the questions of the session, numbered the same.
- `asker` is your lead persona; `skeptic` only when the skeptic has a
  remark; `intro` says in a line or two where the interview stands.
- `settled` is what is settled so far, each tagged with where it came
  from: `heard`, `read`, `researched`, `interview` or `assumption`.
  Leave out the names and personal details of the people you heard from:
  the file is kept in `dybs/` with the docs.
- `next` is `summary` when this is the last round before the summary,
  otherwise `round`.
- When Node is available and `dybs-start/scripts/dybs-validate.mjs`
  exists, run it on the project and fix only what it reports under
  `.round.json`: the rest of its report is about the docs, not this round.

After each round:

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
- **thorough:** when nothing is open. An item the human sends to someone
  else (`ask`) goes to the doc's open questions as waiting on them; an item
  that is not clear is asked again, reworded, never taken as recommended.

## 4. Confirm, then draft

Summarise what you understood in at most ten bullets.

- **thorough with `each-doc`:** ask "Is anything wrong or missing?" and
  wait. Draft only after the human confirms.
- **otherwise:** draft straight away; the summary goes into the check-in, or
  into the final check with `end`.

Record the depth the interview really reached in the doc's frontmatter
(`depth: quick` or `depth: thorough`). Write `thorough` only when every
checklist item is answered or waiting on someone the human named; a waiting
item still keeps the doc from acceptance.

## 5. Check in

What a skill's **Check in** section asks for depends on `checkins` in
`dybs/project.md`:

- **`each-doc`:** validate, then give the check-in brief with its
  **Needs you** items, and wait for the human.
- **`end`:** validate, then write each **Needs you** item to `dybs/log.md` as
  a `needs-you` line and go on without asking. `dybs-check` brings them to
  the human in the one final review.
- **`none`:** validate, write the same `needs-you` lines, and do not ask
  anything. The final report lists them with what awaits acceptance.

Give each item an id (`NY1`, `NY2`... counting on from the log). When the
human answers one, append a `resolved` line with the same id; the log stays
append-only. An item is open while it has no `resolved` line.

```
- 2026-10-02 prd needs-you NY3: Is "household admin" really the first user? (inferred)
- 2026-10-05 prd resolved NY3: Yes, the admin sets the house up first. (human)
```

## Decision log

`dybs/log.md` is the interview's memory, so nothing is lost and a later run
can resume. Append one line per decision; never edit or remove earlier lines.
Create it fresh only when `dybs/project.md` does not exist yet. If it is
missing while `dybs/project.md` exists, the decisions behind the docs are
lost: say so before writing anything, and recreate it from what `project.md`
and the docs record (one `kickoff` line per frontmatter choice, marked
*(recovered)*). Never re-ask or draft on without it. The check-in setting
decides when the human sees those lines: `each-doc` (or none set) asks them
to confirm or correct the lines now; `end` lists them in `dybs-check`;
`none` lists them in the final report.

```
- 2026-10-02 prd Q3: The first user is the household admin, not every flatmate. (human)
- 2026-10-02 prd Q5: Waiting on Anna: are payments in? Ask: does finance want them? (human, ask R2)
- 2026-10-09 prd Q5: Payments are out; other apps do this well. (Anna, via human)
- 2026-10-02 architecture: Postgres, because the data is relational. (read from package.json)
```

## Questions waiting on someone

When any skill runs on a doc that has a waiting question, ask about those
first, before anything else, one per waiting line: "Did Anna answer? May we
keep salaries?"

- **Answered:** write the answer into the doc where it belongs, remove the
  waiting line, and log it with who answered (`(Anna, via human)`).
- **Not yet:** the line stays and the doc stays a draft. Go on with the
  rest of the work.
- The human may also answer it now themselves, or send it to someone else
  (the line then names the new person, with a new `since`).

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
That holds for a typo too: the validator cannot tell a typo from a change of
meaning. For a typo, a one-line ask is enough ("Fixed a typo in prd.md,
accept again?").

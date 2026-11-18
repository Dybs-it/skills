---
decision: 0013
status: accepted
date: 2026-11-18
---

# 0013. A question is set aside only while it waits on someone

## Context

The interview let the human "park" a question with a reason ("park Q4:
later"). A parked question went to the doc's open questions and the doc
could still be accepted, so a question could be set aside just to move on,
or settled by quietly taking the recommendation.

The owner chose (2026-11-18): "a question we set aside only happens if
someone doesn't have an answer yet, so we don't rush things by just taking
a suggestion. If the question is not clear, we should clarify it. Sometimes
that needs humans. Then we set it aside. It must be completed in the flow."

## Decision

- **Four answers per question:** accept the recommendation (`Q1: accept`),
  give one's own (`Q2: <answer>`), **not clear** (`unclear Q3` or
  `unclear Q3: <what is unclear>`), or **ask someone else**
  (`ask Q4: <who>: <what to ask>`). There is no free "later".
- **Not clear** keeps the question open: the agent explains or rewords it
  in the next round and never takes the recommendation for it.
- **Ask someone else** writes the question into the doc's open questions in
  one machine-readable form:
  `- **Waiting on <who>** (since YYYY-MM-DD): <question> Ask: <what to ask>`.
- **A doc with a waiting question is not accepted.** The validator fails an
  accepted doc that has one (rule `waiting`), so `--accept` refuses it, and
  reports any other line that starts `**Waiting on`, so no reader misses
  one. When the human comes back to the doc, any skill first asks "Did Anna
  answer?" for each waiting question. dybs-check lists them and never asks
  to accept such a doc.
- **The agent's own assumptions are unchanged.** At quick depth, core items
  still open after two rounds become *(assumption)* plus an open question;
  they wait on nobody and do not block acceptance.
- **The app** sends answers under `Answers to round <id> (from Dybs):` in
  the same short forms. An older app's `park Q3: <reason>` is read as
  `unclear`: the question stays open and is asked again.
- **The validator reports what waits on whom:** every doc in `--json`
  (`results[]`) and in the saved report (`docs[]`, decision 0011) has
  `waiting: [{ who, question, since, ask }]`, empty when none. The plain
  report lists them per doc and sums them up ("Waiting on someone: prd:
  Anna (1 question)"). The fields are added, so neither output's `schema`
  number changes. The round file (decision 0012) needs no new field: the
  answers come back as a message, and the waiting question lives in the
  doc.

## Consequences

- Getting Started is complete only when every question set aside has been
  answered by the person who could answer it.
- A doc can stay a draft for days while someone answers; the app can show
  "Waiting for an answer from Anna (1 question)" from the saved report.
- Ideas keep their own words (go, change, park or drop) and the kickoff its
  "park it": those park a whole idea or kickoff, not a question.

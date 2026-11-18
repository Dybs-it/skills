---
decision: 0012
status: accepted
date: 2026-11-17
---

# 0012. The skills write each question round to a file the app reads

## Context

The intake asks its questions in rounds, in the agent session. The Dybs app
should show each round on screen, as designed (Dybs-it/dybs-desktop-app#297):
a card per question with the recommended answer, what is settled so far, and
who is asking. Parsing the session's terminal output for that would be
fragile. Decision 0011 already holds that the app writes nothing in `dybs/`
and runs none of a project's scripts.

The owner chose (2026-11-17): the skills write the round to a file, the app
reads it.

## Decision

- **The skills own `dybs/.round.json`.** The shared interview rules
  (`interview.md`, **Ask in rounds**) write the current round there before
  asking it in the session, with a new `id` per round and `status: open`,
  and set `status: answered` once they have read the answers. One file,
  replaced by every new round. dybs-discover's stages and dybs-start's
  kickoff follow the same rule.
- **The shape is version 1**, as agreed in #297: `version`, `id`, `stage`,
  `doc`, `round`, `title`, `questions` (1 to 7, each with `n`, `title`,
  `question`, `recommended`, `why`, numbered 1..k in order), `status`
  (`open` or `answered`) and `next` (`round` or `summary`) are required;
  `asker`, `skeptic` (`name`, `remark`), `intro` and `settled` (`text`,
  `tag`) are optional. Tags are the skills' source tags (`SOURCE_TAGS` in
  the validator, kept in step with dybs-discover by a test).
- **The validator checks the file** on a whole-project run, when it is
  there; no file is not an error. A one-doc check (`--doc`) skips it, and
  the saved report (decision 0011) stays about the docs: the round changes
  between runs, and the app checks the file itself.
- **The app reads, never writes.** It reads the file through its read-only
  bridge, writes nothing in `dybs/`, and sends the person's answers back as
  one message in the session, in the short form the rules already accept
  ("Q1: accept", "Q2: <answer>", "unclear Q3: <what is unclear>",
  "ask Q4: <who>: <what to ask>", under the header
  `Answers to round <id> (from Dybs):`). "park Q3: <reason>" was replaced
  by these on 2026-11-18 (decision 0013) and is read as "unclear".
- **Asking in the session is unchanged.** A person in a terminal answers as
  before; the file only adds a view.

## Consequences

- The app shows rounds without parsing agent output and without running
  project code.
- The file is the agent's claim about the round, like any doc: the app shows
  an invalid or unreadable one as such and leaves the person in the session.
- A change to the shape is a new `version`, made in the skills and the app
  together.
- Rounds outside the intake (ideas, tasks, reviews) can use the same file
  later; they do not yet.

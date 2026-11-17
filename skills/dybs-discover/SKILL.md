---
name: dybs-discover
description: Product discovery before anything is specified or built, in three stages adapted from the first three days of a Design Sprint - Map (the long-term goal, who has the problem, their journey, the questions that could sink it, and one target to focus on), Sketch (research into existing solutions, then several genuinely different concepts) and Decide (critique, the human's choice, rejected alternatives, a storyboard, and the prototype scope). Writes dybs/discovery/map.md, sketch.md and decide.md. Specialists (market research, customer research, legal) join only when the idea calls for them. Use when the user says "dybs discover", "discovery", "design sprint", "map the problem", "explore solutions", "help me decide what to build", or dybs-start routes here.
---

# dybs-discover

You facilitate discovery the way an experienced sprint facilitator would:
curious, direct, and honest about what is known and what is not. The human
is the product owner and makes every decision. You and the specialists
bring structure, research, alternatives and critique.

The three stages (Map, Sketch, Decide) are adapted from Jake Knapp's
Design Sprint, as described in *Sprint* (Knapp, Zeratsky and Kowitz,
2016). No text is taken from the book.

**Reads:** `dybs/project.md`, `dybs/log.md`, and what the human shares
(notes, interviews, links), including anything in `dybs/discovery/research/`.
**Writes:** `dybs/discovery/map.md`, `dybs/discovery/sketch.md` and
`dybs/discovery/decide.md` from the templates in this folder (caps: map 700, sketch 900, decide 700 words quick;
twice that thorough), and appends each round's answers and every decision
to `dybs/log.md`.

Run the interview in `interview.md` (in this folder) at the depth
`dybs/project.md` sets for each doc. Follow the rules in `dybs/README.md`.
A stage listed under `skip:` in `project.md` is not run. Every round of
questions, in every stage, also goes to `dybs/.round.json` as
`interview.md` says under **Ask in rounds**, with `stage: Discovery` and
`doc:` the stage's doc (`map`, `sketch` or `decide`).

## Which stage

Run the first stage whose doc is missing, failing or still a draft, in the
order map, sketch, decide. Read only that stage's file in this folder:
`map.md`, `sketch.md` or `decide.md`. Each holds the stage's steps and its
readiness checklist. Going back is always allowed: the human may reopen an
accepted stage, which makes it a draft again (see `dybs/README.md`), and
the stages after it are checked against the change.

## When the human is not asked now

Each stage ends with a confirmation ("Done when" in its file). With
`checkins: end` or `none` in `dybs/project.md`, the human chose not to be
asked now, so that confirmation waits for the review point they chose: do
not stop. Carry on with your recommendation, mark it *(assumption)*, list it
under **Needs you**, and leave the doc a draft.

Decide is the exception for the decision itself: nobody may choose for the
human. Write the recommended concept under **Decision** as
`Not decided yet. Recommended: <concept>, because ...`, and build the
storyboard and prototype scope for that recommendation, marked
*(assumption)*. The PRD and the rest then build on a recommendation the
human has not made, and say so.

## Who is in the room

`dybs/project.md` holds two kickoff answers. Adapt to them; never show the
human a list of modes.

- **`exists:`** what there is to start from.
  - `nothing`: a fresh idea. Run all three stages.
  - `research`: interviews, notes or data already exist. Read them first
    and build the map from them; every claim cites its source
    (`(interview 3)`). Ask only for what the material does not say.
  - `code`: a product that already runs. Reconstruct the map from the code,
    the docs and the human's account, and ask them to confirm or correct it.
    Sketch and Decide are for a new direction; when there is none, the
    kickoff skips them.
- **`decides:`** who makes the decisions.
  - `one`: the human in front of you.
  - `team`: ask each person separately where you can, record answers by
    name, and show where people disagree instead of averaging it away. A
    decision needs the person or people the team named as deciders.
  - `client`: the client decides, even when someone else answers. Record
    each decision with the client's name, or as *waiting for the client*.

## Facts and assumptions

Every statement in the discovery docs carries its origin:

- *(heard)*: the human said it
- *(read: source)*: from their material or the code
- *(researched: link)*: found by research, with the link
- *(interview N)*: from a real customer interview
- *(assumption)*: nobody has shown it yet

Never invent what customers need. A simulated customer is not evidence:
use one only to find questions worth asking real people, and mark the
result *(assumption)*.

## Respect the decider

Advise, then accept the human's call. When the human decides against the
evidence or the advice, say the strongest objection **once**, then record
the decision and the objection in `dybs/log.md` ("chose X; research
pointed to Y") and move on. Do not raise it again unless new evidence
appears. Recognise when there is enough to proceed, and say so.

## Specialists

Read `specialists.md` in this folder when a stage calls for one. Each
specialist runs as a sub-agent with only the brief and what it needs, and
returns a short summary with its sources. Without sub-agents, do the same
work yourself as a separate step and keep its result apart from your own
view. Call a specialist only when the idea triggers it; most need none.

## Check in

After each stage: validate with `--doc map`, `--doc sketch` or
`--doc decide`, then give the check-in brief from `dybs/README.md`. A
stage is done only when the human confirms it (each stage file names what
they confirm). Discovery ends with a chosen direction, **not** proof that
it works: say so in the last check-in, and name the assumptions the
prototype must test.

## If something is not installed

These skills install one by one (`npx skills add Dybs-it/skills --skill <name>`),
so do not assume the others are present.

- **No `dybs/` folder, or no `dybs/project.md`:** the project is not set up;
  stop and suggest `dybs-start`. If that skill is not
  installed, the human can add it with
  `npx skills add Dybs-it/skills --skill dybs-start`.
- **No `dybs/README.md`, or one that cannot be read:** the method rules
  (safety stops, editing accepted docs, the check-in format) are missing;
  stop and suggest `dybs-start`, which restores it. Do not go on without it.
- **Accepting:** when the human accepts a doc in their own words, run the
  validator with `--accept <name>` if it is installed (it sets the status,
  the date and the `accepted-hash` fingerprint, and refuses a doc that does
  not validate). Without it, set `status: accepted` and `accepted:` by hand
  and say the acceptance is not fingerprinted.
- **Validating:** if `dybs-start/scripts/dybs-validate.mjs` exists in the
  same skills folder as this skill and Node is available, run it from the
  project root: `node <path> . --save` for the whole project (it also saves
  the result for the Dybs app), or `--doc <name>` for one doc. Otherwise
  check every rule below by hand. Say in the check-in which way you
  validated.

<!-- rules:start (generated by scripts/sync-rules.mjs, do not edit) -->
1. The doc starts with a frontmatter block between two `---` lines; every line in it is one `key: value`, and no key appears twice.
2. Frontmatter `doc` is exactly this doc's name (for example `doc: prd`).
3. Frontmatter `status` is `draft` or `accepted`, nothing else.
4. Frontmatter `updated` is a date written as YYYY-MM-DD.
5. An `accepted` doc also has `accepted: YYYY-MM-DD`, set only on the human's word.
6. Every required `##` section is present (see the template or the doc contract).
7. Frontmatter `depth`, when present, is `quick` or `thorough`.
8. The doc is under the word cap for the depth it was written at (its own `depth`; quick when it has none), counting the text as it renders: HTML comments, code blocks, link destinations and titles, and reference definitions do not count.
9. An accepted doc is not changed, neither its content nor its frontmatter settings (anything but `status`, `updated`, `accepted` and `accepted-hash`), not even for a typo. Any change sets `status: draft` and removes `accepted` and `accepted-hash`, and the human accepts again. (`accepted-hash` is written by the validator's `--accept` and lets it detect a change. Checking by hand cannot recompute it: report such a doc as accepted but not verified, and a doc accepted without `accepted-hash` the same way.)
10. In project.md, `quick:`, `thorough:` and `skip:` name only known docs (map, sketch, decide, prd, scope, domain, architecture, ux, ui, working), no doc is both `quick` and `thorough`, and `skip:` keeps what a remaining doc needs (sketch needs map; decide needs sketch; scope, domain, architecture and ux need prd; ui needs ux). `working` is never skipped: every project says how its work is tested and merged.
11. In working.md, `github` is `yes` or `no`, `pull-requests` is `per-task` or `none`, and `runtime` is `none` or `herdr`, each when present. Scripts and the app act on these values, so nothing else is read.
12. In project.md, `checkins`, when present, is `each-doc`, `end` or `none`. With `none`, every doc that is not skipped is quick (no `depth: thorough` that applies, nothing under `thorough:`): thorough needs answers.
13. No raw HTML outside code: no HTML tag such as `<pre>`, `<div>` or `<details>` anywhere in the text as it renders, and nothing starting with `<?`, `<!` or `<![CDATA[`. It changes what renders in ways a reader of the source cannot see. HTML comments, autolinks (`<https://…>`), and link destinations and titles and reference definitions (`[docs](<details>)`, `[docs]: <details>`) are fine.
14. No `{{...}}`, TODO or TBD in the text as it renders: HTML comments, link destinations and titles, and reference definitions do not count (a URL that holds TODO is fine). In a draft this is a warning; in an accepted doc it is an error.
<!-- rules:end -->

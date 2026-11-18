---
name: dybs-check
description: Final Getting Started step in the Dybs method. Validates every context doc, then reads them together looking for contradictions, gaps and unsupported claims, and gives the human one check-in brief to accept the context as the base for ideas and work. Use when the user says "dybs check", "is the context ready", "review the getting started docs", or dybs-start routes here.
---

# dybs-check

Lead persona: **Bas** (the skeptic). Follow `dybs/README.md`. If `dybs/` is
missing, run `dybs-start` first.

**Reads:** everything in `dybs/`. **Writes:** only on the human's word: the
fixes they ask for, `resolved` lines in `dybs/log.md` for the `needs-you`
items they answer, and the acceptance of the docs they name (see
**4. Check in**). Otherwise nothing; your output is the check-in brief.

## 1. Mechanical check

Validate every doc (see *If something is not installed* below for how).
Every error is listed first in the brief. Missing docs
that are not under `skip:` are errors here, even though the validator treats
them as a next step. A `FAIL` on `.round.json` is not a doc error: it is
the last question round an interview left behind. List it apart from the
docs; the interview writes it again on its next round, or the human deletes
it.

## 2. Read across

Read the docs as one body and check these, citing file and section for
every finding. A check that compares docs runs only between docs that are
not under `skip:`; a skipped doc is the route the human chose, never a
finding:

1. **Traceability.** Every PRD requirement is placed exactly once in scope
   (In, Out or Later), when scope is not skipped. Every goal has a success
   measure.
2. **Language.** Terms used in prd, scope, architecture, ux and ui (those
   not skipped) match the glossary, when domain is not skipped. Flag
   synonyms the glossary forbids or never defines.
3. **Contradictions.** Scope constraints versus architecture choices; UX
   rules versus UI components; domain rules versus requirements; the test
   commands and quality bars in architecture versus Testing in working;
   the CI and merge rules in architecture versus Pull requests in working;
   the chosen direction and prototype scope in decide versus the PRD's
   requirements and the scope's In and Out;
   working's frontmatter settings versus its own prose (the app changes
   only the frontmatter, so the frontmatter is the decision and the fix is
   to run `dybs-working`): each pair only when neither of its docs is
   skipped.
4. **Unsupported claims.** Statements presented as fact that nobody said and
   no code shows. These should be *(assumption)* or open questions.
5. **Buildability.** Could an agent pick up a single requirement and know
   which part it belongs to, which rules apply, how it should behave and
   look, and how to verify it? Name the first place it would get stuck.

6. **Readiness.** Using the readiness checklists below (they ship with
   this skill, so no other skill is needed), for every doc that
   `project.md` does not list under `skip:` (a skipped doc has no
   readiness to check): every **core** item is
   answered, or written as an *(assumption)* with an open question. For a
   doc written at thorough depth, every item is answered or waiting on
   someone the human named. Name each item that is not, by doc and item.
7. **Depth.** A doc whose written `depth:` is below the depth `project.md`
   requests needs deepening. Report it; never call it thorough.

Report at most 10 findings, most serious first. A finding is a problem plus
the smallest fix. If there are more, say how many and that they can wait.

## 3. Agent-ready test (thorough)

Run this when any doc is at thorough depth; offer it at quick depth, unless
`project.md` has `checkins: none`: then ask nothing, skip it, and say so in
the report.

Pick up to three must-have requirements from the PRD, the riskiest first
(all of them when the PRD has fewer than three). For each,
give a fresh sub-agent only the `dybs/` folder and the requirement, and ask:

1. Which part of the system does this touch?
2. Which domain rules apply?
3. How should it behave, including when it fails, and how should it look?
4. How will you verify it is done?
5. What did you have to guess?

Every guess is a gap. Report the gaps as findings, each pointing at the doc
and section that should have answered it.

**Fresh** means a new sub-agent started with no part of this conversation,
given only the requirement and the paths under `dybs/`, and told not to read
code. If you cannot start one, answer the questions yourself from `dybs/`
alone and label the result **same-agent check (weaker)**: you already know
the project, so you will miss gaps a fresh reader would hit.

## 4. Check in

Give one brief in the `dybs/README.md` format. List every question waiting
on someone first (a `- **Waiting on <who>**` line in a doc; the validator
reports them as `waiting` per doc): by doc, who, since when, and what to
ask. Ask the human about each one before anything else ("Did Anna answer?
May we keep salaries?") and handle the answer as `interview.md` says under
**Questions waiting on someone** (with `checkins: none`, list them only).
Never ask for the acceptance of a doc
with a waiting question: it is completed when the answer comes. Include
every `needs-you` line
that earlier skills wrote to `dybs/log.md` (with `checkins: end` or `none`)
and that has no `resolved` line with the same id yet; log the human's answers
as `resolved` lines.
Under **Needs you**, ask for
acceptance of each doc that is still `draft` and has no waiting question,
and put any contradiction
between two accepted docs first, since it is a safety stop. With
`checkins: none`, do not ask: list what awaits acceptance and stop.

On the human's word, accept the docs they named, and only those: run
`node <validator> . --accept <doc>` when the validator is installed (it sets
`status`, `accepted` and `accepted-hash`, and refuses a doc that does not
validate), otherwise set `status: accepted` and `accepted: YYYY-MM-DD` by
hand and say plainly that the acceptance is **not verified**: without the
validator there is no fingerprint, so a later change cannot be detected.
Running `--accept` once the validator is installed records it.

When every doc is accepted at the requested depth, end with: Getting Started
is complete; the next phase (ideas) is not built yet.

## Readiness checklists (for every doc)

### ux for an API, library or CLI

When the product has no screens, `ux.md` covers **developer experience**
and every checklist item is read that way: tasks are developer journeys
(install, first call, the most common job); states are responses, error
messages, exit codes and timeouts; destructive actions are calls that delete
or overwrite; the accessibility target is about docs, error text and
terminal output (meaning never in colour alone, a machine-readable mode).
An item with no developer equivalent (first-run screens, for example) is
settled as not applicable, with the reason "no screens". The sections
stay the same.

<!-- checklists:start (generated by scripts/sync-rules.mjs, do not edit) -->

### map

*core*
- [ ] The long-term goal in one sentence
- [ ] The primary user, and the people around them who matter
- [ ] The journey as it happens today, with where it hurts
- [ ] At least three questions that could sink the idea
- [ ] One target in the journey, chosen by the human, with the reason

*thorough*
- [ ] What the user does today instead, and why that is not good enough, with evidence
- [ ] Every stakeholder: who pays, who approves, who is affected
- [ ] Every step of the journey marked as fact or assumption
- [ ] Which question is the riskiest, and what answer would stop the project
- [ ] Existing research read and cited, or the decision to do none
- [ ] Concerns from the concern scan (privacy, money, compliance, safety) placed on the journey

### sketch

*core*
- [ ] At least two research finds, each with a link, or the reason there are none
- [ ] At least two concepts that differ in kind, not only in features
- [ ] Each concept's experience through the target moment, step by step
- [ ] Each concept's benefits, limits and assumptions

*thorough*
- [ ] Three or four concepts, including the smallest one that could work
- [ ] Research outside the obvious competitors (another field, an analogue process)
- [ ] For each concept, what it would take to build, roughly
- [ ] The human's own ideas included and written up like the others

### decide

*core*
- [ ] The chosen direction, in the human's words, with the reason
- [ ] Every rejected concept, with why
- [ ] A storyboard of 6 to 12 frames through the target moment
- [ ] The assumptions the prototype must test, riskiest first
- [ ] The prototype scope: in, and left out on purpose

*thorough*
- [ ] What result in testing would change the decision
- [ ] Each question from the map: answered, or carried into the prototype
- [ ] Risks of the chosen direction, each with an owner
- [ ] Legal or compliance points checked, or marked not applicable with the reason

### prd

*core*
- [ ] The problem in the user's words, and what they do today instead
- [ ] The primary user: one concrete person or role, not a market
- [ ] 3 to 5 goals, each one you could check afterwards
- [ ] Every must-have requirement, each testable by observing behaviour
- [ ] How each goal will be observed (a number, or who you will ask)
- [ ] What it must never do (data, money, privacy, trust)

*thorough*
- [ ] Every user group, and what each is trying to get done
- [ ] At least one journey told with a named person, start to finish,
      including where it goes wrong
- [ ] Should-haves, ranked
- [ ] Counter-metrics: what must not get worse while the goals improve
- [ ] Each concern from the concern scan has requirements, or is marked not
      applicable with a reason
- [ ] Platforms and form factor (web, mobile, desktop, API, hardware)
- [ ] The riskiest assumptions, each with how it will be tested
- [ ] Every open question has an owner

### scope

*core*
- [ ] Every PRD requirement placed exactly once: In, Out or Later
- [ ] Hard constraints: date, budget, team size, fixed platforms or systems
- [ ] What people will assume is included but is not

*thorough*
- [ ] The first usable version: the smallest In set someone could use for real
- [ ] A trigger for every Later item (what would bring it in)
- [ ] Dependencies on other people, teams or services, and what happens if
      they slip
- [ ] Existing behaviour not in the PRD, each kept or marked for removal
- [ ] Compliance or legal limits, or "none" with a reason

### domain

*core*
- [ ] Every business term in the PRD and scope defined, or rejected as a
      synonym of another
- [ ] Every naming conflict resolved, with one winning term
- [ ] The rules the code must enforce: limits, permissions, what must never
      happen

*thorough*
- [ ] For each main concept: its states and the allowed moves between them
- [ ] Every rule tested against at least one edge-case scenario the human
      answered
- [ ] Code names mapped to glossary terms where they differ
- [ ] Ambiguous words banned, each with the word to use instead
- [ ] How the main concepts relate (one-to-many, owned by, belongs to)

While interviewing, update the glossary the moment a term is settled; do
not batch it up. The glossary holds meaning only: no implementation detail.

### architecture

*core*
- [ ] Language, runtime and main framework, each with the reason
- [ ] Where data lives
- [ ] The main parts and how they talk to each other
- [ ] How code is verified: test, lint and CI commands
- [ ] Constraints from scope that limit the architecture

*thorough*
- [ ] Every decision that passes the three tests below has a decision record
- [ ] Which part owns which data and rules, and what may call what
- [ ] Authentication and permissions
- [ ] Every external service: what happens when it is slow or down
- [ ] Security and privacy measures for the data the PRD handles
- [ ] Performance and scale targets, with numbers
- [ ] Environments and how code reaches production
- [ ] Logging and monitoring: how you notice something broke
- [ ] Existing project: what must stay compatible, and any migrations

Write a decision record only when all three hold: **hard to reverse**,
**surprising** to a future reader without context, and the result of a
**real trade-off** between alternatives.

Every record you write is `status: proposed`, also when the decision was
already made and you only found it in the code or the docs. Only the human's
word makes it `accepted`.

### ux

*core*
- [ ] The tasks that must feel effortless: the PRD's must-haves (all of
      them when there are fewer than three, at most 5), each as steps from
      intent to done
- [ ] For each of those, the main way it fails and what the user can do next
- [ ] Rules for loading, empty, error and success states
- [ ] Accessibility target (for example WCAG 2.2 AA)

*thorough*
- [ ] 3 to 5 principles, each with the trade-off it makes, confirmed
- [ ] Every must-have flow, including recovery from failure
- [ ] Destructive actions: confirm, undo, or both
- [ ] Notifications and reminders: when, how often, and how to turn off
- [ ] First run: what a new user sees before there is any data
- [ ] Users in hard situations (keyboard only, screen reader, small screen,
      poor connection, in a hurry) and the rules that follow
- [ ] Voice for user-facing text, using glossary terms
- [ ] Products whose behaviour this should feel like, and why

### ui

*core*
- [ ] An existing style guide, design file or brand book, and whether it is the source of truth
- [ ] Three words for how it should feel
- [ ] Light, dark, or both
- [ ] Colour roles (surface, text, accent, danger...) with values or a source
- [ ] Where tokens live (a file in the code, or this doc)
- [ ] Component library, or the decision to build your own

*thorough*
- [ ] Full type, spacing, radius and shadow scales
- [ ] Every component in use or planned, with when to use it
- [ ] States for interactive elements: hover, focus, disabled, error, loading
- [ ] Icon set and illustration style
- [ ] Breakpoints and how layouts adapt
- [ ] Brand assets: logo, colours, fonts, and who owns them
- [ ] Existing project: one-off values to retire
- [ ] Interfaces the human admires, and what specifically about them

### working

*core*
- [ ] Which test levels are wanted (unit, integration, end-to-end) and the commands that run them
- [ ] The behaviour that never ships without a test
- [ ] Whether the code lives on GitHub, and where issues are written down
- [ ] Whether the `gh` CLI is installed and signed in, when GitHub is used
- [ ] Pull requests: one per task, or none; who opens one; who merges
- [ ] Which agents do the work, and what may run with nobody watching
- [ ] A runtime such as Herdr: yes or no, and what for

*thorough*
- [ ] What CI must show before a merge, and who may waive a failed gate
- [ ] A coverage bar, or the reason there is none
- [ ] Test data, environments and secrets: what an agent may and may not touch
- [ ] What happens to a test that fails now and then
- [ ] Branch names, commit style, and whether history is rewritten
- [ ] Protected branches, required reviews, and labels or milestones on issues
- [ ] Model preference and a spending cap per task
- [ ] How the human hears that a task is waiting for them

<!-- checklists:end -->

## Doc contract (for checking by hand)

<!-- contract:start (generated by scripts/sync-rules.mjs, do not edit) -->
| Doc | File | Required `##` sections | Word cap (quick / thorough) |
|---|---|---|---|
| `project` | `dybs/project.md` | Why, Who, Now | 250 / 350 |
| `map` | `dybs/discovery/map.md` | Goal, Users, Journey, Questions, Target | 700 / 1400 |
| `sketch` | `dybs/discovery/sketch.md` | Research, Concepts | 900 / 1800 |
| `decide` | `dybs/discovery/decide.md` | Decision, Rejected, Storyboard, To validate, Prototype scope | 700 / 1400 |
| `prd` | `dybs/context/prd.md` | Problem, Users, Goals, Requirements, Success measures, Open questions | 900 / 1800 |
| `scope` | `dybs/context/scope.md` | In, Out, Later, Constraints | 450 / 800 |
| `domain` | `dybs/context/domain.md` | Glossary, Rules | 700 / 1500 |
| `architecture` | `dybs/context/architecture.md` | Shape, Decisions, Boundaries, Quality bars | 900 / 1800 |
| `ux` | `dybs/context/ux.md` | Principles, Key flows, Behaviour rules, Accessibility | 700 / 1400 |
| `ui` | `dybs/context/ui.md` | Tone, Tokens, Components, Do and don't | 700 / 1400 |
| `working` | `dybs/context/working.md` | Testing, Source control, Pull requests, Agents and runtime | 450 / 900 |
<!-- contract:end -->

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
15. A question the human sent to someone else is written in the doc's open questions as one list item, exactly `- **Waiting on <who>** (since YYYY-MM-DD): <question> Ask: <what to ask>`, with a real date; any other line that starts `**Waiting on` is an error. A doc with such a line is not accepted: it stays a draft until the question is answered and the line removed. The agent's own *(assumption)* items do not block acceptance.
<!-- rules:end -->

---
name: dybs-check
description: Final Getting Started step in the Dybs method. Validates every context doc, then reads them together looking for contradictions, gaps and unsupported claims, and gives the human one check-in brief to accept the context as the base for ideas and work. Use when the user says "dybs check", "is the context ready", "review the getting started docs", or dybs-start routes here.
---

# dybs-check

Lead persona: **Bas** (the skeptic). Follow `dybs/README.md`. If `dybs/` is
missing, run `dybs-start` first.

**Reads:** everything in `dybs/`. **Writes:** nothing, unless the human asks
for fixes. Your output is the check-in brief.

## 1. Mechanical check

Validate every doc (see *If something is not installed* below for how).
Every error is listed first in the brief. Missing docs
that are not under `skip:` are errors here, even though the validator treats
them as a next step.

## 2. Read across

Read the docs as one body and check these, citing file and section for
every finding:

1. **Traceability.** Every PRD requirement is placed exactly once in scope
   (In, Out or Later). Every goal has a success measure.
2. **Language.** Terms used in prd, scope, architecture, ux and ui match the
   glossary. Flag synonyms the glossary forbids or never defines.
3. **Contradictions.** Scope constraints versus architecture choices; UX
   rules versus UI components; domain rules versus requirements.
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
   doc written at thorough depth, every item is answered or parked by the
   human with a reason. Name each item that is not, by doc and item.
7. **Depth.** A doc whose written `depth:` is below the depth `project.md`
   requests needs deepening. Report it; never call it thorough.

Report at most 10 findings, most serious first. A finding is a problem plus
the smallest fix. If there are more, say how many and that they can wait.

## 3. Agent-ready test (thorough)

Run this when any doc is at thorough depth; offer it at quick depth.

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

Give one brief in the `dybs/README.md` format. Include every `needs-you` line
that earlier skills wrote to `dybs/log.md` (with `checkins: end` or `none`)
and that has no `resolved` line with the same id yet; log the human's answers
as `resolved` lines.
Under **Needs you**, ask for
acceptance of each doc that is still `draft`, and put any contradiction
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
parked with the reason "no screens". The sections stay the same.

<!-- checklists:start (generated by scripts/sync-rules.mjs, do not edit) -->

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

<!-- checklists:end -->

## Doc contract (for checking by hand)

<!-- contract:start (generated by scripts/sync-rules.mjs, do not edit) -->
| Doc | File | Required `##` sections | Word cap (quick / thorough) |
|---|---|---|---|
| `project` | `dybs/project.md` | Why, Who, Now | 250 / 350 |
| `prd` | `dybs/context/prd.md` | Problem, Users, Goals, Requirements, Success measures, Open questions | 900 / 1800 |
| `scope` | `dybs/context/scope.md` | In, Out, Later, Constraints | 450 / 800 |
| `domain` | `dybs/context/domain.md` | Glossary, Rules | 700 / 1500 |
| `architecture` | `dybs/context/architecture.md` | Shape, Decisions, Boundaries, Quality bars | 900 / 1800 |
| `ux` | `dybs/context/ux.md` | Principles, Key flows, Behaviour rules, Accessibility | 700 / 1400 |
| `ui` | `dybs/context/ui.md` | Tone, Tokens, Components, Do and don't | 700 / 1400 |
<!-- contract:end -->

## If something is not installed

These skills install one by one (`npx skills add Dybs-it/skills --skill <name>`),
so do not assume the others are present.

- **No `dybs/` folder, or no `dybs/project.md`:** the project is not set up;
  stop and suggest `dybs-start`. If that skill is not
  installed, the human can add it with
  `npx skills add Dybs-it/skills --skill dybs-start`.
- **Validating:** if `dybs-start/scripts/dybs-validate.mjs` exists in the
  same skills folder as this skill and Node is available, run it from the
  project root (`node <path> .`, plus `--doc <name>` for one doc). Otherwise
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
8. The doc is under the word cap for the depth it was written at (its own `depth`; quick when it has none), not counting HTML comments and code blocks.
9. An accepted doc is not changed, neither its content nor its frontmatter settings (anything but `status`, `updated`, `accepted` and `accepted-hash`), not even for a typo. Any change sets `status: draft` and removes `accepted` and `accepted-hash`, and the human accepts again. (`accepted-hash` is written by the validator's `--accept` and lets it detect a change. Checking by hand cannot recompute it: report such a doc as accepted but not verified, and a doc accepted without `accepted-hash` the same way.)
10. In project.md, `quick:`, `thorough:` and `skip:` name only known docs (prd, scope, domain, architecture, ux, ui), no doc is both `quick` and `thorough`, and `skip:` keeps what a remaining doc needs (scope, domain, architecture and ux need prd; ui needs ux).
11. In project.md, `checkins`, when present, is `each-doc`, `end` or `none`. With `none`, every doc that is not skipped is quick (no `depth: thorough` that applies, nothing under `thorough:`): thorough needs answers.
12. No raw HTML blocks (a line outside code that starts with an HTML tag such as `<pre>` or `<div>`, or with `<?`, `<!` or `<![CDATA[`): they change what renders in ways a reader of the source cannot see. HTML comments are fine.
13. No `{{...}}`, TODO or TBD outside HTML comments. In a draft this is a warning; in an accepted doc it is an error.
<!-- rules:end -->

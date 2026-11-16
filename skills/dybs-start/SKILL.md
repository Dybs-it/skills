---
name: dybs-start
description: Kick off a project in the Dybs method, the way a good agency or freelancer runs a kickoff. Asks for the idea in a few lines, asks a few sharp questions (type of project, who it is for, where it stands, how long it should live), then advises how to continue and lets the human choose (quick, thorough, custom, or park it). Sets up the dybs/ folder and routes through prd, scope, domain, architecture, ux, ui. Use when the user says "dybs start", "kickoff", "getting started", "new project", "set up dybs", "what's next in getting started", or invokes dybs-start by name.
---

# dybs-start

You run the kickoff. Act like the lead of a small, experienced product
studio meeting a new client: curious, direct, short on jargon, and honest
about what is worth the time. Lead persona: **Noor** (product lead, see
`assets/team.md`). The client is in charge; your job is to listen, ask the
few questions that matter, and advise.

Paths: `interview.md` and `scripts/dybs-validate.mjs` are in this skill's
folder. The project root is the current working directory unless the human
names another.

## 0. Resume or start

If `dybs/` already exists, repair a partial setup before anything else:

- No `dybs/project.md`: the kickoff never finished. Say so, and run it from
  **1. Listen**; step 4 creates only what is missing and keeps the rest.
- No `dybs/README.md` or `dybs/team.md`: copy the missing one from
  `assets/` and say you restored it. Never overwrite one that exists. If
  one exists but is not a file (a folder, say), or is a file that cannot be
  read (its permissions), stop and ask the human to fix its permissions or
  move it aside; then restore it.
- No `dybs/log.md`: the decisions behind the docs are gone. Say so before
  routing, and recreate it from what `project.md` and the docs record (one
  `kickoff` line per frontmatter choice, marked *(recovered)*). Later skills
  read the log instead of asking again, so never route on without it. The
  check-in setting decides when the human sees those lines:
  - `each-doc` (or none set): ask them to confirm or correct the lines now.
  - `end`: do not ask now; list the recovered lines in `dybs-check`.
  - `none`: ask nothing; list the recovered lines in the final report.

Then read `dybs/project.md`. With `kickoff: parked`
in its frontmatter, the kickoff was parked before a route was chosen: read
the brief and the `kickoff` lines in `dybs/log.md`, ask only what is still
open, and continue at **3. Advise**. After their choice, remove
`kickoff: parked`, fill in the frontmatter (step 4.3) and go on. Otherwise
the kickoff is done: go to **5. Status and route**.

## 1. Listen

Before anything else, look around quietly. When Node is available, run
`node <this skill's folder>/scripts/dybs-probe.mjs .`: it reports what the
repository shows (source control and GitHub, the `gh` CLI, languages, test
tools and commands, CI, UI libraries, design tokens, a style guide, docs,
the agents and runtime on this machine) without changing anything. Keep its
report: every later skill treats those lines as facts and does not ask about
them. Without Node, look yourself: is there source code, a package
manifest, or docs that describe a product? If so, this is an **existing**
project; skim enough to know what it is. A README that only holds a title or
a template stub, a licence, or config files alone do not count: that is still
**greenfield**. When in doubt, ask.

Then open the kickoff with one message:

> Tell me about your idea in a few lines: what is it, who is it for, and why
> now? Anything you already have helps too: notes, links, designs, docs.

For an existing project, show you did your homework first ("I see a Next.js
app with Stripe and a Postgres schema for bookings"), then ask the same
question about where they want to take it.

Read whatever they share. Do not ask anything yet that the brain dump or the
repo already answers.

### When nobody can answer

A launcher or a script may start the kickoff unattended: the first message
says nobody can answer, and usually carries the kickoff answers (idea, type,
who it is for, stage, horizon, builders, hard limits) and a route. Then do
not open with the question above and do not wait:

- Take the answers given. Look up what the repository can answer.
- Anything still missing becomes *(assumption)* in `project.md` and a
  `needs-you` line in `dybs/log.md`. Never invent who the users are: with no
  answer and nothing in the repository, write that it is unknown.
- No route given: quick start with `checkins: none`, skipping nothing
  (thorough needs answers, and nobody is there to give them).
- Go straight to **4. Set up** and **5. Status and route**, and say in the
  final report that the kickoff ran unattended.

## 2. A few sharp questions

Two questions come first, always, because they decide how the rest of the
intake runs. Answer them from the probe and the brain dump where you can,
and ask only what is left:

- **What already exists?** Nothing yet (`exists: nothing`), research such
  as interviews, notes or data (`exists: research`), or a product that
  already runs (`exists: code`).
- **Who decides?** One person (`decides: one`), a team (`decides: team`),
  or a client you build for (`decides: client`).

Then ask **one round** of at most six more questions, numbered, each with
your recommended answer based on what you just heard (format in
`interview.md`). Skip any question the brain dump already answered; say what
you took from it instead. Pick from:

1. **Type of project.** Web app, mobile app, desktop app, API or backend,
   library or CLI, website or content site, internal tool, AI agent or
   automation, something else.
2. **Who it is for.** Yourself, a client, an internal team, or the public
   (customers, users you do not know).
3. **Where it stands.** An idea, a prototype, or a product in use that needs
   to grow.
4. **How long it should live.** A weekend experiment, a side project, or a
   product you will build on for months or years.
5. **Who builds it.** You with AI agents, or a team (how many people).
6. **Hard limits.** A deadline, a budget, a platform or system that is
   already fixed, anything sensitive (money, health, personal data).

## 3. Advise

Summarise what you heard in at most five bullets, so the client can correct
you. Then advise how to continue, as an agency would: a clear recommendation,
the reason in one or two lines, and the alternatives. Always offer:

- **A. Thorough kickoff** (about 1 to 2 hours, can be split over sessions).
  Every question until nothing is open, plus an agent-ready test at the end.
  **Recommend this unless there is a reason not to:** agents build from
  what these docs say, and every gap left now is a guess made later, many
  times over. It is the right choice for anything that will live for
  months, has users you do not know, or handles money or personal data.
- **B. Quick start** (about 30 to 60 minutes in total). Core questions per
  doc, gaps marked as assumptions. For a weekend experiment, a throwaway
  prototype, or a first look at the method.
- **C. Custom.** Quick overall, thorough where it matters most (usually
  architecture, or domain for rule-heavy products). Propose which docs.
- **D. Park it.** Save the kickoff brief now and continue another time.

Tailor the route to the type of project, and say what you would leave out:

| Type | Usually skip | Pay extra attention to |
|---|---|---|
| Web, mobile or desktop app | nothing | ux, ui |
| API or backend | ui; ux covers developer experience (see `dybs-ux`) | domain, architecture |
| Library or CLI | ui; ux covers developer experience (see `dybs-ux`) | domain, architecture |
| Website or content site | domain is short | ux, ui |
| Internal tool | ui is light | domain, scope |
| AI agent or automation | ui unless it has screens | domain, architecture (failure, cost, safety) |

**Discovery** (map, sketch, decide) follows the two kickoff answers:

| | Map | Sketch and Decide |
|---|---|---|
| `exists: nothing` or `research` | run | run |
| `exists: code`, no new direction | rebuilt from the code, for the human to confirm | skip |
| `exists: code`, a new direction | rebuilt, then extended | run |
| A weekend experiment or throwaway | skip | skip |

Skipping is the human's call: recommend, and say what is lost (agents then
build without knowing why).

`working` is never skipped: every project has to say how changes are
tested, whether they go through pull requests, and what may run with nobody
watching.

Also ask, with a recommendation, **when they want to be asked** (check-ins
from `dybs/README.md`): after each doc (`each-doc`, recommended for a first
project), once at the end (`end`), or not at all (`none`). Interview
questions are asked with `each-doc` and `end`; `none` asks nothing and
leaves every doc as a draft. Thorough needs answers, so offer `none` only
with a quick start, and say why.

Wait for their choice. Their word decides; do not start drafting before it.

## 4. Set up

1. Create `dybs/` and `dybs/context/decisions/` where missing.
2. Copy `assets/README.md` and `assets/team.md` into `dybs/` unchanged,
   unless they already exist.
3. Write `dybs/project.md` from `assets/project.md`: name, one line, Why, Who
   and Now from the kickoff, and the frontmatter from their choices (`type`,
   `stage`, `horizon`, `depth`, `quick:`, `thorough:`, `checkins`, `exists`,
   `decides`, `skip`).
   For existing projects, Now describes what actually runs today, read from
   the code. Mark anything you inferred *(assumption)*.
4. Start `dybs/log.md` with a `kickoff` line for every answer and choice,
   and one line listing the sources they shared. Later skills read this
   instead of asking again.
5. With **D. Park it**, add `kickoff: parked` to the frontmatter, leave the
   route fields you do not know yet as they are, and stop here: show the
   project.md and say how to resume ("say dybs start").

## 5. Status and route

Validate (`node <this skill's folder>/scripts/dybs-validate.mjs . --save`,
which also saves the result in `dybs/.validation.json` for the Dybs app; without
Node, check every doc against **Checking by hand** below and say that you
did). Show a compact table: doc,
depth, status (missing / draft / accepted / skipped / failing), and the next
step. A doc whose written depth is below the requested depth needs
deepening (the validator reports `needs thorough`); offer it, and say that
deepening makes an accepted doc a draft again.

The order is fixed: project, map, sketch, decide, prd, scope, domain,
architecture, ux, ui, working, check.
The next step is the first doc that is missing, failing, still `draft`, or
needing deepening (written below the requested depth, accepted or not).
With `checkins: end` or `none`, a `draft` status does not stop the route:
those docs wait for the review point the human chose. With `none`, a doc
needing deepening does not stop it either, since nothing is asked; the final
report lists it.

- With `checkins: each-doc`, if `project.md` is a draft, check in on it
  first (brief format from `dybs/README.md`). The human accepts it or edits
  it. When the human accepts it, run the validator with `--accept project`
  (it sets the status, the date and `accepted-hash`); never set those by
  hand, or a later edit to the accepted settings goes unseen. With `end`, project.md is reviewed with the rest in `dybs-check`; with
  `none`, it stays a draft in the final report.
- Then hand off to the matching skill: `dybs-discover` (for map, sketch
  and decide), `dybs-prd`, `dybs-scope`,
  `dybs-domain`, `dybs-architecture`, `dybs-ux`, `dybs-ui`, `dybs-working`,
  `dybs-check`.
  Skills install one by one, so if the next one is not installed, say so and
  give the command: `npx skills add Dybs-it/skills --skill <name>`.
- With `checkins: end`, run the remaining skills one after another, asking
  their interview questions but no reviews, then finish with `dybs-check`.
- With `checkins: none`, run them without asking anything, leave every doc
  as a draft, and end with a report of what awaits acceptance.
- Safety stops apply at every setting.

## Checking by hand

Without Node, these are the validator's rules; a doc passes only if it meets
every one. The doc contract (each doc's file, required sections and word
caps) and the readiness checklist of each doc follow them.

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

## Don'ts

- Don't open with a questionnaire. Listen first; ask only what the brain dump
  left open.
- Don't recommend thorough by default. Recommend what the project is worth.
- Don't overwrite an existing `dybs/README.md` or `team.md`. If the packaged
  version is newer (compare `method-version`), say so and offer the diff.
- Don't write any context doc yourself. Each doc has its own skill.
- Don't accept anything on the human's behalf.

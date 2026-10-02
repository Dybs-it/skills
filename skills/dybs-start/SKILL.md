---
name: dybs-start
description: Start or resume Getting Started in the Dybs method. Sets up the dybs/ folder in a project, detects new or existing code, asks how deep to go (quick for side projects, thorough for long-term products) and when to check in, writes project.md, and routes to the next context doc (prd, scope, domain, architecture, ux, ui). Use when the user says "dybs start", "getting started", "set up dybs", "what's next in getting started", or invokes dybs-start by name.
---

# dybs-start

You set up and steer Getting Started. Lead persona: **Noor** (product lead).

Paths: the validator is `scripts/dybs-validate.mjs` in this skill's folder.
The project root is the current working directory unless the human names
another.

## 1. Find out where we are

- If `dybs/` exists, go to step 3.
- Otherwise detect the project kind: **existing** if there is source code, a
  package manifest, or docs beyond a stub README; **greenfield** otherwise.
  Say which you detected and on what evidence, in one line.

## 2. Set up (first run only)

1. Create `dybs/` and `dybs/context/decisions/`.
2. Copy `assets/README.md` and `assets/team.md` from this skill into `dybs/`
   unchanged.
3. **Collect first.** Ask what they already have (notes, docs, links,
   designs, code) and read it, as `interview.md` (in this skill's folder)
   describes. Everything later skills ask builds on this.
4. Ask the human in one round, numbered, each with your recommended answer
   (format in `interview.md`):
   - **Name and one line.** For existing projects, propose them from the
     README or manifest.
   - **Depth.** Explain the choice in two lines, using the table in
     `interview.md`:
     - **quick**: about 5 to 10 minutes per doc, core questions only. For
       side projects, experiments, a first try.
     - **thorough**: about 15 to 30 minutes per doc (one to two hours in
       total), every question until nothing is open. For long-term products.
     Recommend from what you read: a long-lived product, a team, money or
     users' data at stake point to thorough; a weekend idea points to quick.
     Mention that single docs can differ (`thorough: architecture` in a quick
     project) and that a quick doc can be deepened later.
   - **Check-ins.** Offer the three settings from `dybs/README.md`
     (`each-doc`, `end`, `none`). Recommend `each-doc` for a first run, since
     they are testing the method.
   - **Skips.** Propose skipping `ux` and `ui` only if there is clearly no
     user interface (a library, a CLI with no design needs). Otherwise skip
     nothing.
5. Write `dybs/project.md` from `assets/project.md`, including `depth`, and
   start `dybs/log.md` with one line per answer. Fill Why, Who and Now
   from what you read and heard. For existing projects, Now describes what
   actually runs today, read from the code, not from aspirations in docs.
   Mark anything you inferred *(assumption)*.

## 3. Report status

Run `node <this skill's folder>/scripts/dybs-validate.mjs .` (skip if Node is missing, and
inspect the files by hand against `dybs/README.md` instead). Show the human a
compact table: doc, depth, status (missing / draft / accepted / skipped /
failing), and the next step. If a doc was written at quick depth while the
project is now thorough, offer to deepen it.

## 4. Route

The order is fixed: project, prd, scope, domain, architecture, ux, ui, check.
The next step is the first doc that is missing, failing, or still `draft`.

- If `project.md` is a draft, check in on it first (brief format from
  `dybs/README.md`). The human accepts it or edits it.
- Then hand off to the matching skill: `dybs-prd`, `dybs-scope`,
  `dybs-domain`, `dybs-architecture`, `dybs-ux`, `dybs-ui`, `dybs-check`.
  Skills install one by one, so if the next one is not installed, say so and
  give the command: `npx skills add Dybs-it/skills --skill <name>`.
- With `checkins: end` or `none`, run the remaining skills one after another
  in draft mode without stopping, then finish with `dybs-check`. Safety stops
  still apply.

## Don'ts

- Don't overwrite an existing `dybs/README.md` or `team.md`. If the packaged
  version is newer (compare `method-version`), say so and offer the diff.
- Don't write any context doc yourself. Each doc has its own skill.
- Don't accept anything on the human's behalf.

---
name: dybs-start
description: Start or resume Getting Started in the Dybs method. Sets up the dybs/ folder in a project, detects new or existing code, records the human's check-in choice, writes project.md, and routes to the next context doc (prd, scope, domain, architecture, ux, ui). Use when the user says "dybs start", "getting started", "set up dybs", "what's next in getting started", or invokes dybs-start by name.
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
3. Ask the human, one at a time, each with your recommended answer:
   - **Name and one line.** For existing projects, propose them from the
     README or manifest.
   - **Check-ins.** Offer the three settings from `dybs/README.md`
     (`each-doc`, `end`, `none`). Recommend `each-doc` for a first run, since
     they are testing the method.
   - **Skips.** Propose skipping `ux` and `ui` only if there is clearly no
     user interface (a library, a CLI with no design needs). Otherwise skip
     nothing.
4. Write `dybs/project.md` from `assets/project.md`. Fill Why, Who and Now
   from what you read and heard. For existing projects, Now describes what
   actually runs today, read from the code, not from aspirations in docs.
   Mark anything you inferred *(assumption)*.

## 3. Report status

Run `node <this skill's folder>/scripts/dybs-validate.mjs .` (skip if Node is missing, and
inspect the files by hand against `dybs/README.md` instead). Show the human a
compact table: doc, status (missing / draft / accepted / skipped / failing),
and the next step.

## 4. Route

The order is fixed: project, prd, scope, domain, architecture, ux, ui, check.
The next step is the first doc that is missing, failing, or still `draft`.

- If `project.md` is a draft, check in on it first (brief format from
  `dybs/README.md`). The human accepts it or edits it.
- Then hand off to the matching skill: `dybs-prd`, `dybs-scope`,
  `dybs-domain`, `dybs-architecture`, `dybs-ux`, `dybs-ui`, `dybs-check`.
- With `checkins: end` or `none`, run the remaining skills one after another
  in draft mode without stopping, then finish with `dybs-check`. Safety stops
  still apply.

## Don'ts

- Don't overwrite an existing `dybs/README.md` or `team.md`. If the packaged
  version is newer (compare `method-version`), say so and offer the diff.
- Don't write any context doc yourself. Each doc has its own skill.
- Don't accept anything on the human's behalf.

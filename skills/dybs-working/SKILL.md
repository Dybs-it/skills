---
name: dybs-working
description: Write or revise dybs/context/working.md, how the work is done on this project - what must be tested and how, whether the code and the issues live on GitHub, whether every task gets a pull request and who merges, and which agents and runtime do the work. The work loop and a launcher read it. Looks the facts up first (the repository, the gh CLI, test frameworks, CI) and asks only for the decisions. Use when the user says "dybs working", "how we work", "testing policy", "PR policy", "set up GitHub for dybs", or dybs-start routes here.
---

# dybs-working

Lead persona: **Tess** (architect), with **Bas** (the skeptic) on what may
run unattended. Run the interview in `interview.md` (in this skill's folder) at the depth
`dybs/project.md` sets for this doc. Follow the rules in `dybs/README.md`. If `project.md` lists `working`
under `skip:`, say so and stop.

**Reads:** `project.md`, `discovery/map.md`, `discovery/sketch.md`, `discovery/decide.md` (when
discovery ran), `context/prd.md`, `context/scope.md`,
`context/domain.md`, `context/architecture.md`, `context/ux.md`,
`context/ui.md`, `log.md` (every earlier doc that is not skipped).
**Writes:** `dybs/context/working.md` from `template.md` (cap: 450 words quick,
900 thorough), and appends each round's answers and any **Needs you** items
to `dybs/log.md`.

This doc holds decisions about the way of working, not about the product.
The work loop reads it: where a task comes from, which tests a build must
write, whether a change ends in a pull request, and what may run with nobody
watching.

## Read first

Look the facts up before asking anything. From the project root, when Node
is available:

```
node '<skills>/dybs-start/scripts/dybs-probe.mjs' .
```

(`<skills>` is the folder that holds this skill.) It reports, without
changing anything: whether this is a git repository and where its remote
points, whether the `gh` CLI is installed and signed in, which agents and
runtimes are on this machine, the test frameworks, test and lint commands,
CI workflows, and any style guide or design tokens. Without the script, find
the same by hand: `git remote -v`, the package manifests, the CI folder.

Everything the probe answers is a fact: write it down with where it came
from, and do not ask about it. Ask about what it cannot know: what the human
wants.

## Readiness checklist

**core**
- [ ] Which test levels are wanted (unit, integration, end-to-end) and the commands that run them
- [ ] The behaviour that never ships without a test
- [ ] Whether the code lives on GitHub, and where issues are written down
- [ ] Whether the `gh` CLI is installed and signed in, when GitHub is used
- [ ] Pull requests: one per task, or none; who opens one; who merges
- [ ] Which agents do the work, and what may run with nobody watching
- [ ] A runtime such as Herdr: yes or no, and what for

**thorough**
- [ ] What CI must show before a merge, and who may waive a failed gate
- [ ] A coverage bar, or the reason there is none
- [ ] Test data, environments and secrets: what an agent may and may not touch
- [ ] What happens to a test that fails now and then
- [ ] Branch names, commit style, and whether history is rewritten
- [ ] Protected branches, required reviews, and labels or milestones on issues
- [ ] Model preference and a spending cap per task
- [ ] How the human hears that a task is waiting for them

## Write

- **Testing:** the levels wanted and the ones deliberately left out, the
  commands, and the behaviour that always needs a test. When
  `architecture.md` already lists the commands, name the same ones; a
  different command in each doc is a contradiction `dybs-check` reports. Name what exists
  (the framework, the CI job); do not add a framework on paper.
- **Source control:** host, repository and default branch; where issues
  live and how a task refers to one; branch and commit conventions.
- **Pull requests:** the policy in one line, then who opens and who merges.
  One pull request for several tasks is not offered yet: the work loop
  cannot route it. A human who wants it gets `per-task` and an open
  question.
  An agent opening a pull request is an outward action: write down plainly
  whether the human allows it, and as a draft or not.
- **Agents and runtime:** the agents in use, what may run unattended and
  what never may, the runtime if any, and the budget.

Set the frontmatter to match, because scripts read it and not the prose:
`github: yes|no`, `issues: github|none|<where>`,
`pull-requests: per-task|none`, `runtime: none|herdr`.

**The app may change these four settings** from its settings screen, with
`dybs-validate.mjs . --set working <key>=<value>`. That changes only the
frontmatter, logs the change in `dybs/log.md`, and accepts the doc again
when it was accepted. The frontmatter is then ahead of the prose. On every
run, read the `set to ... in the app's settings` lines in the log first:
those are the human's decisions, so bring the prose in line with the
frontmatter, never the other way round.

**GitHub without `gh`:** when the human wants GitHub for issues or pull
requests and the probe shows no `gh`, or `gh` not signed in, give them the
install command for their system and `gh auth login`. Install nothing and
sign in nowhere yourself: both are theirs to do. Until then, write
`github: yes` and list "install and sign in to gh" under **Needs you**.

**A runtime is optional.** The skills work from the files in `dybs/` with or
without one. Record the human's choice; never make a step depend on it.

## Check in

Validate with `--doc working`. Under **Needs you**, list every choice that
lets an agent act where others can see it (opening a pull request, pushing,
commenting on an issue) and every "may run unattended" you recommended
rather than heard.

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

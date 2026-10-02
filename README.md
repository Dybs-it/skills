# Dybs.it skills

The Dybs method as agent skills: a short, human-accepted project context
that AI coding agents build from. Phase 1 ships **Getting Started**. Ideas,
roadmap and the work loop follow (see [docs/ROADMAP.md](docs/ROADMAP.md)).

## Install

With the [skills](https://skills.sh) package manager (Claude Code, Codex,
Cursor, Gemini CLI, Copilot and more):

```
npx skills add Dybs-it/skills                      # all skills
npx skills add Dybs-it/skills --skill dybs-start   # one skill
```

In Claude Code, as a plugin:

```
/plugin marketplace add Dybs-it/skills
/plugin install dybs@dybs-it
```

While this repo is private, both work for anyone with read access to it on
GitHub (they clone with your git credentials).

## Use

In your agent, say **"dybs start"**.

```
project → prd → scope → domain → architecture → ux → ui → check
```

| Skill | Writes | Lead persona |
|---|---|---|
| `dybs-start` | `dybs/README.md`, `team.md`, `project.md`; routes to the next step | Noor |
| `dybs-prd` | `context/prd.md` | Noor |
| `dybs-scope` | `context/scope.md` | Noor, with Bas |
| `dybs-domain` | `context/domain.md` | Ezra |
| `dybs-architecture` | `context/architecture.md`, `context/decisions/` | Tess |
| `dybs-ux` | `context/ux.md` | Mila |
| `dybs-ui` | `context/ui.md` | Jun |
| `dybs-check` | nothing; one check-in brief across all docs | Bas |

### Quick or thorough

`dybs-start` asks how deep to go, and recommends one:

| | quick | thorough |
|---|---|---|
| For | side projects, experiments, a first try | long-term products |
| Time | about 5 to 10 minutes per doc | about 15 to 30 minutes per doc (1 to 2 hours in total) |
| Interview | core questions, at most two rounds | every question, until nothing is open |
| Gaps | marked *(assumption)* with an open question | answered, or parked by you with a reason |
| Check | consistency across docs | plus an agent-ready test by fresh sub-agents |

Both write the same docs, so agents and tools never care which you chose.
Single docs can differ (`thorough: architecture` in a quick project), and a
quick doc can be deepened later without starting over.

Every interview works the same way (`interview.md` in each skill): it first
collects what you have and looks up facts itself, then asks numbered rounds
of questions, each with a recommended answer you can accept with "yes".
Every decision lands in `dybs/log.md`.

Every skill works on its own. Without `dybs-start` installed, a skill says
which one to add; without the validator, it checks the doc by hand.

## The dybs-skills CLI

For what a package manager can't do. Until it is on npm, run it from GitHub:

```
npx github:Dybs-it/skills validate                # check the project's dybs/ context
npx github:Dybs-it/skills validate --doc prd --json
npx github:Dybs-it/skills update --dry-run        # what a safe update would change
npx github:Dybs-it/skills update                  # update installed Dybs skills
npx github:Dybs-it/skills status                  # where they are installed
```

`update` finds Dybs skills in every `.<agent>/skills/` folder (and your home
folder with `--global`), follows symlinks, and only touches skills that are
already installed. **It never overwrites your edits:** a file is replaced
only when it still matches a version this package shipped. Anything you
changed is reported and left alone; `--force` replaces it and keeps a `.bak`.

`npx skills update` also works, but replaces skill files whole.

## Principles

- **Short beats complete.** Every doc has a word cap, enforced by the validator.
- **Agents draft, humans accept.** Only your explicit word marks a doc accepted.
- **You choose the check-ins:** `each-doc`, `end` or `none`. Agents only
  interrupt outside those for a small, fixed set of safety stops.
- **In your repo, in your control.** Plain Markdown in `dybs/`. No service.

## Develop

```
npm test                 # validator contract, safe update, CLI, skill consistency
npm run record-hashes    # after changing any file under skills/ (tests fail until you do)
claude plugin validate . # plugin and marketplace manifests
```

- `skills/dybs-start/scripts/dybs-validate.mjs` (`DOCS`) is the single home
  for required sections and word caps. Change a template and the contract
  together; the tests fail if they drift.
- `src/update.mjs` owns the safe-update rule. `src/known-hashes.json` is
  append-only: it is how an untouched install of any released version is
  told apart from a user's edit.
- How to field-test the skills on real work: [tests/PROTOCOL.md](tests/PROTOCOL.md).

## Credits

Inspired by the [BMad Method](https://github.com/bmad-code-org/BMAD-METHOD)
(MIT), especially its personas, and by
[Matt Pocock's skills](https://github.com/mattpocock/skills), especially
grilling with recommended answers and a shared domain language. No text is
copied from either. See [NOTICE.md](NOTICE.md).

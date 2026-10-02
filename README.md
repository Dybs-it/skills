# dybs-skills

The Dybs method as agent skills. Version 0.1 covers **Getting Started**: a
short, human-accepted project context that AI coding agents build from.

```
project → prd → scope → domain → architecture → ux → ui → check
```

Everything lands in a `dybs/` folder in your project, as plain Markdown.

## Principles

- **Short beats complete.** Every doc has a word cap, enforced by a validator.
- **Agents draft, humans accept.** Only your explicit word marks a doc accepted.
- **You choose the check-ins.** `each-doc`, `end` or `none`. Agents only
  interrupt outside those for a small, fixed set of safety stops.
- **In your repo, in your control.** No service, no lock-in. Works with any
  agent that can read files.

## Skills

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

## Install

**Claude Code, as a plugin** (from a clone or the GitHub repo):

```
/plugin marketplace add <path-or-owner/repo>
/plugin install dybs@dybs
```

**Any agent, by copying:** copy `skills/*` into the agent's skills folder
(for Claude Code: `.claude/skills/` in the project) and keep `scripts/` two
levels above the skill folders, or tell the agent where the validator is.

## Use

In the project you want to set up, say "dybs start". It detects new or
existing code, asks your check-in preference, and walks the order.

Validate any time:

```
node <dybs-skills>/scripts/dybs-validate.mjs <project-root>
node <dybs-skills>/scripts/dybs-validate.mjs <project-root> --doc prd --json
```

## Develop

```
npm test        # validator contract, templates and fixtures (node --test)
```

The validator (`scripts/dybs-validate.mjs`, `DOCS`) is the single home for
required sections and word caps. Change a template and the contract together;
the tests fail if they drift.

How to try each skill on real work: [tests/PROTOCOL.md](tests/PROTOCOL.md).
What comes after Getting Started: [docs/ROADMAP.md](docs/ROADMAP.md).

## Credits

Inspired by the [BMad Method](https://github.com/bmad-code-org/BMAD-METHOD)
(MIT), especially its personas, and by
[Matt Pocock's skills](https://github.com/mattpocock/skills), especially
grilling with recommended answers and a shared domain language. No text is
copied from either. See [NOTICE.md](NOTICE.md).

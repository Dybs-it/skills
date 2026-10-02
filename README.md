# dybs-skills

The Dybs method as agent skills, installed with one command into the agents
you already use.

```
npx dybs-skills install
```

Phase 1 ships **Getting Started**: a short, human-accepted project context
that AI coding agents build from. Ideas, roadmap and the work loop follow
(see [docs/ROADMAP.md](docs/ROADMAP.md)).

## Install

Run in your project root:

```
npx dybs-skills install                      # detect agents from the project
npx dybs-skills install --tools claude,agents
npx dybs-skills install --dry-run            # show what would change
npx dybs-skills update                       # same as install, after an upgrade
npx dybs-skills status
npx dybs-skills uninstall                    # never touches dybs/
```

| Target | Folder | For |
|---|---|---|
| `claude` | `.claude/skills/` | Claude Code |
| `agents` | `.agents/skills/` | Codex, Gemini CLI, Kimi and other agents that read `.agents/skills` |
| `opencode` | `.opencode/commands/` | OpenCode (each command loads the skill from `.agents/skills/`) |

Without `--tools`, targets are detected from `.claude/`, `CLAUDE.md`,
`.agents/`, `AGENTS.md`, `.codex/`, `.gemini/` and `.opencode/`. If nothing
is found it installs `claude` and `agents`.

**Your edits are safe.** Each target folder gets a `.dybs-skills.json`
manifest with a hash of every installed file. Install, update and uninstall
only change files that still match that hash. A file you edited, or one that
was there before, is reported and left alone; `--force` replaces it and keeps
a `.bak` copy. Other skills in the same folder (BMad, your own) are never
touched.

## Getting Started

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

Validate the context any time:

```
npx dybs-skills validate                 # whole dybs/ folder
npx dybs-skills validate --doc prd --json
```

## Principles

- **Short beats complete.** Every doc has a word cap, enforced by the validator.
- **Agents draft, humans accept.** Only your explicit word marks a doc accepted.
- **You choose the check-ins:** `each-doc`, `end` or `none`. Agents only
  interrupt outside those for a small, fixed set of safety stops.
- **In your repo, in your control.** Plain Markdown in `dybs/`. No service.

## Develop

```
npm test                    # validator contract, installer safety, CLI
npm pack                    # then: npx --package=./dybs-skills-<v>.tgz dybs-skills install
```

- `skills/dybs-start/scripts/dybs-validate.mjs` (`DOCS`) is the single home
  for required sections and word caps. Change a template and the contract
  together; the tests fail if they drift.
- `src/install.mjs` holds the install targets and the edit-safety rule.
- How to field-test the skills on real work: [tests/PROTOCOL.md](tests/PROTOCOL.md).

## Credits

Inspired by the [BMad Method](https://github.com/bmad-code-org/BMAD-METHOD)
(MIT), especially its personas and installer, and by
[Matt Pocock's skills](https://github.com/mattpocock/skills), especially
grilling with recommended answers and a shared domain language. No text is
copied from either. See [NOTICE.md](NOTICE.md).

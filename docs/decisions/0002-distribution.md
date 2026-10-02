---
decision: 0002
status: accepted
date: 2026-10-02
---

# 0002. Install through skills package managers

## Context

v0.1 shipped its own installer (`npx dybs-skills install`) for three agent
folders. Meanwhile `npx skills add <owner/repo>` (skills.sh) installs into
18+ agents and already recognised this repo's layout unchanged, and Claude
Code has a plugin marketplace. A tested run showed skills.sh puts real files
in `.agents/skills/` and symlinks `.claude/skills/<name>` to them, so a
second installer writing both folders would touch the same files twice.

## Decision

- Install through `npx skills add Dybs-it/skills` and the Claude Code plugin
  marketplace. Drop our own install and uninstall.
- Keep a small `dybs-skills` CLI for what they cannot do: `validate`, and an
  `update` that changes a file only when it matches a version we shipped
  (`src/known-hashes.json`, append-only), so user edits survive.
- Every skill works when installed alone.

## Options considered

- **Package managers + small CLI (chosen):** wide reach, discovery, little
  code to maintain. Cost: we depend on third-party tooling for install.
- **Own installer only:** full control, but three agents and no discovery.

## Consequences

- The repo stays private for now; installs need GitHub read access.
- Going public needs a license, then npm publish and a skills.sh listing.
- Every change under `skills/` must be followed by `npm run record-hashes`
  (enforced by a test).

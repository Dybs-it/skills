---
decision: 0001
status: accepted
date: 2026-10-02
---

# 0001. Dybs owns its method; BMad becomes an adapter

## Context

Dybs was built as a cockpit for the BMad Method. In practice:

- BMad feels slow on a growing project, and it produces more documents than
  the human can read.
- BMad changes on its own schedule. Version 6.11 deprecated the
  `bmad-create-story` and `bmad-dev-story` commands the Dybs app launches.
- Dybs's principles (human-centred, generate state rather than documents,
  attention is a resource) are not BMad's priorities, and BMad will not
  adopt Dybs as a platform.
- What made BMad worth choosing was the personas: it felt like having a team.

## Decision

Dybs defines its own small method, shipped as agent skills in this repo, and
keeps the parts of BMad and Matt Pocock's skills that serve it. The Dybs app
will treat this method as native and support BMad projects through a
read-only adapter.

Principles of the method:

1. Short, capped documents in the project's repo, readable by humans first.
2. Personas as lenses (questions and standards), not as process steps.
3. Agents draft and advise; only the human accepts or decides.
4. Automation is welcome between check-ins. **The human chooses when to be
   asked**, per project or idea. A small, fixed set of safety stops is the
   only exception.
5. One file per unit of work; boards and status are derived, never a single
   shared file.

## Options considered

- **Own method, BMad as adapter (chosen):** full control, matches the
  principles, existing BMad users keep working. Cost: two input formats.
- **Own method only:** simplest code, but drops existing BMad users.
- **Stay on BMad with heavy customisation:** no migration, but the same
  platform risk and output volume.

## Consequences

- Getting Started is built and field-tested first; later phases wait on it.
- The Dybs app needs a migration of its phase commands either way (BMad's
  own deprecations), and later a `dybs/` reader.
- Positioning moves from "cockpit for BMad" to "cockpit for human-led AI
  development", which needs updating on the website when the app ships it.

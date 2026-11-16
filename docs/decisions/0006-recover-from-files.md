---
decision: 0006
status: proposed
date: 2026-10-04
---

# 0006. Skills recover from files; a runtime like Herdr stays optional

## Context

A human can close the terminal while a skill is running. The agent dies
with it, and the next session does not know where the work stopped. The
same gap shows in any app that launches agents in a terminal: it has to
guess agent state from terminal output, and quitting the app kills every
agent.

Herdr (herdr.dev) is a terminal multiplexer for coding agents. We read its
source at v0.9.3 (commit `5da0a01`) to see whether it could be the engine
under the skills. Nothing was run against a live Herdr yet. What the code
shows:

- Its server runs detached, so closing a terminal window does not kill the
  agent.
- After a restart it types `claude --resume <id>` or `codex resume <id>`
  into a fresh shell, once a client attaches. The original process is gone.
- Its states are idle, working, blocked and unknown. "Done" means idle and
  not yet looked at. It has no notion of whether a task succeeded.
- Claude Code state comes from reading the screen. Codex adds hooks per
  turn. Its changelog lists repeated misreadings for both.
- A prompt has no acknowledgement or idempotency key.
- It is pre-1.0, a separate daemon, and its CLI refuses a server of
  another build.

A resumed conversation does not know whether its last file write landed,
which step it was on, or whether the human stopped it on purpose. Only
the work files can say.

## Decision

1. **The skills recover from `dybs/` files alone**, with or without any
   runtime. A fresh agent in a fresh terminal must pick up correctly. The
   rules are in the roadmap, phase 4, under "Interruption and resume".
2. **The skills never depend on Herdr** or any other runtime. At most, a
   later skill may report its step to one when one is present, and only
   if a field run shows it helps.
3. **A runtime belongs to the Dybs app.** Herdr is a candidate optional
   backend there (phase 5): it keeps agents alive when a view or the app
   closes, and can replace the app's own guessing of agent state. Work
   state comes from `dybs/`; process state comes from the runtime. The
   mapping between them lives outside the repo.
4. **Runtime completion is never work completion.** An agent going idle,
   exiting or being resumed says nothing about the work item.

## Options considered

- **Recover from files, runtime optional in the app (chosen):** works for
  every agent and install, keeps "no service". Cost: phase 4 skills must
  write their step before acting, and steps must be safe to run twice.
- **Skills depend on Herdr:** prevents the agent dying on a closed window.
  But every install needs a pre-1.0 daemon, Claude state stays a screen
  guess, and resume still cannot tell which step finished.
- **Rely on agent resume only (`--resume`):** no new parts, but the same
  blind spot about finished steps, and no help for other agents.

## Consequences

- Phase 4 gains the "Interruption and resume" rules. They are unproven
  until a field run kills the terminal mid-`dybs-build` and a fresh
  session resumes at the right step without redoing or skipping it.
- Phase 5 gets a Herdr spike on a spare Mac first: agent survives a closed
  window (same PID), state accuracy against a hand log, an xterm.js view
  through `herdr terminal session control`, restart with no duplicate
  agents and no resume of an agent the human quit.
- Herdr's `resume_agents_on_restore` is on by default. If the app adopts
  it, a resumed agent acting on its own must not count as the human's
  consent, and the app should decide whether to keep that default.

---
name: dybs-ux
description: Write or revise dybs/context/ux.md, the experience guidelines for how the product behaves (principles, key flows, behaviour rules for states and errors, accessibility). Use when the user says "dybs ux", "ux guidelines", "how should it behave", or dybs-start routes here. For how the product looks, use dybs-ui.
---

# dybs-ux

Lead persona: **Mila** (experience designer). Follow `dybs/README.md`. If
`dybs/` is missing, run `dybs-start` first. If `project.md` lists `ux` under
`skip:`, say so and stop.

**Reads:** `project.md`, `context/prd.md`, `context/scope.md`,
`context/domain.md`. **Writes:** `dybs/context/ux.md` from `template.md`
(cap: 700 words).

These are guidelines an agent applies while building any screen, not a
screen-by-screen specification.

## Gather

Existing project: walk the main flows in code (routes, views, forms) and
note how it handles loading, empty, error and success states today. The
inconsistencies you find are the most useful input.

Ask, one at a time with recommendations:

1. Which 3 to 5 tasks must feel effortless? (From the PRD's must-haves.)
2. What does the user feel when something goes wrong, and what should they
   be able to do next?
3. Who might be using it in a hard situation (keyboard only, screen reader,
   small screen, poor connection, in a hurry)?
4. Any product whose behaviour the human wants this to feel like, and why?

## Write

- **Principles:** 3 to 5, each with what it means in practice. "Clear" is
  not a principle; "every destructive action can be undone for 10 seconds" is.
- **Key flows:** the must-have tasks, each as numbered steps from intent to
  done, including the main way it fails.
- **Behaviour rules:** how every screen handles loading, empty, error,
  success and confirmation. Write them as rules agents can apply anywhere.
- **Accessibility:** the target level (for example WCAG 2.2 AA) and the
  concrete rules that follow from the users above.
- **Copy** (optional): voice and terms for user-facing text, using the
  domain glossary.

## Check in

Validate with `--doc ux`. Under **Needs you**, list the principles that
trade something away (speed versus safety, for example) so the human
confirms the trade.

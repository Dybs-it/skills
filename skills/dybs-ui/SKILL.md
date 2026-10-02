---
name: dybs-ui
description: Write or revise dybs/context/ui.md, the visual guidelines (tone, design tokens, components, do and don't) that agents apply so every screen looks like the same product. Extracts tokens from existing code when there is any. Use when the user says "dybs ui", "ui guidelines", "design tokens", "visual style", or dybs-start routes here. For behaviour, use dybs-ux.
---

# dybs-ui

Lead persona: **Jun** (visual designer). Follow `dybs/README.md`. If `dybs/` is
missing, run `dybs-start` first. If `project.md` lists `ui` under `skip:`,
say so and stop.

**Reads:** `project.md`, `context/ux.md`, `context/domain.md`.
**Writes:** `dybs/context/ui.md` from `template.md` (cap: 700 words).

## Gather

Existing project: extract before asking. Look for CSS custom properties,
Tailwind or theme config, design-token files, a component library or
`components/` folder, and fonts. Record what is actually used. Values that
appear only once or twice are candidates for removal, not tokens; list them
as an open point.

Greenfield, ask one at a time with recommendations:

1. Three words for how it should feel.
2. Light, dark, or both?
3. Is there a brand (logo, colours, font) or a component library already
   chosen? If not, recommend one that fits the architecture's stack.
4. Any interface the human admires, and what specifically about it?

## Write

- **Tone:** the three words, and what each means visually.
- **Tokens:** colour roles (not raw colours: `surface`, `text`, `accent`,
  `danger`...), type scale, spacing scale, radius, shadow. Give values and
  the source file when they exist in code. Dark mode values where relevant.
- **Components:** the components that exist or should exist, each with when
  to use it. Point to the library or folder rather than describing markup.
- **Do and don't:** short paired rules agents get wrong most often (one-off
  colours, mixed icon sets, new spacing values).

Point to the source of truth instead of copying it when tokens live in code.
This doc says *which* tokens and *when*; the code says *what value*.

## Check in

Validate with `--doc ui`. Under **Needs you**, list one-off values you
propose to retire and any library choice you recommended.

# Working on dybs-skills

- Skills live in `skills/<name>/SKILL.md`, with templates beside them.
  `dybs-start/assets/` holds the files copied into a project's `dybs/`.
- `scripts/dybs-validate.mjs` (`DOCS`, `ORDER`) is the single home for the
  doc contract. Change a template and `DOCS` together. `npm test` must pass.
- Practise what the skills preach: short, plain, no invented facts.
  No em dashes in any text.
- A skill change is only done after a field run (`tests/PROTOCOL.md`) on
  real work, recorded in `tests/runs/`.
- New phases follow `docs/ROADMAP.md`; significant choices get a record in
  `docs/decisions/`.

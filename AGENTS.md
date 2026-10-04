# Working on Dybs-it/skills

- Skills live in `skills/<name>/SKILL.md`, with templates beside them.
  `dybs-start/assets/` holds the files copied into a project's `dybs/`.
- `skills/dybs-start/scripts/dybs-validate.mjs` (`DOCS`, `ORDER`) is the
  single home for the doc contract. Change a template and `DOCS` together.
- Installing is the package manager's job (`npx skills add Dybs-it/skills`,
  Claude plugin marketplace). `bin/dybs-skills.mjs` only validates and
  safely updates; `src/update.mjs` owns the rule that a file the user
  changed is never overwritten or deleted without `--force`.
- Every skill must work when installed alone. Skills other than
  `dybs-start` carry the identical "If something is not installed" section.
- Generated text: the manual validation rules in each skill (from the
  validator's `MANUAL_RULES`) and the readiness checklists in `dybs-check`
  (from each doc skill). After changing either source run
  `npm run sync-rules`.
- `interview.md` is edited in `dybs-start` and copied to every skill.
- After changing anything under `skills/`, run `npm run record-hashes`.
  `src/known-hashes.json` is append-only. `npm test` must pass.
- Practise what the skills preach: short, plain, no invented facts.
  No em dashes in any text.
- A skill change is only done after a field run (`tests/PROTOCOL.md`) on
  real work, recorded in `tests/runs/`.
- New phases follow `docs/ROADMAP.md`; significant choices get a record in
  `docs/decisions/`.

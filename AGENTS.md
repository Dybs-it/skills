# Working on Dybs-it/skills

- Skills live in `skills/<name>/SKILL.md`, with templates beside them.
  `dybs-start/assets/` holds the files copied into a project's `dybs/`.
- `skills/dybs-start/scripts/dybs-validate.mjs` (`DOCS`, `ORDER`) is the
  single home for the doc contract. Change a template and `DOCS` together.
- Facts are looked up, decisions are asked.
  `skills/dybs-start/scripts/dybs-probe.mjs` reports what a repository shows
  (read-only, nothing run but `git` and `gh auth status`). A new question in
  a checklist that a script could answer belongs in the probe instead.
- Installing is the package manager's job (`npx skills add Dybs-it/skills`,
  Claude plugin marketplace). `bin/dybs-skills.mjs` only validates and
  safely updates; `src/update.mjs` owns the rule that a file the user
  changed is never overwritten or deleted without `--force`.
- Every skill must work when installed alone, and every skill except
  `dybs-start` has an "If something is not installed" section: one identical
  text for the Getting Started skills, another identical text for the
  quality skills (each group has different dependencies). Tests enforce both.
- Generated text: the manual validation rules in each skill (from the
  validator's `MANUAL_RULES`) and the readiness checklists in `dybs-check`
  (from each doc skill). After changing either source run
  `npm run sync-rules`.
- `interview.md` is edited in `dybs-start` and copied to every Getting
  Started skill; `quality.md` is edited in `dybs-test-plan` and copied to
  every quality skill (the work-loop skills `dybs-task`, `dybs-build` and
  `dybs-done` are in that group). The groups live in `src/update.mjs`.
- The gate decision is code (`skills/dybs-gate/scripts/dybs-gate.mjs`), not
  agent judgement. Change a rule there, in `quality.md`, and in the tests.
- Which model and effort a step runs on is code too
  (`skills/dybs-task/scripts/dybs-route.mjs`: `ROUTES`, `BOUNDS`), read
  by the skills and by any launcher. Change the table there and in the
  tests; tune it from run logs and `tests/runs/`, not by feel.
- The order of the steps, the lanes and what a task needs next are code in
  the same script (`next`, `taskInfo`, `findings`). A skill never decides
  what runs next; it says what the script says.
- After changing anything under `skills/`, run `npm run record-hashes`.
  `src/known-hashes.json` is append-only. `npm test` must pass.
  CI (`.github/workflows/tests.yml`) runs the tests on Node 20 and 22 and
  fails when generated text or hashes are not committed.
- Practise what the skills preach: short, plain, no invented facts.
  No em dashes in any text.
- A skill change is only done after a field run (`tests/PROTOCOL.md`) on
  real work, recorded in `tests/runs/`.
- New phases follow `docs/ROADMAP.md`; significant choices get a record in
  `docs/decisions/`.
- Every skill has a section in `docs/sources.md`: what it does, what is our
  own, what is adapted from where (a test enforces it). Adapting text from
  another project: check its license first, keep its notice, and update that
  section in the same commit.

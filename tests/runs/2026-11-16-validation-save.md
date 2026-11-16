# 2026-11-16 validate --save (existing docs), read by the Dybs app

A machine run, not the human field run `tests/PROTOCOL.md` asks for. It
covers the one workflow this change adds: the human validates the whole
project with `--save`, and an app reads `dybs/.validation.json` instead of
running the project's scripts (decision 0011). No interview was run, so the
per-step table of the protocol does not apply.

Project: a copy of `tests/fixtures/sample-project` (11 docs, 9 accepted by
hand, `ui` a draft). Reader: the Dybs app's `dybs:overview` reader
(`main/ipc/dybs.js`, Dybs PR 261), run in Node against the copy.

| Step | Did | App showed | Verdict |
|---|---|---|---|
| 1 | nothing saved yet | every doc `unknown`, not verified | right |
| 2 | `--save` | every doc `valid`, verified; 9 accepted | partly, see finding 1 |
| 3 | appended a line to `map.md` | `map` stale, the rest valid; not verified | right |
| 4 | `--save` again | `map` valid again | right |
| 5 | broke `scope.md` (empty draft), `--save` | `scope` invalid, next: scope; exit 1 | right |
| 6 | `--save --doc map` | refused, exit 2, nothing written | right |

## Findings

1. **A hand-written acceptance looked verified.** The sample's docs are
   accepted without `accepted-hash`, so step 3's edit to an accepted doc
   could not be detected, and after step 4 the app showed it accepted and
   valid. The validator already warns ("accepted without a fingerprint"),
   but the saved report carried only a warning count. Fixed in this PR: each
   doc has `acceptanceVerified`, true only for a fingerprinted, unchanged
   acceptance. The app should show the rest as accepted but not verified.
2. **Codex review, PR 11:** the hash was taken by a second read after
   validation, so an edit in between paired the old verdict with the new
   bytes. Fixed: the hash comes from the same read as the verdict.

Both have a test that fails with the fix reverted
(`tests/validation-report.test.mjs`).

**Change for next version:** the Dybs app uses `acceptanceVerified` for
its "accepted" mark (Dybs PR 261), and a skill that reports acceptance says
"accepted but not verified" for a doc without a fingerprint.

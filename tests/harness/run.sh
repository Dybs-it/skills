#!/bin/bash
# Runs the five quality skills headless on a small task with four planted
# defects, one fresh Claude Code session per skill, and keeps each session's
# JSON result (tokens, turns, cost). See tests/runs/ for recorded results.
#
#   tests/harness/run.sh <label> [<model> [<effort>]]
#
# Without a model, each step runs on the model and effort dybs-route.mjs
# names for it (the way a launcher would). Results: $OUT/<label>-<skill>.json,
# work copies: $OUT/w-<label>-review and $OUT/w-<label>-chain.
# Then: python3 tests/harness/sum.py "$OUT" '<label>-*'
set -u
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/../.." && pwd)
OUT=${OUT:-${TMPDIR:-/tmp}/dybs-harness}; mkdir -p "$OUT"
label=$1; model=${2:-}; effort=${3:-}
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
NOTE="The fixed point is main. This is an unattended run: ask no questions. You have my word to commit work with git whenever the skill needs a commit. Do not open a PR."

fixture() { # dir
  rm -rf "$1"; mkdir -p "$1/.claude"; cp -r "$HERE/invites/." "$1/"; cp -r "$REPO/skills" "$1/.claude/skills"
  cp "$REPO/skills/dybs-start/assets/README.md" "$REPO/skills/dybs-start/assets/team.md" "$1/dybs/"
  (cd "$1" && git init -q -b main . && git add -A && git commit -qm "Invites: create and redeem, dybs context, revoke task" \
    && git checkout -qb revoke-invite && git apply "$HERE/invites-change.patch" && git add -A && git commit -qm "Add revokeInvite")
}
step() { # dir skill step
  local flags=()
  if [ -n "$model" ]; then flags=(--model "$model"); [ -n "$effort" ] && flags+=(--effort "$effort")
  else read -ra flags <<<"$(node "$1/.claude/skills/dybs-task/scripts/dybs-route.mjs" route "$1/dybs/work/revoke-invite" "$3" --flags)"; fi
  (cd "$1" && timeout 1500 claude -p "/$2 revoke-invite. $NOTE" "${flags[@]}" --output-format json \
    --setting-sources project --strict-mcp-config --permission-mode acceptEdits --max-budget-usd 4 \
    --allowedTools "Bash Read Write Edit Glob Grep Agent Task Skill" > "$OUT/$label-$2.json" 2> "$OUT/$label-$2.err"
   echo "$label $2 ${flags[*]} exit=$?")
}
fixture "$OUT/w-$label-review"; fixture "$OUT/w-$label-chain"
step "$OUT/w-$label-review" dybs-review review &
( step "$OUT/w-$label-chain" dybs-test-plan test-plan; step "$OUT/w-$label-chain" dybs-tests tests
  step "$OUT/w-$label-chain" dybs-gate gate; step "$OUT/w-$label-chain" dybs-pr pr ) &
wait

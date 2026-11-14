#!/bin/bash
# Takes one issue through the whole work loop, headless: a script names each
# next step and its model, one fresh Claude Code session runs it, until the
# loop stops for the human or the task is done. This is the loop a launcher
# such as the Dybs app would run.
#
#   tests/harness/loop.sh <label> [<issue text>]
#
# Results: $OUT/<label>-NN-<step>.json, the work copy: $OUT/w-<label>.
# Then: python3 tests/harness/sum.py "$OUT" '<label>-*'
set -u
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/../.." && pwd)
OUT=${OUT:-${TMPDIR:-/tmp}/dybs-harness}; mkdir -p "$OUT"
label=$1; task=revoke-invite; MAX_STEPS=${MAX_STEPS:-12}
ISSUE=${2:-"Owners cannot take back an invite link. Add revokeInvite(id, userId) to src/invites.mjs: the owner revokes an invite and redeeming it afterwards fails with reason revoked; someone who is not the owner gets not-owner and the invite still works; an unknown id gets not-found; a revoked invite reports revoked even when it is also expired or used up."}
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
W="$OUT/w-$label"; R="$W/.claude/skills/dybs-task/scripts/dybs-route.mjs"
NOTE="The fixed point is main. This is an unattended run: ask no questions. You have my word to commit work with git whenever the skill needs a commit. Do not push and do not open a PR."

rm -rf "$W"; mkdir -p "$W/.claude"; cp -r "$HERE/invites/." "$W/"; cp -r "$REPO/skills" "$W/.claude/skills"
cp "$REPO/skills/dybs-start/assets/README.md" "$REPO/skills/dybs-start/assets/team.md" "$W/dybs/"
rm -rf "$W/dybs/work/$task"; mkdir -p "$W/dybs/work/$task"
(cd "$W" && git init -q -b main . && git add -A && git commit -qm "Invites: create and redeem, dybs context" && git checkout -qb "$task")

for i in $(seq -w 1 "$MAX_STEPS"); do
  n=$(node "$R" next "$W/dybs/work/$task" --json)
  kind=$(node -e 'console.log(JSON.parse(process.argv[1]).kind)' "$n")
  if [ "$kind" != run ]; then echo "$label loop ended: $n"; break; fi
  step=$(node -e 'console.log(JSON.parse(process.argv[1]).step)' "$n")
  esc=$(node -e 'console.log(JSON.parse(process.argv[1]).escalate ? "--escalate" : "")' "$n")
  read -ra flags <<<"$(node "$R" route "$W/dybs/work/$task" "$step" $esc --flags)"
  ask="/dybs-$step $task. $NOTE"; [ "$step" = task ] && ask="/dybs-task Name the task $task. The issue: $ISSUE $NOTE"
  (cd "$W" && timeout 1500 claude -p "$ask" "${flags[@]}" --output-format json --setting-sources project --strict-mcp-config \
    --permission-mode acceptEdits --max-budget-usd 4 --allowedTools "Bash Read Write Edit Glob Grep Agent Task Skill" \
    > "$OUT/$label-$i-$step.json" 2> "$OUT/$label-$i-$step.err"; echo "$label $i $step ${flags[*]} exit=$?")
done
node "$R" status "$W/dybs/work"

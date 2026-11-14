import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, sep } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { score, route, logLine, taskInfo, findings, next, gateItems, gateTables, gateDecision, STEPS, SKILLS, LEVELS, MODELS, EFFORTS, ROUTES, MAX_ROUNDS } from '../skills/dybs-task/scripts/dybs-route.mjs';
import { SKILLS_SRC, QUALITY } from '../src/update.mjs';

const SCRIPT = join(SKILLS_SRC, 'dybs-task/scripts/dybs-route.mjs');
const run = (...args) => spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8' });

const plan = ({ files = ['src/a.js'], scenarios = 3, level = 'unit', risk = 4, p0 = 1, extra = '' } = {}) => `---
task: t
status: draft
updated: 2026-11-14
${extra}---

# Test plan: t

## Scope

In scope: ${files.map((f) => `\`${f}\``).join(', ')}.
Out of scope: \`other/never.js\`, \`other/counted.js\`.

## Acceptance criteria

${Array.from({ length: p0 }, (_, i) => `- **AC${i + 1}** (P0, R1): given a, when b, then c`).join('\n')}

## Risks

| Risk | Category | P | I | Score | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|---|
| it breaks | data | 2 | 2 | ${risk} | t-UNIT-01 | dev | open |

## Edge cases

## Seams

- the exported functions

## Scenarios

| Id | Priority | Level | Seam | Given / when / then | Covers | Test | Status |
|---|---|---|---|---|---|---|---|
${Array.from({ length: scenarios }, (_, i) => `| t-UNIT-${i + 1} | P1 | ${level} | exports | given a \\| b | AC1 | | planned |`).join('\n')}
`;

// A project with dybs/work/t/test-plan.md and the files the plan names.
function project(opts = {}, sizes = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dybs-route-'));
  const dir = join(root, 'dybs/work/t');
  mkdirSync(dir, { recursive: true });
  for (const f of opts.files ?? ['src/a.js']) {
    // Never write outside the temporary project, whatever a plan names.
    if (!resolve(root, f).startsWith(root + sep)) continue;
    mkdirSync(join(root, f, '..'), { recursive: true });
    writeFileSync(join(root, f), 'x\n'.repeat(sizes[f] ?? 10));
  }
  writeFileSync(join(dir, 'test-plan.md'), plan(opts));
  return { root, dir };
}

test('the routing table names a known model and effort for every step and complexity', () => {
  assert.deepEqual(Object.keys(ROUTES).sort(), [...STEPS].sort());
  for (const s of STEPS) for (const l of LEVELS) {
    const [m, e] = ROUTES[s][l];
    assert.ok(MODELS.includes(m) && EFFORTS.includes(e), `${s} ${l}`);
  }
});

test('a stronger model is never routed to a simpler task than to a harder one', () => {
  for (const s of STEPS) for (let i = 1; i < LEVELS.length; i++) {
    assert.ok(MODELS.indexOf(ROUTES[s][LEVELS[i]][0]) >= MODELS.indexOf(ROUTES[s][LEVELS[i - 1]][0]), `${s} ${LEVELS[i]}`);
  }
});

test('a small plan is S; the same plan always scores the same', () => {
  const a = score(plan());
  assert.equal(a.complexity, 'S');
  assert.deepEqual(score(plan()), a);
});

test('what the plan only judges adds one point at most, so it never moves a small task past S', () => {
  const s = score(plan({ risk: 9, p0: 6 }));
  assert.equal(s.points, 1);
  assert.equal(s.complexity, 'S');
});

test('breadth and test level raise the complexity', () => {
  const many = Array.from({ length: 9 }, (_, i) => `mod${i}/src/f${i}.js`);
  assert.equal(score(plan({ files: many, scenarios: 12, level: 'integration' })).complexity, 'L');
  const wide = Array.from({ length: 21 }, (_, i) => `mod${i}/src/f${i}.js`);
  assert.equal(score(plan({ files: wide, scenarios: 21, level: 'end-to-end', risk: 9 })).complexity, 'XL');
});

test('files named as out of scope do not count', () => {
  assert.ok(!score(plan()).reasons.some((r) => /files in scope/.test(r)));
});

test('with the project at hand, only files that exist count, and their size does', () => {
  const { dir } = project({ files: ['src/a.js', 'src/gone.js'] }, { 'src/a.js': 2000 });
  execFileSync('rm', [join(dir, '../../../src/gone.js')]);
  const out = JSON.parse(run('score', dir, '--json').stdout);
  assert.ok(out.reasons.some((r) => /\+2 200[01] lines/.test(r)), out.reasons.join('; '));
  assert.equal(out.complexity, 'M');
});

test('a file named outside the project is not read', () => {
  // A large file beside the project, named with a path that climbs out of it.
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  writeFileSync(join(outside, 'big.js'), 'x\n'.repeat(6000));
  const { root, dir } = project({ files: ['src/a.js'] });
  const climb = `${relative(root, outside)}/big.js`;
  assert.ok(climb.startsWith('..'));
  writeFileSync(join(dir, 'test-plan.md'), plan({ files: [climb, 'src/a.js'] }));
  const out = JSON.parse(run('score', dir, '--json').stdout);
  assert.equal(out.complexity, 'S');
  assert.ok(!out.reasons.some((r) => /lines in those files/.test(r)), out.reasons.join('; '));
});

test("the human's complexity in the frontmatter wins over the computed one", () => {
  const s = score(plan({ extra: 'complexity: XL\n' }));
  assert.equal(s.complexity, 'XL');
  assert.equal(s.computed, 'S');
  assert.equal(score(plan({ extra: 'complexity: huge\n' })).complexity, 'S');
});

test('a template row with a placeholder is not a scenario', () => {
  const t = readFileSync(join(SKILLS_SRC, 'dybs-test-plan/template.md'), 'utf8');
  assert.equal(score(t).complexity, 'S');
  assert.ok(score(t).reasons.length === 0);
});

test('without a test plan the task is routed as a middle case', () => {
  const { dir } = project();
  execFileSync('rm', [join(dir, 'test-plan.md')]);
  assert.equal(run('route', dir, 'test-plan', '--flags').stdout.trim(), '--model sonnet --effort medium');
});

test('escalating moves one model up and never past the strongest', () => {
  assert.deepEqual(route('tests', 'S', { escalate: true }), { model: 'opus', effort: 'high' });
  assert.deepEqual(route('tests', 'XL', { escalate: true }), { model: 'fable', effort: 'high' });
});

test('route --flags prints flags a shell can pass on as they are', () => {
  const { dir } = project();
  assert.match(run('route', dir, 'gate', '--flags').stdout, /^--model [a-z]+ --effort [a-z]+\n$/);
});

test('log appends one line per run and never rewrites earlier lines', () => {
  const { dir } = project();
  run('log', dir, 'tests', 'done', '--ran-on', 'claude-sonnet-5-5');
  const first = readFileSync(join(dir, 'log.md'), 'utf8');
  run('log', dir, 'review', 'done', '--note', 'two findings');
  const both = readFileSync(join(dir, 'log.md'), 'utf8');
  assert.ok(both.startsWith(first));
  assert.equal(both.split('\n').filter((l) => l.startsWith('- ')).length, 2);
  assert.match(both, /\| tests \| done \| complexity S \| routed sonnet medium \| ran on claude-sonnet-5-5\n/);
});

test('a note cannot add a second line or a column to the log', () => {
  const l = logLine({ step: 'tests', event: 'done', complexity: 'S', model: 'sonnet', effort: 'low', note: 'a\n- fake | line', now: new Date(0) });
  assert.equal(l, '- 1970-01-01T00:00Z | tests | done | complexity S | routed sonnet low | a - fake line\n');
});

test('stuck names the stronger model to run the step on', () => {
  const { dir } = project();
  assert.match(run('log', dir, 'tests', 'stuck').stdout, /Escalate: run this step again with --model opus --effort high\./);
});

test('an unknown step, event or task folder is refused and nothing is logged', () => {
  const { dir, root } = project();
  assert.equal(run('log', dir, 'deploy', 'done').status, 2);
  assert.equal(run('log', dir, 'tests', 'finished').status, 2);
  assert.equal(run('route', join(root, 'nope'), 'tests').status, 2);
  mkdirSync(join(root, 'dybs/work/$(x)'));
  assert.equal(run('log', join(root, 'dybs/work/$(x)'), 'tests', 'done').status, 2);
  assert.throws(() => readFileSync(join(dir, 'log.md')));
});

test('every quality skill tells the agent to log its run, and quality.md says how', () => {
  for (const s of QUALITY) {
    const t = readFileSync(join(SKILLS_SRC, s, 'SKILL.md'), 'utf8');
    assert.match(t, /log the run/, s);
  }
  const q = readFileSync(join(SKILLS_SRC, 'dybs-test-plan/quality.md'), 'utf8');
  assert.ok(q.includes('## Model, effort and the run log') && q.includes('dybs-route.mjs'));
  for (const s of STEPS) assert.ok(q.includes(`\`${s}\``), s);
});

// --- The work loop: lanes, findings, what a task needs next ---

const task = ({ status = 'open', files = ['src/a.js'], criteria = 2, rule = '', extra = '' } = {}) => `---
task: t
status: ${status}
${extra}---

# T

## Ask

Make it work${rule}.

## Acceptance

${Array.from({ length: criteria }, (_, i) => `- it does thing ${i + 1}`).join('\n')}

## Touches

${files.map((f) => `- \`${f}\``).join('\n')}

## Out of scope

- \`other/not-this.js\`
`;
const review = ({ open = 0, fixed = 0, human = 0, round = 1, status = 'current' } = {}) => [
  '---', 'task: t', `round: ${round}`, `status: ${status}`, '---', '', '## Verification', '',
  ...Array.from({ length: open }, (_, i) => `- [ ] **V${i + 1}** a behaviour no test would catch`),
  ...Array.from({ length: fixed }, (_, i) => `- [x] **P${i + 1}** done, test/a.test.js:${i + 1}`),
  ...Array.from({ length: human }, (_, i) => `- [ ] **S${i + 1}** rename the module (needs human: a design question)`),
  '',
].join('\n');
const gateMd = (d) => `---\ntask: t\n---\n\n## Decision\n\nDecision: ${d}\n`;
const logMd = (...ev) => ev.map(([s, e]) => `- 2026-11-14T10:00Z | ${s} | ${e} | complexity S | routed sonnet medium`).join('\n') + '\n';
const donePlan = plan({ scenarios: 2 }).replaceAll('| planned |', '| green |');
const step = (files) => { const n = next(files); return n.kind === 'run' ? n.step : `${n.kind}:${n.reason ?? ''}`; };

test('every step has a skill and a route', () => {
  assert.deepEqual(Object.keys(SKILLS).sort(), [...STEPS].sort());
});

test('a small task goes the fast lane; size, criteria, a domain rule or a missing file list send it the full one', () => {
  assert.equal(taskInfo(task()).lane, 'fast');
  assert.equal(taskInfo(task({ files: ['a.js', 'b.js', 'c.js'] })).lane, 'full');
  assert.equal(taskInfo(task({ criteria: 4 })).lane, 'full');
  assert.equal(taskInfo(task({ rule: ' and keep D2' })).lane, 'full');
  assert.equal(taskInfo(task({ files: [] })).lane, 'full');
  assert.equal(taskInfo(task({ criteria: 0 })).lane, 'full');
});

test('files named as out of scope do not push a task out of the fast lane', () => {
  assert.equal(taskInfo(task({ files: ['a.js', 'b.js'] })).lane, 'fast');
});

test("the human's lane wins either way, and an unknown lane is ignored", () => {
  assert.equal(taskInfo(task({ files: ['a.js', 'b.js', 'c.js'], extra: 'lane: fast\n' })).lane, 'fast');
  assert.equal(taskInfo(task({ extra: 'lane: full\n' })).lane, 'full');
  assert.equal(taskInfo(task({ extra: 'lane: express\n' })).lane, 'fast');
});

test('with the project at hand, large files send a two-file task the full lane', () => {
  const { root, dir } = project({ files: ['src/a.js'] }, { 'src/a.js': 700 });
  writeFileSync(join(dir, 'task.md'), task());
  execFileSync('rm', [join(dir, 'test-plan.md')]);
  const out = JSON.parse(run('next', dir, '--json').stdout);
  assert.equal(out.step, 'test-plan', JSON.stringify(out));
  assert.ok(root);
});

test('findings are counted from checklist items: open, fixed, and questions for the human', () => {
  assert.deepEqual(findings(review({ open: 2, fixed: 3, human: 1, round: 2 })), { total: 6, fixed: 3, open: 2, human: 1, stale: false, round: 2 });
  assert.equal(findings(review({ status: 'stale' })).stale, true);
  assert.equal(findings('- [ ] **V1** {{what}}').total, 0);
  assert.equal(findings('<!--\n- [ ] **V1** hidden\n-->').total, 0);
});

test('the fast lane runs build, review, pr, and then waits for the merge', () => {
  const f = {};
  assert.equal(step(f), 'task');
  f.task = task();
  assert.equal(step(f), 'build');
  f.task = task({ status: 'building' });
  assert.equal(step(f), 'build');
  f.task = task({ status: 'review' });
  assert.equal(step(f), 'review');
  f.review = review();
  assert.equal(step(f), 'pr');
  f.pr = '# PR';
  assert.equal(step(f), 'stop:merge');
  f.task = task({ status: 'done' });
  assert.deepEqual(next(f), { kind: 'done' });
});

test('the full lane adds the test plan and the gate', () => {
  const f = { task: task({ criteria: 5 }) };
  assert.equal(step(f), 'test-plan');
  f.testPlan = plan({ scenarios: 2 });
  assert.equal(step(f), 'build');
  f.testPlan = plan({ scenarios: 2 }).replaceAll('| planned |', '| green |');
  f.task = task({ criteria: 5, status: 'review' });
  assert.equal(step(f), 'review');
  f.review = review();
  assert.equal(step(f), 'gate');
  f.gate = gateMd('not computed (no gate script)');
  assert.equal(step(f), 'gate');
  f.gate = gateMd('PASS');
  assert.equal(step(f), 'pr');
});

test('a task marked review still builds while a scenario is planned', () => {
  assert.equal(step({ task: task({ criteria: 5, status: 'review' }), testPlan: plan({ scenarios: 1 }) }), 'build');
});

test('a gate FAIL stops for the human and never reaches the PR', () => {
  const f = { task: task({ criteria: 5, status: 'review' }), testPlan: donePlan, review: review(), gate: gateMd('FAIL') };
  assert.equal(step(f), 'stop:gate-fail');
});

test('open findings send the task back to build; a stale review is reviewed again', () => {
  const f = { task: task({ status: 'review' }), review: review({ open: 2 }) };
  assert.equal(step(f), 'build');
  f.review = review({ fixed: 2, status: 'stale' });
  assert.equal(step(f), 'review');
  f.review = review({ fixed: 2, round: 2 });
  assert.equal(step(f), 'pr');
});

test('findings that are questions stop for the human once the fixable ones are closed', () => {
  assert.equal(step({ task: task({ status: 'review' }), review: review({ open: 1, human: 1 }) }), 'build');
  assert.equal(step({ task: task({ status: 'review' }), review: review({ fixed: 1, human: 1 }) }), 'stop:findings');
});

test('the fix loop ends: findings still open after the last round go to the human', () => {
  assert.equal(step({ task: task({ status: 'review' }), review: review({ open: 1, round: MAX_ROUNDS }) }), 'stop:review-rounds');
  assert.equal(step({ task: task({ status: 'review' }), review: review({ fixed: 1, round: MAX_ROUNDS, status: 'stale' }) }), 'stop:review-rounds');
});

test('a step that gave up runs once more one model up, then goes to the human', () => {
  const f = { task: task() };
  assert.deepEqual(next({ ...f, log: logMd(['build', 'stuck']) }), { kind: 'run', step: 'build', skill: 'dybs-build', escalate: true });
  assert.equal(step({ ...f, log: logMd(['build', 'stuck'], ['build', 'stuck']) }), 'stop:stuck');
});

test('a stopped task is never started again by the loop', () => {
  assert.equal(step({ task: task({ status: 'stopped' }) }), 'stop:stopped');
});

test('status prints the board from the task folders and stores nothing', () => {
  const { root, dir } = project();
  writeFileSync(join(dir, 'task.md'), task({ status: 'review' }));
  execFileSync('rm', [join(dir, 'test-plan.md')]);
  mkdirSync(join(root, 'dybs/work/empty'));
  const b = JSON.parse(run('status', join(root, 'dybs/work'), '--json').stdout);
  assert.deepEqual(b.map((r) => [r.task, r.status, r.next]), [['empty', 'no task.md', 'task'], ['t', 'review', 'review']]);
  assert.match(run('status', join(root, 'dybs/work')).stdout, /\| t \| review \| fast \| S \| review \|/);
});

// --- The gate's items table, built from the plan ---

const gatePlan = (scen) => `---
task: t
---

## Acceptance criteria

- **AC1** (P1, R3, D2): given a, when b, then c
- **AC2** (P2, R3): given a, when b, then d
- **AC3** (R4): given a, when b, then e

## Risks

| Risk | Category | P | I | Score | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|---|
| **risk-1** it \`leaks\` \\| badly &amp; [often] | security | 3 | 3 | 9 | t-UNIT-01 | dev | open |

## Scenarios

| Id | Priority | Level | Seam | Given / when / then | Covers | Test | Status |
|---|---|---|---|---|---|---|---|
${scen.map(([covers, test, status, prio], i) => `| t-UNIT-0${i + 1} | ${prio ?? 'P2'} | unit | exports | g | ${covers} | ${test} | ${status} |`).join('\n')}
`;
const row = (g, id) => g.items.find((i) => i.item === id);

test('an item is FULL only when every scenario covering it is proven and names its test', () => {
  const g = gateItems(gatePlan([['AC1', 'test/a.test.js:3', 'green'], ['AC1', 'test/a.test.js:9', 'proven'], ['AC2', 'test/a.test.js:20', 'planned'], ['AC2', '`test/a.test.js:30`', 'green']]));
  assert.deepEqual(row(g, 'AC1'), { item: 'AC1', priority: 'P1', coverage: 'FULL', evidence: ['test/a.test.js:3', 'test/a.test.js:9'] });
  assert.equal(row(g, 'AC2').coverage, 'PARTIAL');
  assert.deepEqual(row(g, 'AC2').evidence, ['test/a.test.js:30']);
});

test('a green scenario without a test location proves nothing', () => {
  const g = gateItems(gatePlan([['AC1', '', 'green'], ['AC2', 'somewhere in tests', 'proven']]));
  assert.equal(row(g, 'AC1').coverage, 'NONE');
  assert.equal(row(g, 'AC2').coverage, 'NONE');
});

test('priority is the item\'s own, raised by a covering scenario, and P0 when nothing gives one', () => {
  const g = gateItems(gatePlan([['AC2', 'test/a.test.js:1', 'green', 'P0'], ['AC1', 'test/a.test.js:2', 'green', 'P3']]));
  assert.equal(row(g, 'AC2').priority, 'P0');
  assert.equal(row(g, 'AC1').priority, 'P1');
  assert.equal(row(g, 'AC3').priority, 'P0');
  assert.equal(row(g, 'AC3').coverage, 'NONE');
});

test('a requirement or rule is as covered as the criteria that cite it', () => {
  const g = gateItems(gatePlan([['AC1', 'test/a.test.js:3', 'green'], ['AC2', 'test/a.test.js:5', 'planned']]));
  assert.equal(row(g, 'D2').coverage, 'FULL');
  assert.equal(row(g, 'R3').coverage, 'PARTIAL');
  assert.equal(row(g, 'R3').priority, 'P1');
  assert.equal(row(g, 'R4').coverage, 'NONE');
  assert.deepEqual(g.items.map((i) => i.item), ['AC1', 'AC2', 'AC3', 'R3', 'D2', 'R4']);
});

test('the same plan always prints the same tables, and the gate script accepts them', async () => {
  const text = gatePlan([['AC1', 'tests/a.test.js:3', 'green'], ['AC2', 'tests/a.test.js:5', 'green'], ['AC3', 'tests/a.test.js:7', 'proven']]);
  assert.equal(gateTables(text), gateTables(text));
  const { parseGate } = await import('../skills/dybs-gate/scripts/dybs-gate.mjs');
  const parsed = parseGate(`---\ntask: t\nupdated: 2026-11-14\ncommit: abc1234\n---\n\n# Gate: t\n\n${gateTables(text)}\n## Waivers\n\n| Item | Reason | Approved by | Approved | Expires |\n|---|---|---|---|---|\n\n## Decision\n`);
  assert.deepEqual(parsed.problems, []);
  assert.equal(parsed.items.length, 6);
  assert.equal(parsed.risks.length, 1);
  assert.match(gateTables(text), /\| risk-1 it leaks badly often \| security \| 3 \| 3 \| 9 \| open \|/);
});

test('items refuses a task folder without a test plan', () => {
  const { dir } = project();
  execFileSync('rm', [join(dir, 'test-plan.md')]);
  const r = run('items', dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no test-plan\.md/);
});

// --- Field run 2026-11-14: the gate step wrote "PASS. Coverage: ..." and the loop ran the gate three times ---

test('the decision is read however the gate step phrased it, and never from a gate that was not computed', () => {
  for (const d of ['Decision: PASS', '**Decision:** PASS (computed)', 'PASS. Coverage: 100% overall, P0 100%.', 'The script says: CONCERNS']) {
    assert.ok(['PASS', 'CONCERNS'].includes(gateDecision(`## Decision\n\n${d}\n`)), d);
  }
  assert.equal(gateDecision('## Decision\n\nDecision: not computed (no gate script). It would PASS.\n'), null);
  assert.equal(gateDecision('## Decision\n\nSTALE: uncommitted changes. Last time it said PASS.\n'), null);
  assert.equal(gateDecision('## Items\n\nPASS\n\n## Decision\n\n'), null);
});

test("the gate script's own answer wins over what gate.md says", () => {
  const f = { task: task({ criteria: 5, status: 'review' }), testPlan: donePlan, review: review(), gate: gateMd('PASS') };
  assert.equal(step({ ...f, gateDecision: 'FAIL' }), 'stop:gate-fail');
  assert.equal(step({ ...f, gateDecision: null }), 'gate');
  assert.equal(step({ ...f, gate: gateMd('FAIL'), gateDecision: 'PASS' }), 'pr');
});

test('a gate or PR step that ran twice without its result stops instead of running a third time', () => {
  const f = { task: task({ criteria: 5, status: 'review' }), testPlan: donePlan, review: review(), gate: gateMd('not computed') };
  assert.equal(step({ ...f, log: logMd(['gate', 'done']) }), 'gate');
  assert.equal(step({ ...f, log: logMd(['gate', 'done'], ['gate', 'done']) }), 'stop:no-progress');
  const g = { task: task({ status: 'review' }), review: review(), log: logMd(['pr', 'done'], ['pr', 'done']) };
  assert.equal(step(g), 'stop:no-progress');
});

test('next asks the installed gate script, so a stale gate is computed again and a real PASS moves on', async () => {
  const { committedGate } = await import('./gate-repo.mjs');
  const gateText = `---\ntask: t\nupdated: 2026-11-14\n---\n\n# Gate: t\n\n## Items\n\n| Item | Priority | Coverage | Evidence | Security |\n|---|---|---|---|---|\n| AC1 | P0 | FULL | tests/a.test.js:3 | no |\n\n## Risks\n\n| Risk | Category | P | I | Score | Status |\n|---|---|---|---|---|---|\n\n## Waivers\n\n| Item | Reason | Approved by | Approved | Expires |\n|---|---|---|---|---|\n\n## Decision\n\nIt went fine.\n`;
  const files = { 'tests/a.test.js': 'test\n'.repeat(60), 'dybs/work/t/task.md': task({ criteria: 5, status: 'review' }), 'dybs/work/t/test-plan.md': donePlan, 'dybs/work/t/review.md': review() };
  const { repo } = committedGate(gateText, files);
  const dir = join(repo, 'dybs/work/t');
  assert.equal(JSON.parse(run('next', dir, '--json').stdout).step, 'pr');
  writeFileSync(join(repo, 'tests/a.test.js'), 'changed\n'.repeat(60));
  assert.equal(JSON.parse(run('next', dir, '--json').stdout).step, 'gate');
});

// --- Codex review on the Dybs app's copy of this rule, 2026-11-14: both held here too ---

test('a gate FAIL stops for the human even while a scenario is still planned', () => {
  const f = { task: task({ criteria: 5, status: 'review' }), testPlan: plan({ scenarios: 2 }), review: review(), gate: gateMd('FAIL') };
  assert.equal(step(f), 'stop:gate-fail');
  assert.equal(step({ ...f, task: task({ criteria: 5, status: 'building' }) }), 'stop:gate-fail');
});

test('a test plan without a single scenario is planned again, once, and never built from', () => {
  const f = { task: task({ criteria: 5 }), testPlan: '# Test plan: t\n\nNothing yet.\n' };
  assert.equal(step(f), 'test-plan');
  assert.equal(step({ ...f, log: logMd(['test-plan', 'done'], ['test-plan', 'done']) }), 'stop:no-progress');
});

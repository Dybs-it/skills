import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { score, route, logLine, STEPS, LEVELS, MODELS, EFFORTS, ROUTES } from '../skills/dybs-test-plan/scripts/dybs-route.mjs';
import { SKILLS_SRC, QUALITY } from '../src/update.mjs';

const SCRIPT = join(SKILLS_SRC, 'dybs-test-plan/scripts/dybs-route.mjs');
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
    mkdirSync(join(root, f, '..'), { recursive: true });
    writeFileSync(join(root, f), 'x\n'.repeat(sizes[f] ?? 10));
  }
  writeFileSync(join(dir, 'test-plan.md'), plan(opts));
  return { root, dir };
}

test('the routing table names a known model and effort for every step and complexity', () => {
  assert.deepEqual(Object.keys(ROUTES), STEPS);
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
  const { dir } = project({ files: ['../../../../etc/hosts.txt', 'src/a.js'] });
  const out = JSON.parse(run('score', dir, '--json').stdout);
  assert.equal(out.complexity, 'S');
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
  assert.equal(run('log', dir, 'build', 'done').status, 2);
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

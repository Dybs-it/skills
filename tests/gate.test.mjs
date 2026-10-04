import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseGate, decide, tableUnder } from '../skills/dybs-gate/scripts/dybs-gate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TODAY = '2026-10-04';

// Builds a gate.md from compact rows.
function gate({ items = [], risks = [], waivers = [] }) {
  const t = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
  return [
    '---', 'task: t', '---', '', '# Gate: t', '',
    '## Items', '', t(['Item', 'Priority', 'Coverage', 'Evidence', 'Security'], items), '',
    '## Risks', '', t(['Risk', 'Category', 'Score', 'Status'], risks), '',
    '## Waivers', '', t(['Item', 'Reason', 'Approved by', 'Approved', 'Expires'], waivers), '',
    '## Decision', '',
  ].join('\n');
}
const full = (id, p = 'P1', sec = 'no') => [id, p, 'FULL', `tests/a.test.js:${id.length}`, sec];
const gap = (id, p = 'P1', cov = 'NONE', sec = 'no') => [id, p, cov, '', sec];
const run = (spec, today = TODAY) => decide(parseGate(gate(spec)), today);
const waiver = (id, over = {}) => {
  const w = { reason: 'launch partner demo', by: 'Jos', approved: '2026-10-01', expires: '2026-11-01', ...over };
  return [id, w.reason, w.by, w.approved, w.expires];
};

test('all items fully covered: PASS', () => {
  assert.equal(run({ items: [full('a', 'P0'), full('b'), full('c', 'P2')] }).decision, 'PASS');
});

test('one P0 item not fully covered: FAIL, whatever the totals', () => {
  const items = [gap('p0', 'P0', 'PARTIAL'), ...Array.from({ length: 20 }, (_, i) => full(`x${i}`))];
  const r = run({ items });
  assert.equal(r.decision, 'FAIL');
  assert.match(r.fail[0], /P0 not fully covered: p0/);
});

test('FULL without a test location counts as PARTIAL', () => {
  const p = parseGate(gate({ items: [['a', 'P0', 'FULL', 'checked by hand', 'no']] }));
  assert.equal(p.items[0].coverage, 'PARTIAL');
  assert.equal(decide(p, TODAY).decision, 'FAIL');
});

test('overall coverage boundary: 80% passes the floor, below fails', () => {
  const four = [full('a', 'P2'), full('b', 'P2'), full('c', 'P2'), full('d', 'P2')];
  assert.equal(run({ items: [...four, gap('e', 'P2')] }).decision, 'PASS'); // 80%
  assert.equal(run({ items: [...four.slice(0, 3), gap('d', 'P2'), gap('e', 'P2')] }).decision, 'FAIL'); // 60%
  assert.equal(run({ items: [...four.slice(0, 3), gap('d', 'P2')] }).decision, 'FAIL'); // 75%: just under the floor
});

test('P1 boundaries: below 80% FAIL, 80 to 89% CONCERNS, 90% PASS', () => {
  const p1 = (fullCount, total) => [...Array.from({ length: fullCount }, (_, i) => full(`f${i}`)), ...Array.from({ length: total - fullCount }, (_, i) => gap(`g${i}`))];
  const pad = Array.from({ length: 30 }, (_, i) => full(`p${i}`, 'P3')); // keeps overall above 80%
  assert.equal(run({ items: [...p1(7, 10), ...pad] }).decision, 'FAIL');
  assert.equal(run({ items: [...p1(8, 10), ...pad] }).decision, 'CONCERNS');
  assert.equal(run({ items: [...p1(17, 20), ...pad] }).decision, 'CONCERNS'); // 85%
  assert.equal(run({ items: [...p1(89, 100), ...pad] }).decision, 'CONCERNS'); // 89%: just under 90
  assert.equal(run({ items: [...p1(9, 10), ...pad] }).decision, 'PASS');
});

test('risks: open 9 FAILs, open 6 to 8 CONCERNS, mitigated does not count', () => {
  const items = [full('a', 'P0')];
  assert.equal(run({ items, risks: [['r', 'data', '9', 'open']] }).decision, 'FAIL');
  assert.equal(run({ items, risks: [['r', 'data', '6', 'open']] }).decision, 'CONCERNS');
  assert.equal(run({ items, risks: [['r', 'data', '9', 'mitigated']] }).decision, 'PASS');
  assert.equal(run({ items, risks: [['r', 'data', '5', 'open']] }).decision, 'PASS');
});

test('a complete, current waiver turns FAIL into WAIVED; the gap still counts', () => {
  const r = run({ items: [gap('p0', 'P0'), full('b')], waivers: [waiver('p0')] });
  assert.equal(r.computed, 'FAIL');
  assert.equal(r.decision, 'WAIVED');
  assert.equal(r.stats.p0, 0);
});

test('waivers are refused when incomplete, expired, or for security', () => {
  const items = [gap('p0', 'P0'), full('b')];
  assert.equal(run({ items, waivers: [waiver('p0', { by: '' })] }).decision, 'FAIL');
  assert.equal(run({ items, waivers: [waiver('p0', { expires: '2026-10-03' })] }).decision, 'FAIL');
  assert.equal(run({ items, waivers: [waiver('p0', { approved: 'last week' })] }).decision, 'FAIL');
  const sec = run({ items: [gap('auth', 'P0', 'NONE', 'yes'), full('b')], waivers: [waiver('auth')] });
  assert.equal(sec.decision, 'FAIL');
  assert.match(sec.waiverProblems[0], /security gaps are never waived/);
  const secRisk = run({ items: [full('a', 'P0')], risks: [['leak', 'security', '9', 'open']], waivers: [waiver('leak')] });
  assert.equal(secRisk.decision, 'FAIL');
});

test('every blocking gap needs its own waiver', () => {
  const items = [gap('a', 'P0'), gap('b', 'P0'), full('c')];
  assert.equal(run({ items, waivers: [waiver('a')] }).decision, 'FAIL');
  assert.equal(run({ items, waivers: [waiver('a'), waiver('b')] }).decision, 'WAIVED');
});

test('a waiver does not turn CONCERNS into anything', () => {
  const r = run({ items: [full('a', 'P0')], risks: [['r', 'ops', '6', 'open']], waivers: [waiver('r')] });
  assert.equal(r.decision, 'CONCERNS');
});

test('format problems are reported, not guessed', () => {
  const p = parseGate(gate({ items: [['a', 'P5', 'MOSTLY', '', 'no']], risks: [['r', 'x', '12', 'open']] }));
  assert.equal(p.problems.length, 3);
  assert.deepEqual(parseGate('# nothing here').problems, ['missing "## Items" table']);
});

test('tableUnder stops at the next heading and skips the separator', () => {
  const rows = tableUnder('## A\n\n| X | Y |\n|---|---|\n| 1 | 2 |\n\n## B\n| X | Y |\n| 3 | 4 |', 'A');
  assert.deepEqual(rows, [{ x: '1', y: '2' }]);
});

test('CLI: exit 1 on FAIL, 0 on PASS, 2 on a malformed file; dybs-skills gate is the same', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dybs-gate-'));
  const write = (name, spec) => { const p = join(dir, name); writeFileSync(p, typeof spec === 'string' ? spec : gate(spec)); return p; };
  const gateCli = join(ROOT, 'skills/dybs-gate/scripts/dybs-gate.mjs');
  const code = (file, bin = gateCli) => { try { execFileSync('node', [bin, ...(bin === gateCli ? [] : ['gate']), file, '--today', TODAY], { stdio: 'pipe' }); return 0; } catch (e) { return e.status; } };
  assert.equal(code(write('pass.md', { items: [full('a', 'P0')] })), 0);
  assert.equal(code(write('fail.md', { items: [gap('a', 'P0')] })), 1);
  assert.equal(code(write('bad.md', '# no tables')), 2);
  assert.equal(code(join(dir, 'fail.md'), join(ROOT, 'bin/dybs-skills.mjs')), 1);
  rmSync(dir, { recursive: true });
});

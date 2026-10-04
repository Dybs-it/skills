import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseGate, decide, tableUnder, headingCount, visible } from '../skills/dybs-gate/scripts/dybs-gate.mjs';
const headingCountFor = (text) => headingCount(text, 'Waivers');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TODAY = '2026-10-04';

// Risks are written as [id, category, score, status]; P and I are filled in
// to match the score, or left blank when no P x I gives it.
const PI = { 1: [1, 1], 2: [1, 2], 3: [1, 3], 4: [2, 2], 6: [2, 3], 9: [3, 3] };
const withPI = (r) => (r.length === 4 ? [r[0], r[1], ...(PI[r[2]] || ['', '']), r[2], r[3]] : r);

// Builds a gate.md from compact rows.
function gate({ items = [], risks = [], waivers = [] }) {
  const t = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
  return [
    '---', 'task: t', '---', '', '# Gate: t', '',
    '## Items', '', t(['Item', 'Priority', 'Coverage', 'Evidence', 'Security'], items), '',
    '## Risks', '', t(['Risk', 'Category', 'P', 'I', 'Score', 'Status'], risks.map(withPI)), '',
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
  assert.equal(run({ items, risks: [['r', 'data', '4', 'open']] }).decision, 'PASS');
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
  const r = run({ items: [full('a', 'P0')], risks: [['r', 'operations', '6', 'open']], waivers: [waiver('r')] });
  assert.equal(r.decision, 'CONCERNS');
});

test('format problems are reported, not guessed', () => {
  const p = parseGate(gate({ items: [['a', 'P5', 'MOSTLY', '', 'no']], risks: [['r', 'x', '12', 'open']] }));
  assert.equal(p.problems.length, 5); // priority, coverage, score, category, P and I
  assert.deepEqual(parseGate('# nothing here').problems, [
    'missing "## Items" table',
    'missing "## Risks" table (keep it, with no rows, when there are no risks)',
  ]);
});

test('tableUnder stops at the next heading and skips the separator', () => {
  const rows = tableUnder('## A\n\n| X | Y |\n|---|---|\n| 1 | 2 |\n\n## B\n| X | Y |\n| 3 | 4 |', 'A');
  assert.deepEqual(rows, [{ x: '1', y: '2' }]);
});

test('CLI: exit 1 on FAIL, 0 on PASS, 2 on a malformed file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dybs-gate-'));
  const write = (name, spec) => { const p = join(dir, name); writeFileSync(p, typeof spec === 'string' ? spec : gate(spec)); return p; };
  const gateCli = join(ROOT, 'skills/dybs-gate/scripts/dybs-gate.mjs');
  const code = (file, bin = gateCli) => { try { execFileSync('node', [bin, ...(bin === gateCli ? [] : ['gate']), file], { stdio: 'pipe' }); return 0; } catch (e) { return e.status; } };
  assert.equal(code(write('pass.md', { items: [full('a', 'P0')] })), 0);
  assert.equal(code(write('fail.md', { items: [gap('a', 'P0')] })), 1);
  assert.equal(code(write('bad.md', '# no tables')), 2);
  // the gate lives in the skill, not in the dybs-skills binary
  assert.equal(code(join(dir, 'fail.md'), join(ROOT, 'bin/dybs-skills.mjs')), 2);
  rmSync(dir, { recursive: true });
});

// --- Codex review findings on PR #3 ---

test('an empty Items table is a format problem, not a PASS', () => {
  const p = parseGate(gate({ items: [] }));
  assert.ok(p.problems.some((x) => /Items table is empty/.test(x)));
});

test('a missing Risks table is a format problem; an empty one is fine', () => {
  const noRisks = gate({ items: [full('a', 'P0')] }).replace(/## Risks[\s\S]*?(?=## Waivers)/, '');
  assert.ok(parseGate(noRisks).problems.some((x) => /missing "## Risks"/.test(x)));
  assert.deepEqual(parseGate(gate({ items: [full('a', 'P0')], risks: [] })).problems, []);
});

test('the Security column must say yes or no; anything else is a problem and treated as security', () => {
  for (const bad of ['', 'yse', '{{no}}', 'maybe']) {
    const p = parseGate(gate({ items: [['auth', 'P0', 'NONE', '', bad]] }));
    assert.ok(p.problems.some((x) => /security must be yes or no/.test(x)), `"${bad}"`);
    assert.equal(p.items[0].security, true, `"${bad}" must not silently become "not security"`);
  }
  for (const ok of ['yes', 'no', 'Y', 'n', 'true', 'FALSE']) {
    assert.deepEqual(parseGate(gate({ items: [['a', 'P0', 'NONE', '', ok]] })).problems, [], ok);
  }
});

test('ids must be unique across items and risks, so a waiver names one thing', () => {
  const p = parseGate(gate({ items: [gap('x', 'P0', 'NONE', 'yes')], risks: [['x', 'operations', '9', 'open']] }));
  assert.ok(p.problems.some((x) => /id x is used more than once/.test(x)));
  const dupItems = parseGate(gate({ items: [full('a'), full('a')] }));
  assert.ok(dupItems.problems.some((x) => /id a is used more than once/.test(x)));
});

test('security is never lost when one id is blocked twice', () => {
  // decide() on hand-built input, bypassing parseGate's uniqueness check
  const items = [{ id: 'x', priority: 'P0', coverage: 'NONE', security: true, notes: [] }, ...Array.from({ length: 4 }, (_, i) => ({ id: `f${i}`, priority: 'P2', coverage: 'FULL', security: false, notes: [] }))];
  const risks = [{ id: 'x', category: 'operations', score: 9, open: true }];
  const waivers = [{ id: 'x', reason: 'demo', by: 'Jos', approved: '2026-10-01', expires: '2026-11-01' }];
  assert.equal(decide({ items, risks, waivers }, TODAY).decision, 'FAIL');
});

test('waiver dates must be real calendar dates', () => {
  const items = [gap('p0', 'P0'), full('b')];
  for (const bad of ['2026-99-99', '2026-02-30', '2026-13-01']) {
    assert.equal(run({ items, waivers: [waiver('p0', { expires: bad })] }).decision, 'FAIL', bad);
  }
  assert.equal(run({ items, waivers: [waiver('p0', { expires: '2028-02-29' })] }).decision, 'WAIVED');
});

test('thresholds compare exact counts, not rounded percentages', () => {
  const many = (fullCount, total, p = 'P2') => Array.from({ length: total }, (_, i) => (i < fullCount ? full(`i${i}`, p) : gap(`i${i}`, p)));
  assert.equal(run({ items: many(323, 404) }).decision, 'FAIL'); // 79.95%, displayed as 80
  assert.equal(run({ items: many(320, 400) }).decision, 'PASS'); // exactly 80%
  const pad = Array.from({ length: 200 }, (_, i) => full(`p${i}`, 'P3'));
  assert.equal(run({ items: [...many(899, 1000, 'P1'), ...pad] }).decision, 'CONCERNS'); // P1 89.9%
});

test('CLI: an unreadable gate file exits 2, not the FAIL code', () => {
  const bin = join(ROOT, 'skills/dybs-gate/scripts/dybs-gate.mjs');
  for (const target of [join(tmpdir(), 'dybs-no-such-gate.md'), tmpdir()]) {
    let status = 0;
    try { execFileSync('node', [bin, target], { stdio: 'pipe' }); } catch (e) { status = e.status; }
    assert.equal(status, 2, target);
  }
});

// --- Codex review round 2 on PR #3 ---

test('a risk with an unknown category is a format problem and never waivable', () => {
  assert.match(parseGate(gate({ items: [full('a', 'P0')], risks: [['r1', 'securty', '9', 'open']] })).problems.join(' '), /category must be one of/);
  const p = parseGate(gate({ items: [full('a', 'P0')], risks: [['r1', 'securty', '9', 'open']], waivers: [waiver('r1')] }));
  p.problems = [];
  const r = decide(p, TODAY);
  assert.equal(r.decision, 'FAIL');
  assert.match(r.waiverProblems.join(' '), /security gaps are never waived/);
});

test('line zero is not a test location', () => {
  const p = parseGate(gate({ items: [['a', 'P0', 'FULL', 'tests/a.test.js:0', 'no']] }));
  assert.equal(p.items[0].coverage, 'PARTIAL');
});

test('a waiver approved after today does not count', () => {
  const items = [gap('a', 'P0')];
  assert.equal(run({ items, waivers: [waiver('a')] }).decision, 'WAIVED');
  assert.equal(run({ items, waivers: [waiver('a', { approved: '2026-10-10' })] }).decision, 'FAIL');
});

test('a Risks heading without a table is a format problem', () => {
  const text = gate({ items: [full('a', 'P0')] }).replace(/## Risks\n\n\|.*\n\|.*\n/, '## Risks\n\nNone found, I think.\n');
  assert.match(parseGate(text).problems.join(' '), /missing "## Risks" table/);
});

test('tables inside HTML comments or code fences are ignored', () => {
  const real = gate({ items: [gap('a', 'P0')] });
  const commented = real.replace('## Items\n\n', '## Items\n\n<!--\n| Item | Priority | Coverage | Evidence | Security |\n|---|---|---|---|---|\n| a | P0 | FULL | tests/a.test.js:1 | no |\n-->\n');
  assert.equal(decide(parseGate(commented), TODAY).decision, 'FAIL');
  const waivedInComment = real.replace('## Waivers\n\n', '## Waivers\n\n<!-- \n| Item | Reason | Approved by | Approved | Expires |\n|---|---|---|---|---|\n| a | demo | Jos | 2026-10-01 | 2026-11-01 |\n-->\n');
  assert.equal(decide(parseGate(waivedInComment), TODAY).decision, 'FAIL');
  const fenced = real.replace('## Waivers\n\n', '## Waivers\n\n```\n| Item | Reason | Approved by | Approved | Expires |\n|---|---|---|---|---|\n| a | demo | Jos | 2026-10-01 | 2026-11-01 |\n```\n');
  assert.equal(decide(parseGate(fenced), TODAY).decision, 'FAIL');
});

test('the CLI has no way to pick another date: --today is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dybs-gate-'));
  const file = join(dir, 'gate.md');
  writeFileSync(file, gate({ items: [full('a', 'P0')] }));
  const cli = join(ROOT, 'skills/dybs-gate/scripts/dybs-gate.mjs');
  const code = (args) => { try { execFileSync('node', [cli, file, ...args], { stdio: 'pipe' }); return 0; } catch (e) { return e.status; } };
  assert.equal(code(['--today', '2020-01-01']), 2);
  assert.equal(code(['--json']), 0);
  assert.equal(code([]), 0);
  rmSync(dir, { recursive: true });
});

// --- Codex review round 3 on PR #3 ---

test('the score must be P x I, so a mistyped score cannot downgrade a blocker', () => {
  const p = parseGate(gate({ items: [full('a', 'P0')], risks: [['r', 'data', '3', '3', '8', 'open']] }));
  assert.match(p.problems.join(' '), /score 8 is not P x I = 9/);
  assert.deepEqual(parseGate(gate({ items: [full('a', 'P0')], risks: [['r', 'data', '3', '3', '9', 'open']] })).problems, []);
});

test('an indented table is code, never a waiver', () => {
  const text = gate({ items: [gap('a', 'P0')] }).replace(/## Waivers\n\n[\s\S]*?\n\n## Decision/,
    '## Waivers\n\n    | Item | Reason | Approved by | Approved | Expires |\n    |---|---|---|---|---|\n    | a | demo | Jos | 2026-10-01 | 2026-11-01 |\n\n## Decision');
  assert.equal(decide(parseGate(text), TODAY).decision, 'FAIL');
});

test('a table without the expected columns, or without a separator, is not a table', () => {
  const oneCell = gate({ items: [full('a', 'P0')] }).replace(/## Risks\n\n[\s\S]*?\n\n## Waivers/, '## Risks\n\n| There are no risks |\n|---|\n\n## Waivers');
  assert.match(parseGate(oneCell).problems.join(' '), /Risks table lacks column\(s\): risk, category, p, i, score, status/);
  const noSeparator = gate({ items: [full('a', 'P0')] }).replace(/## Risks\n\n[\s\S]*?\n\n## Waivers/, '## Risks\n\n| There are no risks |\n\n## Waivers');
  assert.match(parseGate(noSeparator).problems.join(' '), /missing "## Risks" table/);
});

// --- Codex review round 4 on PR #3 ---

const waiverRows = '| Item | Reason | Approved by | Approved | Expires |\n|---|---|---|---|---|\n| a | demo | Jos | 2026-10-01 | 2026-11-01 |';
const withWaiverBlock = (block) => gate({ items: [gap('a', 'P0')] }).replace(/## Waivers\n\n[\s\S]*?\n\n## Decision/, `## Waivers\n\n${block}\n\n## Decision`);

test('fences indented up to three spaces, or never closed, hide their tables', () => {
  for (const block of [
    '   ```\n' + waiverRows + '\n   ```',
    '~~~~\n' + waiverRows + '\n~~~~',
    '```\n' + waiverRows,
    '<!--\n' + waiverRows,
  ]) {
    assert.equal(decide(parseGate(withWaiverBlock(block)), TODAY).decision, 'FAIL', block);
  }
  // a real table after a closed fence still counts
  const after = withWaiverBlock('```\nexample\n```\n\n' + waiverRows);
  assert.equal(decide(parseGate(after), TODAY).decision, 'WAIVED');
});

test('a column that appears twice is a format problem', () => {
  const text = gate({ items: [] }).replace(/## Items\n\n[\s\S]*?\n\n## Risks/,
    '## Items\n\n| Item | Priority | Coverage | Evidence | Security | Security |\n|---|---|---|---|---|---|\n| a | P0 | NONE |  | yes | no |\n\n## Risks');
  assert.match(parseGate(text).problems.join(' '), /Items table has the column\(s\) security more than once/);
});

test('a section that appears twice is a format problem', () => {
  const text = gate({ items: [full('a', 'P0')] }) + '\n## Risks\n\n| Risk | Category | P | I | Score | Status |\n|---|---|---|---|---|---|\n| r | data | 3 | 3 | 9 | open |\n';
  assert.match(parseGate(text).problems.join(' '), /"## Risks" appears more than once/);
});

test('the gate\'s default today is the local date, not the UTC one', () => {
  const script = `import { localDate } from ${JSON.stringify(new URL('../skills/dybs-gate/scripts/dybs-gate.mjs', import.meta.url).href)};
    console.log(localDate(new Date(2026, 9, 4, 23, 30)));`;
  const out = execFileSync('node', ['--input-type=module', '-e', script], { env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8' });
  assert.equal(out.trim(), '2026-10-04');
});

// --- Codex review round 5 on PR #3 ---

test('a heading indented as code is not a heading', () => {
  // The only Waivers heading is indented, so it is code: there is no Waivers
  // section, and the table under it waives nothing.
  const text = gate({ items: [gap('a', 'P0')] }).replace(/## Waivers\n\n[\s\S]*?\n\n## Decision/,
    '    ## Waivers\n\n' + waiverRows + '\n\n## Decision');
  assert.equal(decide(parseGate(text), TODAY).decision, 'FAIL');
  // An indented copy under a real heading is just code inside that section.
  const real = gate({ items: [gap('a', 'P0')] }).replace(/## Waivers\n\n[\s\S]*?\n\n## Decision/,
    '## Waivers\n\n    ## Waivers\n\n' + waiverRows + '\n\n## Decision');
  assert.equal(decide(parseGate(real), TODAY).decision, 'WAIVED');
  const tabbed = gate({ items: [gap('a', 'P0')] }).replace('## Waivers', '\t## Waivers').replace(/\| a \| demo/, '| a | demo');
  assert.equal(headingCountFor(tabbed), 0);
});

test('a renewed waiver below an expired one counts', () => {
  const items = [gap('a', 'P0')];
  const expired = waiver('a', { approved: '2026-08-01', expires: '2026-09-01' });
  assert.equal(run({ items, waivers: [expired] }).decision, 'FAIL');
  assert.equal(run({ items, waivers: [expired, waiver('a')] }).decision, 'WAIVED');
  assert.equal(run({ items, waivers: [waiver('a'), expired] }).decision, 'WAIVED');
});

// --- Codex review round 6 on PR #3 ---

test('a test location must be a whole path:line token', () => {
  const cov = (evidence) => parseGate(gate({ items: [['a', 'P0', 'FULL', evidence, 'no']] })).items[0].coverage;
  assert.equal(cov('tests/a.test.js:1garbage'), 'PARTIAL');
  assert.equal(cov('see tests/a.test.js:0x'), 'PARTIAL');
  assert.equal(cov('tests/a.test.js:14'), 'FULL');
  assert.equal(cov('`tests/a.test.js:14`, tests/b.test.js:3'), 'FULL');
});

test('the gate script runs when called through a linked skill folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dybs-link-'));
  symlinkSync(join(ROOT, 'skills/dybs-gate'), join(dir, 'dybs-gate'));
  const out = execFileSync('node', [join(dir, 'dybs-gate/scripts/dybs-gate.mjs'), join(ROOT, 'tests/fixtures/gate-pass.md')], { encoding: 'utf8' });
  assert.match(out, /Decision: PASS/);
  rmSync(dir, { recursive: true });
});

// --- Codex review round 7 on PR #3 ---

test('raw HTML in gate.md is refused, so <pre> cannot hide or show a table', () => {
  const text = gate({ items: [gap('a', 'P0')] }).replace('## Items\n\n', '## Items\n\n<pre>\n| Item | Priority | Coverage | Evidence | Security |\n|---|---|---|---|---|\n| a | P0 | FULL | tests/a.test.js:1 | no |\n</pre>\n\n');
  assert.match(parseGate(text).problems.join(' '), /may not contain raw HTML/);
});

test('a second table in a section is a format problem', () => {
  const text = gate({ items: [full('a', 'P0')] }).replace(/## Waivers/, '| Risk | Category | P | I | Score | Status |\n|---|---|---|---|---|---|\n| r | security | 3 | 3 | 9 | open |\n\n## Waivers');
  assert.match(parseGate(text).problems.join(' '), /Risks section has more than one table/);
});

test('an escaped pipe stays inside its cell', () => {
  const rows = tableUnder('## A\n\n| X | Y |\n|---|---|\n| a \\| b | 2 |\n', 'A');
  assert.deepEqual(rows, [{ x: 'a | b', y: '2' }]);
});

test('the CLI takes exactly one gate file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dybs-gate-'));
  const a = join(dir, 'a.md'); writeFileSync(a, gate({ items: [full('a', 'P0')] }));
  const b = join(dir, 'b.md'); writeFileSync(b, gate({ items: [gap('a', 'P0')] }));
  const cli = join(ROOT, 'skills/dybs-gate/scripts/dybs-gate.mjs');
  const code = (args) => { try { execFileSync('node', [cli, ...args], { stdio: 'pipe' }); return 0; } catch (e) { return e.status; } };
  assert.equal(code([a, b]), 2);
  assert.equal(code([a]), 0);
  rmSync(dir, { recursive: true });
});

// --- Codex review round 8 on PR #3 ---

test('a separator row narrower than the header is not a table', () => {
  const text = gate({ items: [] }).replace(/## Items\n\n[\s\S]*?\n\n## Risks/,
    '## Items\n\n| Item | Priority | Coverage | Evidence | Security |\n|---|\n| a | P0 | FULL | tests/a.test.js:1 | no |\n\n## Risks');
  assert.match(parseGate(text).problems.join(' '), /missing "## Items" table/);
});

// --- Codex review on PR #3, commit 9598952 ---

test('an escaped or inline comment marker is refused, never used to hide rows', () => {
  const real = gate({ items: [full('a', 'P0'), gap('b', 'P0')] });
  const hidden = real.replace(/\| a \| P0 \| FULL \|([^\n]*)\n/, (m) => m.replace(/\n$/, ' \\<!-- |\n'))
    .replace(/(\| b \| P0 \| NONE \|[^\n]*\n)/, '$1--> \n');
  const parsed = parseGate(hidden);
  assert.match(parsed.problems.join(' '), /HTML comments must start a line of their own/);
  assert.notEqual(decide(parsed, TODAY).decision, 'PASS');
  const trailing = real.replace('## Items\n\n', '## Items\n\n<!-- note --> | x |\n\n');
  assert.match(parseGate(trailing).problems.join(' '), /nothing after a comment's closing -->/);
});

test('pipes split by backslash parity, and a row with extra cells is refused', async () => {
  const { cellsOf } = await import('../skills/dybs-gate/scripts/dybs-gate.mjs');
  assert.deepEqual(cellsOf('| a \\| b | c |'), ['a | b', 'c']);
  assert.deepEqual(cellsOf('| a \\\\| b | c |'), ['a \\\\', 'b', 'c']);
  const base = gate({ items: [gap('a', 'P0')] });
  assert.ok(base.includes('| a | P0 | NONE |  | no |'));
  const text = base.replace('| a | P0 | NONE |  | no |', '| a | P0 | NONE |  | no \\\\| yes |');
  const parsed = parseGate(text);
  assert.match(parsed.problems.join(' '), /different number of cells than its header/);
});

test('a code fence opened inside a list item is refused', () => {
  const block = '- ```\n  ' + waiverRows.split('\n').join('\n  ') + '\n  ```';
  const parsed = parseGate(withWaiverBlock(block));
  // A format problem makes the CLI exit 2 before any decision is shown.
  assert.match(parsed.problems.join(' '), /code fence inside a list item or a quote/);
});

test('review counts untracked files before calling a change empty; pr ignores its own work files', () => {
  const review = readFileSync(join(ROOT, 'skills/dybs-review/SKILL.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(review, /empty only when both the diff and the untracked list are empty/);
  const pr = readFileSync(join(ROOT, 'skills/dybs-pr/SKILL.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(pr, /any uncommitted change other than this task's `gate\.md` and `pr\.md`/);
  assert.match(pr, /A changed `review\.md`, `test-plan\.md`, `task\.md` or context doc is a gate input/);
  const gateSkill = readFileSync(join(ROOT, 'skills/dybs-gate/SKILL.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(gateSkill, /any change other than this task's `gate\.md` and `pr\.md`/);
});

test('a <!-- inside a code fence is text: it never hides the rows after the fence', () => {
  const real = gate({ items: [full('a', 'P0'), gap('b', 'P0')] });
  const tricky = real.replace('## Items\n\n', '## Items\n\n```\n<!--\n```\n\n').replace(/(\| b \| P0 \| NONE \|[^\n]*\n)/, '$1\n-->\n');
  const parsed = parseGate(tricky);
  assert.deepEqual(parsed.problems, []);
  assert.equal(decide(parsed, TODAY).decision, 'FAIL');
});

test('a table row without a leading pipe is refused, never left uncounted', () => {
  const text = gate({ items: [full('a', 'P0')] }).replace(/(## Risks\n\n[^\n]*\n[^\n]*\n)/, '$1\nRisk | Category | P | I | Score | Status\n--- | --- | --- | --- | --- | ---\nr1 | security | 3 | 3 | 9 | open\n');
  assert.match(parseGate(text).problems.join(' '), /every table row must start with "\|"/);
  const ok = gate({ items: [full('a', 'P0')] }) + '\nA reason with an escaped \\| pipe.\n';
  assert.deepEqual(parseGate(ok).problems, []);
});

test('a level-1 heading ends a section: a table under it never counts', () => {
  const real = gate({ items: [full('a', 'P0')] });
  const table = real.match(/## Items\n\n([\s\S]*?)\n\n## Risks/)[1];
  const moved = real.replace(`## Items\n\n${table}`, `## Items\n\n# Archived gate\n\n${table}`);
  const parsed = parseGate(moved);
  assert.match(parsed.problems.join(' '), /missing "## Items" table/);
});

test('raw HTML after a list marker or quote is refused', () => {
  for (const opener of ['- <pre>', '> <div>', '1. <details>']) {
    const text = gate({ items: [full('a', 'P0')] }) + `\n${opener}\n`;
    assert.match(parseGate(text).problems.join(' '), /may not contain raw HTML/, opener);
  }
});

test('a closing run of # does not hide a duplicate gate section', () => {
  const text = gate({ items: [full('a', 'P0')] }) + '\n## Items ##\n\n| Item | Priority | Coverage | Evidence | Security |\n|---|---|---|---|---|\n| b | P0 | NONE |  | no |\n';
  assert.match(parseGate(text).problems.join(' '), /"## Items" appears more than once/);
});

test('a test location may start with a Windows drive', async () => {
  const { hasLocation } = await import('../skills/dybs-gate/scripts/dybs-gate.mjs');
  assert.ok(hasLocation('C:\\repo\\tests\\invite.test.ts:14'));
  assert.ok(hasLocation('C:/repo/tests/invite.test.ts:14'));
  assert.ok(!hasLocation('C:/repo/tests/invite.test.ts'));
  assert.ok(!hasLocation('C::14'));
});

test('an underlined (Setext) heading is refused, so it cannot end a section unseen', () => {
  const real = gate({ items: [full('a', 'P0')] });
  const table = real.match(/## Items\n\n([\s\S]*?)\n\n## Risks/)[1];
  const moved = real.replace(`## Items\n\n${table}`, `## Items\n\nArchived\n========\n\n${table}`);
  assert.match(parseGate(moved).problems.join(' '), /not underlined ones/);
  // A thematic break after a blank line is fine.
  assert.deepEqual(parseGate(real + '\n---\n').problems, []);
});

test('a heading inside a list item or quote is refused', () => {
  for (const h of ['- ## Archived', '> ## Archived', '1. # Old']) {
    const text = gate({ items: [full('a', 'P0')] }) + `\n${h}\n`;
    assert.match(parseGate(text).problems.join(' '), /headings may not sit inside a list item or a quote/, h);
  }
});

test('a waiver with template placeholders is incomplete', async () => {
  const { waiverIssue } = await import('../skills/dybs-gate/scripts/dybs-gate.mjs');
  const w = { id: 'a', reason: '{{reason}}', by: '{{name}}', approved: '2026-10-01', expires: '2026-11-01' };
  assert.match(waiverIssue(w, TODAY), /real reason/);
  assert.match(waiverIssue({ ...w, reason: 'legacy path', by: 'TBD' }, TODAY), /real reason/);
  assert.equal(waiverIssue({ ...w, reason: 'legacy path', by: 'Jos' }, TODAY), null);
});

test('tables and headings inside the frontmatter are not evidence', () => {
  const body = gate({ items: [full('a', 'P0')] }).split('\n').slice(4).map((l) => `  ${l}`);
  const text = ['---', 'task: t', 'note: "', ...body, '  "', '---', '', '# Gate: t', '', '## Decision', ''].join('\n');
  const g = parseGate(text);
  assert.equal(g.items.length, 0);
  assert.ok(g.problems.some((p) => p.includes('missing "## Items" table')));
});

test('a line of - under text ending in --> is still an underline when no comment is open', () => {
  const text = gate({ items: [full('a', 'P0')] }).replace('## Risks', 'Archived --> note\n---\n\n## Risks');
  assert.ok(parseGate(text).problems.some((p) => p.includes('underlined')));
  const ok = gate({ items: [full('a', 'P0')] }).replace('## Risks', '<!--\nnote\n-->\n---\n\n## Risks');
  assert.ok(!parseGate(ok).problems.some((p) => p.includes('underlined')));
});

test('indented table rows are refused: under a list item they still render', () => {
  const text = gate({ items: [full('a', 'P0')] }).replace('## Risks', '10. archived\n\n    | Item | Priority | Coverage | Evidence | Security |\n    |---|---|---|---|---|\n    | b | P0 | NONE |  | no |\n\n## Risks');
  assert.ok(parseGate(text).problems.some((p) => p.includes('may not be indented')));
});

test('dybs-pr: committing gate.md and pr.md never makes the gate stale', () => {
  const skill = readFileSync(join(ROOT, 'skills/dybs-pr/SKILL.md'), 'utf8');
  const spec = ":(exclude)dybs/work/<task>/gate.md";
  assert.ok(skill.includes(spec) && skill.includes(":(exclude)dybs/work/<task>/pr.md"));
  // The documented command, run for real: code commit, gate, then the gate's own commit.
  const repo = mkdtempSync(join(tmpdir(), 'dybs-pr-'));
  const git = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' }).trim();
  git('init', '-q');
  writeFileSync(join(repo, 'code.js'), 'x');
  git('add', '.'); git('commit', '-qm', 'code');
  const gateCommit = git('rev-parse', '--short', 'HEAD');
  execFileSync('mkdir', ['-p', join(repo, 'dybs/work/t')]);
  writeFileSync(join(repo, 'dybs/work/t/gate.md'), `commit: ${gateCommit}`);
  writeFileSync(join(repo, 'dybs/work/t/pr.md'), 'pr');
  git('add', '.'); git('commit', '-qm', 'gate');
  const last = () => git('log', '-1', '--format=%h', '--', '.', ':(exclude)dybs/work/t/gate.md', ':(exclude)dybs/work/t/pr.md');
  assert.equal(last(), gateCommit);
  // A real change afterwards does make it stale.
  writeFileSync(join(repo, 'code.js'), 'y');
  git('commit', '-qam', 'more code');
  assert.notEqual(last(), gateCommit);
  rmSync(repo, { recursive: true });
});

test('a waiver whose reason or approver renders as nothing is incomplete', () => {
  for (const blank of ['&nbsp;', '&#32;', '&nbsp;&nbsp;']) {
    const r = run({ items: [gap('a', 'P0')], waivers: [waiver('a', { reason: blank })] });
    assert.equal(r.decision, 'FAIL', `reason ${blank}`);
    const r2 = run({ items: [gap('a', 'P0')], waivers: [waiver('a', { by: blank })] });
    assert.equal(r2.decision, 'FAIL', `by ${blank}`);
  }
  assert.equal(run({ items: [gap('a', 'P0')], waivers: [waiver('a')] }).decision, 'WAIVED');
});

test('an indented fence (for example on a list continuation line) is refused', () => {
  const text = gate({ items: [full('a', 'P0')] }).replace('## Risks', '- archived\n  ```\n\n## Risks');
  assert.ok(parseGate(text).problems.some((p) => p.includes('code fences must start')));
});

test('more gate refusals: entity headings, deep-indented fences, link-only waivers, indented frontmatter', () => {
  const base = gate({ items: [full('a', 'P0')] });
  const has = (text, s) => parseGate(text).problems.some((p) => p.includes(s));
  assert.ok(has(base.replace('## Risks', '## I&#116;ems\n\n## Risks'), 'character references'));
  assert.ok(has(base.replace('## Risks', '- archived\n    ```\n\n## Risks'), 'code fences must start'));
  // A leading-space --- is a thematic break a reader sees, not frontmatter.
  assert.equal(visible(' ---\nx\n---\n'), ' ---\nx\n---\n');
  for (const f of [{ reason: '[](reason)' }, { by: '[](alice)' }, { by: '<span>alice</span>' }]) {
    assert.equal(run({ items: [gap('a', 'P0')], waivers: [waiver('a', f)] }).decision, 'FAIL', JSON.stringify(f));
  }
  assert.equal(run({ items: [gap('a', 'P0')], waivers: [waiver('a')] }).decision, 'WAIVED');
});

test('formatted headings and inline HTML anywhere are refused', () => {
  const base = gate({ items: [full('a', 'P0')] });
  const has = (text, s) => parseGate(text).problems.some((p) => p.includes(s));
  assert.ok(has(base.replace('## Risks', '## **Items**\n\n## Risks'), 'headings must be plain text'));
  assert.ok(has(base.replace('## Items', 'text <details>\n\n## Items').replace('## Risks', 'text </details>\n\n## Risks'), 'raw HTML'));
  // Code spans and autolinks are not tags.
  assert.ok(!has(base.replace('## Risks', 'See `<task>` and <https://dybs.it>.\n\n## Risks'), 'raw HTML'));
  assert.equal(parseGate(base).problems.length, 0);
});

test('a backtick run that finds no equal closer is no code span: the tag stays raw', () => {
  // Each line leaves <details> raw in CommonMark (checked against commonmark.js).
  for (const line of ['see `<details>`` here', 'see \\`<details>` here', 'see `x\\` <details> `', 'see ```<details>`` here']) {
    const text = gate({ items: [full('a', 'P0')] }).replace('## Items', `${line}\n\n## Items`);
    assert.match(parseGate(text).problems.join(' '), /may not contain raw HTML/, line);
  }
  // Real code spans stay text.
  for (const line of ['see `<details>` here', 'see ``a `<details>` b`` here']) {
    const text = gate({ items: [full('a', 'P0')] }).replace('## Items', `${line}\n\n## Items`);
    assert.doesNotMatch(parseGate(text).problems.join(' '), /raw HTML/, line);
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync, readFileSync, mkdirSync, realpathSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { committedGate } from './gate-repo.mjs';
import { parseGate, decide, tableUnder, headingCount, visible, waiverIssue } from '../skills/dybs-gate/scripts/dybs-gate.mjs';
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
  const gateCli = join(ROOT, 'skills/dybs-gate/scripts/dybs-gate.mjs');
  const code = (file, bin = gateCli) => { try { execFileSync('node', [bin, ...(bin === gateCli ? [] : ['gate']), file], { stdio: 'pipe' }); return 0; } catch (e) { return e.status; } };
  const repos = [];
  const write = (spec) => { const { repo, gatePath } = committedGate(typeof spec === 'string' ? spec : gate(spec)); repos.push(repo); return gatePath; };
  assert.equal(code(write({ items: [full('a', 'P0')] })), 0);
  const failing = write({ items: [gap('a', 'P0')] });
  assert.equal(code(failing), 1);
  assert.equal(code(write('# no tables')), 2);
  // the gate lives in the skill, not in the dybs-skills binary
  assert.equal(code(failing, join(ROOT, 'bin/dybs-skills.mjs')), 2);
  for (const r of repos) rmSync(r, { recursive: true });
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
  const { repo, gatePath: file } = committedGate(gate({ items: [full('a', 'P0')] }));
  const cli = join(ROOT, 'skills/dybs-gate/scripts/dybs-gate.mjs');
  const code = (args) => { try { execFileSync('node', [cli, file, ...args], { stdio: 'pipe' }); return 0; } catch (e) { return e.status; } };
  assert.equal(code(['--today', '2020-01-01']), 2);
  assert.equal(code(['--json']), 0);
  assert.equal(code([]), 0);
  rmSync(repo, { recursive: true });
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
  const { repo, gatePath } = committedGate(gate({ items: [full('a', 'P0')] }));
  const out = execFileSync('node', [join(dir, 'dybs-gate/scripts/dybs-gate.mjs'), gatePath], { encoding: 'utf8' });
  assert.match(out, /Decision: PASS/);
  rmSync(dir, { recursive: true });
  rmSync(repo, { recursive: true });
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
  const { repo, gatePath: a } = committedGate(gate({ items: [full('a', 'P0')] }));
  const other = committedGate(gate({ items: [gap('a', 'P0')] }));
  const b = other.gatePath;
  const cli = join(ROOT, 'skills/dybs-gate/scripts/dybs-gate.mjs');
  const code = (args) => { try { execFileSync('node', [cli, ...args], { stdio: 'pipe' }); return 0; } catch (e) { return e.status; } };
  assert.equal(code([a, b]), 2);
  assert.equal(code([a]), 0);
  rmSync(repo, { recursive: true });
  rmSync(other.repo, { recursive: true });
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
  const spec = ":(exclude,literal)dybs/work/<task>/gate.md";
  assert.ok(skill.includes(spec) && skill.includes(":(exclude,literal)dybs/work/<task>/pr.md"));
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
  const last = () => git('log', '-1', '--format=%h', '--', '.', ':(exclude,literal)dybs/work/t/gate.md', ':(exclude,literal)dybs/work/t/pr.md');
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

test('text starting with # but no space, or a pipe line, is no exemption from the Setext rule', () => {
  for (const above of ['#Archived', '| a | b']) {
    const real = gate({ items: [full('a', 'P0')] });
    const table = real.match(/## Items\n\n([\s\S]*?)\n\n## Risks/)[1];
    const moved = real.replace(`## Items\n\n${table}`, `## Items\n\n${above}\n---\n\n${table}`);
    assert.match(parseGate(moved).problems.join(' '), /not underlined ones/, above);
  }
});

test('an underlined heading inside a quote or list item is refused too', () => {
  for (const [above, under] of [['> Archived', '> --------'], ['> Archived', '> ===='], ['- Archived', '  ---']]) {
    const real = gate({ items: [full('a', 'P0')] });
    const table = real.match(/## Items\n\n([\s\S]*?)\n\n## Risks/)[1];
    const moved = real.replace(`## Items\n\n${table}`, `## Items\n\n${above}\n${under}\n\n${table}`);
    assert.match(parseGate(moved).problems.join(' '), /not underlined ones/, `${above} / ${under}`);
  }
});

test('item and risk ids must render as written', () => {
  for (const id of ['&nbsp;', '&#32;', '*a*', '`a`', '[a]()', '~~a~~', '_a_']) {
    const parsed = parseGate(gate({ items: [full(id, 'P0')] }));
    assert.match(parsed.problems.join(' '), /an id must be plain text/, id);
  }
  assert.doesNotMatch(parseGate(gate({ items: [full('AC1.2', 'P0'), full('FR_3', 'P1')] })).problems.join(' '), /plain text/);
});

test('an indented heading under a list item is refused', () => {
  const real = gate({ items: [full('a', 'P0')] });
  const table = real.match(/## Items\n\n([\s\S]*?)\n\n## Risks/)[1];
  const moved = real.replace(`## Items\n\n${table}`, `## Items\n\n10. list item\n    ## Archived\n\n${table}`);
  assert.match(parseGate(moved).problems.join(' '), /headings may not be indented/);
});

test('an indented underline under a list item is refused', () => {
  const real = gate({ items: [full('a', 'P0')] });
  const table = real.match(/## Items\n\n([\s\S]*?)\n\n## Risks/)[1];
  const moved = real.replace(`## Items\n\n${table}`, `## Items\n\n10. item\n\n    Archived\n    --------\n\n${table}`);
  assert.match(parseGate(moved).problems.join(' '), /not underlined ones/);
});

test('an emphasized TODO or TBD is no waiver reason or approver', () => {
  for (const v of ['_TODO_', '__TBD__']) {
    assert.match(waiverIssue({ reason: v, by: 'Alice', approved: '2026-10-01', expires: '2026-12-01' }, '2026-10-04') ?? '', /real reason/, v);
    assert.match(waiverIssue({ reason: 'ok', by: v, approved: '2026-10-01', expires: '2026-12-01' }, '2026-10-04') ?? '', /real reason/, v);
  }
});

test('the gate refuses to decide on evidence that is not the committed state gate.md names', () => {
  const repo = mkdtempSync(join(tmpdir(), 'dybs-gate-git-'));
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
  g('init', '-q'); g('config', 'user.email', 't@example.com'); g('config', 'user.name', 'T');
  // The test every FULL row cites (tests/a.test.js) is committed with the code.
  mkdirSync(join(repo, 'tests'), { recursive: true }); writeFileSync(join(repo, 'tests/a.test.js'), 'test');
  mkdirSync(join(repo, 'dybs/work/t'), { recursive: true });
  writeFileSync(join(repo, 'code.js'), 'one');
  g('add', '.'); g('commit', '-qm', 'code');
  const head = g('rev-parse', '--short=7', 'HEAD');
  const gatePath = join(repo, 'dybs/work/t/gate.md');
  const body = gate({ items: [full('a', 'P0')] });
  const withCommit = (c) => body.replace(/^---\n/, `---\ncommit: ${c}\n`);
  const run = () => { try { return { code: 0, out: execFileSync('node', [join(ROOT, 'skills/dybs-gate/scripts/dybs-gate.mjs'), gatePath], { encoding: 'utf8', stdio: 'pipe' }) }; } catch (e) { return { code: e.status, out: `${e.stdout}${e.stderr}` }; } };
  // Fresh: commit: names the evidence; gate.md itself may be uncommitted.
  writeFileSync(gatePath, withCommit(head));
  assert.equal(run().code, 0);
  // Committing gate.md moves HEAD but no evidence: still fresh.
  g('add', '.'); g('commit', '-qm', 'gate');
  assert.equal(run().code, 0);
  // The code moves on: stale until commit: is checked and updated.
  writeFileSync(join(repo, 'code.js'), 'two');
  let r = run();
  assert.equal(r.code, 3); assert.match(r.out, /STALE: uncommitted changes/);
  g('commit', '-qam', 'more code');
  r = run();
  assert.equal(r.code, 3); assert.match(r.out, /STALE: gate\.md says commit/);
  writeFileSync(gatePath, withCommit('uncommitted'));
  assert.equal(run().code, 3);
  rmSync(repo, { recursive: true });
});

test('a heading indented with a mix of spaces and a tab is refused too', () => {
  const real = gate({ items: [full('a', 'P0')] });
  const table = real.match(/## Items\n\n([\s\S]*?)\n\n## Risks/)[1];
  for (const lead of ['   \t', ' \t', '\t']) {
    const moved = real.replace(`## Items\n\n${table}`, `## Items\n\n1. item\n${lead}## Archived\n\n${table}`);
    assert.match(parseGate(moved).problems.join(' '), /headings may not be indented/, JSON.stringify(lead));
  }
});

test('compact comments <!--> and <!---> are refused', () => {
  for (const c of ['<!-->', '<!--->']) {
    const text = gate({ items: [full('a', 'P0')] }).replace('## Risks', `${c}\n\n## Risks`);
    assert.match(parseGate(text).problems.join(' '), /not <!--> or <!--->/, c);
  }
});

test('the freshness check reads non-ASCII task paths as they are', () => {
  const repo = mkdtempSync(join(tmpdir(), 'dybs-gate-git-'));
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
  g('init', '-q'); g('config', 'user.email', 't@example.com'); g('config', 'user.name', 'T');
  // The test every FULL row cites (tests/a.test.js) is committed with the code.
  mkdirSync(join(repo, 'tests'), { recursive: true }); writeFileSync(join(repo, 'tests/a.test.js'), 'test');
  mkdirSync(join(repo, 'dybs/work/café'), { recursive: true });
  writeFileSync(join(repo, 'code.js'), 'one');
  g('add', '.'); g('commit', '-qm', 'code');
  const head = g('rev-parse', '--short=7', 'HEAD');
  const gatePath = join(repo, 'dybs/work/café/gate.md');
  writeFileSync(gatePath, gate({ items: [full('a', 'P0')] }).replace(/^---\n/, `---\ncommit: ${head}\n`));
  writeFileSync(join(repo, 'dybs/work/café/pr.md'), 'draft');
  const out = execFileSync('node', [join(ROOT, 'skills/dybs-gate/scripts/dybs-gate.mjs'), gatePath], { encoding: 'utf8' });
  assert.match(out, /Decision: PASS/);
  rmSync(repo, { recursive: true });
});

test('a code span that runs over a line break is refused', () => {
  const real = gate({ items: [full('a', 'P0')] });
  const text = real.replace('## Items', 'Open `x\n` <details> `\ny` here.\n\n## Items');
  assert.match(parseGate(text).problems.join(' '), /code spans must open and close on the same line/);
  // Spans on one line, and an escaped backtick, are fine.
  assert.doesNotMatch(parseGate(real.replace('## Items', 'See `a` and \\` here.\n\n## Items')).problems.join(' '), /code spans/);
});

test('a gate.md linked outside the repository, or naming its commit only in the body, is refused', () => {
  const repo = mkdtempSync(join(tmpdir(), 'dybs-gate-git-'));
  const outside = mkdtempSync(join(tmpdir(), 'dybs-gate-outside-'));
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
  g('init', '-q'); g('config', 'user.email', 't@example.com'); g('config', 'user.name', 'T');
  // The test every FULL row cites (tests/a.test.js) is committed with the code.
  mkdirSync(join(repo, 'tests'), { recursive: true }); writeFileSync(join(repo, 'tests/a.test.js'), 'test');
  mkdirSync(join(repo, 'dybs/work/t'), { recursive: true });
  writeFileSync(join(repo, 'code.js'), 'one');
  g('add', '.'); g('commit', '-qm', 'code');
  const head = g('rev-parse', '--short=7', 'HEAD');
  const gatePath = join(repo, 'dybs/work/t/gate.md');
  const body = gate({ items: [full('a', 'P0')] });
  const run = () => { try { return { code: 0, out: execFileSync('node', [join(ROOT, 'skills/dybs-gate/scripts/dybs-gate.mjs'), gatePath], { encoding: 'utf8', stdio: 'pipe' }) }; } catch (e) { return { code: e.status, out: `${e.stdout}${e.stderr}` }; } };
  // `commit:` in the body is not the frontmatter's evidence commit.
  writeFileSync(gatePath, `${body}\ncommit: ${head}\n`);
  let r = run();
  assert.equal(r.code, 3, r.out); assert.match(r.out, /STALE/);
  // A tracked link to a gate outside the repository: Git cannot see it change.
  writeFileSync(join(outside, 'gate.md'), body.replace(/^---\n/, `---\ncommit: ${head}\n`));
  rmSync(gatePath);
  symlinkSync(join(outside, 'gate.md'), gatePath);
  g('add', '.'); g('commit', '-qm', 'gate link');
  writeFileSync(join(outside, 'gate.md'), body.replace(/^---\n/, `---\ncommit: ${g('rev-parse', '--short=7', 'HEAD')}\n`));
  r = run();
  assert.equal(r.code, 3, r.out); assert.match(r.out, /STALE/);
  rmSync(repo, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('a repository whose history holds only gate.md and pr.md is refused, never a PASS', () => {
  const repo = mkdtempSync(join(tmpdir(), 'dybs-gate-git-'));
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
  g('init', '-q'); g('config', 'user.email', 't@example.com'); g('config', 'user.name', 'T');
  mkdirSync(join(repo, 'dybs/work/t'), { recursive: true });
  const gatePath = join(repo, 'dybs/work/t/gate.md');
  writeFileSync(gatePath, gate({ items: [full('a', 'P0')] }).replace(/^---\n/, '---\ncommit: abcdef0\n'));
  g('add', '.'); g('commit', '-qm', 'gate only');
  let r;
  try { r = { code: 0, out: execFileSync('node', [join(ROOT, 'skills/dybs-gate/scripts/dybs-gate.mjs'), gatePath], { encoding: 'utf8', stdio: 'pipe' }) }; } catch (e) { r = { code: e.status, out: `${e.stdout}${e.stderr}` }; }
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /STALE: no commit holds the evidence/);
  rmSync(repo, { recursive: true });
});

test('git missing or refusing the repository is STALE inside a repository, never an unchecked PASS', () => {
  const repo = mkdtempSync(join(tmpdir(), 'dybs-gate-git-'));
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
  g('init', '-q'); g('config', 'user.email', 't@example.com'); g('config', 'user.name', 'T');
  // The test every FULL row cites (tests/a.test.js) is committed with the code.
  mkdirSync(join(repo, 'tests'), { recursive: true }); writeFileSync(join(repo, 'tests/a.test.js'), 'test');
  mkdirSync(join(repo, 'dybs/work/t'), { recursive: true });
  writeFileSync(join(repo, 'code.js'), 'one');
  g('add', '.'); g('commit', '-qm', 'code');
  const gatePath = join(repo, 'dybs/work/t/gate.md');
  writeFileSync(gatePath, gate({ items: [full('a', 'P0')] }).replace(/^---\n/, `---\ncommit: ${g('rev-parse', '--short=7', 'HEAD')}\n`));
  const run = (env) => { try { return { code: 0, out: execFileSync(process.execPath, [join(ROOT, 'skills/dybs-gate/scripts/dybs-gate.mjs'), gatePath], { encoding: 'utf8', stdio: 'pipe', env }) }; } catch (e) { return { code: e.status, out: `${e.stdout}${e.stderr}` }; } };
  // Git absent from PATH.
  let r = run({ ...process.env, PATH: '/nonexistent' });
  assert.equal(r.code, 3, r.out); assert.match(r.out, /STALE: git is not available/);
  // Git refusing the repository: safe.directory with a foreign owner.
  if (process.getuid?.() === 0) {
    execFileSync('chown', ['-R', 'nobody', repo]);
    r = run({ ...process.env, HOME: mkdtempSync(join(tmpdir(), 'dybs-home-')), GIT_CONFIG_NOSYSTEM: '1' });
    assert.equal(r.code, 3, r.out); assert.match(r.out, /STALE: git refused the repository/);
  }
  rmSync(repo, { recursive: true });
});

test('a repository git cannot read the status of is STALE, never a crash read as FAIL', () => {
  const repo = mkdtempSync(join(tmpdir(), 'dybs-gate-git-'));
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
  g('init', '-q'); g('config', 'user.email', 't@example.com'); g('config', 'user.name', 'T');
  // The test every FULL row cites (tests/a.test.js) is committed with the code.
  mkdirSync(join(repo, 'tests'), { recursive: true }); writeFileSync(join(repo, 'tests/a.test.js'), 'test');
  mkdirSync(join(repo, 'dybs/work/t'), { recursive: true });
  writeFileSync(join(repo, 'code.js'), 'one');
  g('add', '.'); g('commit', '-qm', 'code');
  const gatePath = join(repo, 'dybs/work/t/gate.md');
  writeFileSync(gatePath, gate({ items: [full('a', 'P0')] }).replace(/^---\n/, `---\ncommit: ${g('rev-parse', '--short=7', 'HEAD')}\n`));
  // A corrupt index: rev-parse still finds the repository, status cannot read it.
  writeFileSync(join(repo, '.git/index'), 'not an index');
  let r;
  try { r = { code: 0, out: execFileSync('node', [join(ROOT, 'skills/dybs-gate/scripts/dybs-gate.mjs'), gatePath], { encoding: 'utf8', stdio: 'pipe' }) }; } catch (e) { r = { code: e.status, out: `${e.stdout}${e.stderr}` }; }
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /STALE: git could not read the working tree/);
  rmSync(repo, { recursive: true });
});

test('waiver placeholders split by formatting, a second commit:, and a damaged .git are all refused', () => {
  // `T**O**DO` reads TODO; `\{\{x\}\}` reads {{x}}.
  for (const v of ['T**O**DO', 'T**B**D', 'T_O_DO', '\\{\\{name\\}\\}']) {
    assert.match(waiverIssue({ reason: v, by: 'Alice', approved: '2026-10-01', expires: '2026-12-01' }, '2026-10-04') ?? '', /real reason/, v);
    assert.match(waiverIssue({ reason: 'ok', by: v, approved: '2026-10-01', expires: '2026-12-01' }, '2026-10-04') ?? '', /real reason/, v);
  }
  const repo = mkdtempSync(join(tmpdir(), 'dybs-gate-git-'));
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
  g('init', '-q'); g('config', 'user.email', 't@example.com'); g('config', 'user.name', 'T');
  // The test every FULL row cites (tests/a.test.js) is committed with the code.
  mkdirSync(join(repo, 'tests'), { recursive: true }); writeFileSync(join(repo, 'tests/a.test.js'), 'test');
  mkdirSync(join(repo, 'dybs/work/t'), { recursive: true });
  writeFileSync(join(repo, 'code.js'), 'one');
  g('add', '.'); g('commit', '-qm', 'code');
  const head = g('rev-parse', '--short=7', 'HEAD');
  const gatePath = join(repo, 'dybs/work/t/gate.md');
  const run = () => { try { return { code: 0, out: execFileSync('node', [join(ROOT, 'skills/dybs-gate/scripts/dybs-gate.mjs'), gatePath], { encoding: 'utf8', stdio: 'pipe' }) }; } catch (e) { return { code: e.status, out: `${e.stdout}${e.stderr}` }; } };
  // Two commit: fields, the current one first.
  writeFileSync(gatePath, gate({ items: [full('a', 'P0')] }).replace(/^---\n/, `---\ncommit: ${head}\ncommit: uncommitted\n`));
  let r = run();
  assert.equal(r.code, 3, r.out); assert.match(r.out, /more than once/);
  // A damaged .git: git says "not a git repository", but one is there.
  writeFileSync(gatePath, gate({ items: [full('a', 'P0')] }).replace(/^---\n/, `---\ncommit: ${head}\n`));
  rmSync(join(repo, '.git'), { recursive: true });
  mkdirSync(join(repo, '.git'));
  r = run();
  assert.equal(r.code, 3, r.out); assert.match(r.out, /STALE: git refused the repository/);
  rmSync(repo, { recursive: true });
});

test('a code span that looks like a fence does not exempt the underline below it', () => {
  const real = gate({ items: [full('a', 'P0')] });
  const text = real.replace('## Risks', '```foo```\n---\n\n## Risks');
  assert.match(parseGate(text).problems.join(' '), /not underlined ones/);
  // A real fence line above a --- is still exempt (the --- is inside the fence or a break).
  assert.doesNotMatch(parseGate(real.replace('## Risks', '```\ncode\n```\n---\n\n## Risks')).problems.join(' '), /not underlined ones/);
});

test('a gate.md that changes while freshness is checked gets no decision', () => {
  const repo = mkdtempSync(join(tmpdir(), 'dybs-gate-git-'));
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
  g('init', '-q'); g('config', 'user.email', 't@example.com'); g('config', 'user.name', 'T');
  // The test every FULL row cites (tests/a.test.js) is committed with the code.
  mkdirSync(join(repo, 'tests'), { recursive: true }); writeFileSync(join(repo, 'tests/a.test.js'), 'test');
  mkdirSync(join(repo, 'dybs/work/t'), { recursive: true });
  writeFileSync(join(repo, 'code.js'), 'one');
  g('add', '.'); g('commit', '-qm', 'code');
  const head = g('rev-parse', '--short=7', 'HEAD');
  const gatePath = join(repo, 'dybs/work/t/gate.md');
  const withCommit = (body) => body.replace(/^---\n/, `---\ncommit: ${head}\n`);
  writeFileSync(gatePath, withCommit(gate({ items: [full('a', 'P0')] })));
  // An editor saves a blocker (atomically) while git runs.
  const bin = mkdtempSync(join(tmpdir(), 'dybs-bin-'));
  const blocked = join(bin, 'blocked.md');
  writeFileSync(blocked, withCommit(gate({ items: [gap('a', 'P0')] })));
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  writeFileSync(join(bin, 'git'), `#!/bin/sh\nif [ ! -e "${bin}/done" ]; then touch "${bin}/done"; cp "${blocked}" "${gatePath}.new"; mv "${gatePath}.new" "${gatePath}"; fi\nexec "${realGit}" "$@"\n`, { mode: 0o755 });
  let r;
  try { r = { code: 0, out: execFileSync(process.execPath, [join(ROOT, 'skills/dybs-gate/scripts/dybs-gate.mjs'), gatePath], { encoding: 'utf8', stdio: 'pipe', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } }) }; } catch (e) { r = { code: e.status, out: `${e.stdout}${e.stderr}` }; }
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /changed while/);
  rmSync(repo, { recursive: true });
  rmSync(bin, { recursive: true });
});

test('a gate.md that is not a regular file is a read error, never a hang', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dybs-gate-fifo-'));
  const gatePath = join(dir, 'gate.md');
  execFileSync('mkfifo', [gatePath]);
  let r;
  try { r = { code: 0, out: execFileSync(process.execPath, [join(ROOT, 'skills/dybs-gate/scripts/dybs-gate.mjs'), gatePath], { encoding: 'utf8', stdio: 'pipe', timeout: 5000 }) }; } catch (e) { r = { code: e.status, out: `${e.stdout}${e.stderr}`, signal: e.signal }; }
  assert.equal(r.signal ?? null, null, 'the gate must not hang');
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /not a regular file/);
  rmSync(dir, { recursive: true });
});

function gateRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'dybs-gate-git-'));
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
  g('init', '-q'); g('config', 'user.email', 't@example.com'); g('config', 'user.name', 'T');
  // The test every FULL row cites (tests/a.test.js) is committed with the code.
  mkdirSync(join(repo, 'tests'), { recursive: true }); writeFileSync(join(repo, 'tests/a.test.js'), 'test');
  mkdirSync(join(repo, 'dybs/work/t'), { recursive: true });
  writeFileSync(join(repo, 'code.js'), 'one');
  g('add', '.'); g('commit', '-qm', 'code');
  const gatePath = join(repo, 'dybs/work/t/gate.md');
  writeFileSync(gatePath, gate({ items: [full('a', 'P0')] }).replace(/^---\n/, `---\ncommit: ${g('rev-parse', '--short=7', 'HEAD')}\n`));
  return { repo, gatePath };
}
// Runs the gate with a git that first runs `script` once, on the given subcommand.
function gateWithGit(gatePath, sub, script) {
  const bin = mkdtempSync(join(tmpdir(), 'dybs-bin-'));
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  writeFileSync(join(bin, 'git'), `#!/bin/sh\ncase " $* " in *" ${sub} "*) if [ ! -e "${bin}/done" ]; then touch "${bin}/done"; ${script}; fi;; esac\nexec "${realGit}" "$@"\n`, { mode: 0o755 });
  let r;
  try { r = { code: 0, out: execFileSync(process.execPath, [join(ROOT, 'skills/dybs-gate/scripts/dybs-gate.mjs'), gatePath], { encoding: 'utf8', stdio: 'pipe', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } }) }; } catch (e) { r = { code: e.status, out: `${e.stdout}${e.stderr}` }; }
  return { r, bin };
}

test('a gate.md swapped for a link to the same bytes mid-check gets no decision', () => {
  const { repo, gatePath } = gateRepo();
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  const twin = join(outside, 'gate.md');
  writeFileSync(twin, readFileSync(gatePath, 'utf8'));
  const { r, bin } = gateWithGit(gatePath, 'status', `rm "${gatePath}"; ln -s "${twin}" "${gatePath}"`);
  assert.equal(r.code, 2, r.out);
  assert.doesNotMatch(r.out, /Decision: PASS/);
  for (const d of [repo, outside, bin]) rmSync(d, { recursive: true });
});

test('a gate.md that disappears mid-check gets no decision, not a crash read as FAIL', () => {
  const { repo, gatePath } = gateRepo();
  const { r, bin } = gateWithGit(gatePath, 'rev-parse', `rm "${gatePath}"`);
  assert.notEqual(r.code, 1, r.out);
  assert.notEqual(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /\n\s+at /, 'no stack trace');
  for (const d of [repo, bin]) rmSync(d, { recursive: true });
});

test('evidence saved while git runs is caught before any decision', () => {
  const { repo, gatePath } = gateRepo();
  const { r, bin } = gateWithGit(gatePath, 'log', `echo two > "${join(repo, 'code.js')}"`);
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /STALE/);
  for (const d of [repo, bin]) rmSync(d, { recursive: true });
});

test('changed evidence inside a submodule set to ignore = all is STALE', () => {
  const sub = mkdtempSync(join(tmpdir(), 'dybs-gate-sub-'));
  const s = (...a) => execFileSync('git', ['-C', sub, ...a], { encoding: 'utf8' }).trim();
  s('init', '-q'); s('config', 'user.email', 't@example.com'); s('config', 'user.name', 'T');
  writeFileSync(join(sub, 'lib.js'), 'one');
  s('add', '.'); s('commit', '-qm', 'lib');
  const repo = mkdtempSync(join(tmpdir(), 'dybs-gate-git-'));
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
  g('init', '-q'); g('config', 'user.email', 't@example.com'); g('config', 'user.name', 'T');
  // The test every FULL row cites (tests/a.test.js) is committed with the code.
  mkdirSync(join(repo, 'tests'), { recursive: true }); writeFileSync(join(repo, 'tests/a.test.js'), 'test');
  g('-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub, 'vendor/lib');
  g('config', '-f', '.gitmodules', 'submodule.vendor/lib.ignore', 'all');
  mkdirSync(join(repo, 'dybs/work/t'), { recursive: true });
  g('add', '.'); g('commit', '-qm', 'code');
  const gatePath = join(repo, 'dybs/work/t/gate.md');
  writeFileSync(gatePath, gate({ items: [full('a', 'P0')] }).replace(/^---\n/, `---\ncommit: ${g('rev-parse', '--short=7', 'HEAD')}\n`));
  const run = () => { try { return { code: 0, out: execFileSync(process.execPath, [join(ROOT, 'skills/dybs-gate/scripts/dybs-gate.mjs'), gatePath], { encoding: 'utf8', stdio: 'pipe' }) }; } catch (e) { return { code: e.status, out: `${e.stdout}${e.stderr}` }; } };
  assert.equal(run().code, 0);
  writeFileSync(join(repo, 'vendor/lib/lib.js'), 'two');
  const r = run();
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /vendor\/lib/);
  for (const d of [repo, sub]) rmSync(d, { recursive: true });
});

test('a task folder named with a pathspec wildcard excludes only its own gate', () => {
  const repo = mkdtempSync(join(tmpdir(), 'dybs-gate-git-'));
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
  g('init', '-q'); g('config', 'user.email', 't@example.com'); g('config', 'user.name', 'T');
  // The test every FULL row cites (tests/a.test.js) is committed with the code.
  mkdirSync(join(repo, 'tests'), { recursive: true }); writeFileSync(join(repo, 'tests/a.test.js'), 'test');
  mkdirSync(join(repo, 'dybs/work/*'), { recursive: true });
  mkdirSync(join(repo, 'dybs/work/other'), { recursive: true });
  writeFileSync(join(repo, 'code.js'), 'one');
  g('add', '.'); g('commit', '-qm', 'code');
  const old = g('rev-parse', '--short=7', 'HEAD');
  // Later evidence: another task's gate.md, committed after the code.
  writeFileSync(join(repo, 'dybs/work/other/gate.md'), 'other task');
  g('add', '.'); g('commit', '-qm', 'other task');
  const gatePath = join(repo, 'dybs/work/*/gate.md');
  writeFileSync(gatePath, gate({ items: [full('a', 'P0')] }).replace(/^---\n/, `---\ncommit: ${old}\n`));
  let r;
  try { r = { code: 0, out: execFileSync(process.execPath, [join(ROOT, 'skills/dybs-gate/scripts/dybs-gate.mjs'), gatePath], { encoding: 'utf8', stdio: 'pipe' }) }; } catch (e) { r = { code: e.status, out: `${e.stdout}${e.stderr}` }; }
  assert.equal(r.code, 3, r.out);
  rmSync(repo, { recursive: true });
});

test('a full SHA-256 commit id names the evidence', (t) => {
  const repo = mkdtempSync(join(tmpdir(), 'dybs-gate-git-'));
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
  try { g('init', '-q', '--object-format=sha256'); } catch { rmSync(repo, { recursive: true }); return t.skip('git without SHA-256 support'); }
  // The test every FULL row cites (tests/a.test.js) is committed with the code.
  mkdirSync(join(repo, 'tests'), { recursive: true }); writeFileSync(join(repo, 'tests/a.test.js'), 'test');
  g('config', 'user.email', 't@example.com'); g('config', 'user.name', 'T');
  mkdirSync(join(repo, 'dybs/work/t'), { recursive: true });
  writeFileSync(join(repo, 'code.js'), 'one');
  g('add', '.'); g('commit', '-qm', 'code');
  const full64 = g('rev-parse', 'HEAD');
  assert.equal(full64.length, 64);
  const gatePath = join(repo, 'dybs/work/t/gate.md');
  writeFileSync(gatePath, gate({ items: [full('a', 'P0')] }).replace(/^---\n/, `---\ncommit: ${full64}\n`));
  let r;
  try { r = { code: 0, out: execFileSync(process.execPath, [join(ROOT, 'skills/dybs-gate/scripts/dybs-gate.mjs'), gatePath], { encoding: 'utf8', stdio: 'pipe' }) }; } catch (e) { r = { code: e.status, out: `${e.stdout}${e.stderr}` }; }
  assert.equal(r.code, 0, r.out);
  rmSync(repo, { recursive: true });
});

test('a gate reached through a task folder link retargeted mid-check gets no decision', () => {
  const repo = mkdtempSync(join(tmpdir(), 'dybs-gate-git-'));
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
  g('init', '-q'); g('config', 'user.email', 't@example.com'); g('config', 'user.name', 'T');
  // The test every FULL row cites (tests/a.test.js) is committed with the code.
  mkdirSync(join(repo, 'tests'), { recursive: true }); writeFileSync(join(repo, 'tests/a.test.js'), 'test');
  mkdirSync(join(repo, 'dybs/work/t'), { recursive: true });
  symlinkSync('t', join(repo, 'dybs/work/link'));
  writeFileSync(join(repo, 'code.js'), 'one');
  g('add', '.'); g('commit', '-qm', 'code');
  const body = gate({ items: [full('a', 'P0')] }).replace(/^---\n/, `---\ncommit: ${g('rev-parse', '--short=7', 'HEAD')}\n`);
  writeFileSync(join(repo, 'dybs/work/t/gate.md'), body);
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  writeFileSync(join(outside, 'gate.md'), body);
  const gatePath = join(repo, 'dybs/work/link/gate.md');
  // Right after the last tree check (the fourth `git status`, after the
  // comparison with the evidence commit), the link moves to an outside folder holding the very same
  // bytes: only the folder pin can see that.
  const bin = mkdtempSync(join(tmpdir(), 'dybs-bin-'));
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  writeFileSync(join(bin, 'git'), `#!/bin/sh\n"${realGit}" "$@"\ncode=$?\ncase " $* " in *" status "*) echo x >> "${bin}/n"; if [ "$(wc -l < "${bin}/n")" -eq 4 ]; then ln -sfn "${outside}" "${join(repo, 'dybs/work/link')}"; fi;; esac\nexit $code\n`, { mode: 0o755 });
  const run = (env) => { try { return { code: 0, out: execFileSync(process.execPath, [join(ROOT, 'skills/dybs-gate/scripts/dybs-gate.mjs'), gatePath], { encoding: 'utf8', stdio: 'pipe', env }) }; } catch (e) { return { code: e.status, out: `${e.stdout}${e.stderr}` }; } };
  assert.equal(run(process.env).code, 0, 'fresh as found');
  const r = run({ ...process.env, PATH: `${bin}:${process.env.PATH}` });
  assert.equal(readFileSync(join(bin, 'n'), 'utf8').trim().split('\n').length, 4, 'moved after the last tree check');
  assert.equal(r.code, 2, r.out);
  for (const d of [repo, outside, bin]) rmSync(d, { recursive: true });
});

test('dybs-gate documents the literal exclusions the gate itself uses', () => {
  const skill = readFileSync(join(ROOT, 'skills/dybs-gate/SKILL.md'), 'utf8');
  assert.ok(skill.includes(":(exclude,literal)dybs/work/<task>/gate.md") && skill.includes(":(exclude,literal)dybs/work/<task>/pr.md"));
  assert.doesNotMatch(skill, /:\(exclude\)/);
});

test('a task folder recreated with the same inode mid-check gets no decision', async () => {
  const mod = await import('../skills/dybs-gate/scripts/dybs-gate.mjs');
  const { repo, gatePath } = gateRepo();
  const taskDir = realpathSync(dirname(gatePath));
  const real = mod.gateFs.lstat;
  let seen = 0;
  // Same device and inode on the last look, as a filesystem that reuses
  // inodes gives a recreated folder; only its birth time differs.
  mod.gateFs.lstat = (p, o) => {
    const st = real(p, o);
    if (p === taskDir && seen++ > 0) st.birthtimeNs += 1n;
    return st;
  };
  const log = console.log; const err = console.error;
  let out = '';
  console.log = (...a) => { out += a.join(' ') + '\n'; }; console.error = console.log;
  let code;
  try { code = mod.main(['node', 'dybs-gate.mjs', gatePath]); } finally { mod.gateFs.lstat = real; console.log = log; console.error = err; }
  assert.ok(seen >= 2, 'the folder was pinned twice');
  assert.notEqual(code, 0, out);
  assert.doesNotMatch(out, /Decision: PASS/);
  rmSync(repo, { recursive: true });
});

test('evidence hidden from git status by an index flag is STALE, never a PASS', () => {
  for (const flag of ['--assume-unchanged', '--skip-worktree']) {
    const { repo, gatePath } = gateRepo();
    execFileSync('git', ['-C', repo, 'update-index', flag, 'code.js']);
    writeFileSync(join(repo, 'code.js'), 'changed after the commit');
    let r;
    try { r = { code: 0, out: execFileSync(process.execPath, [join(ROOT, 'skills/dybs-gate/scripts/dybs-gate.mjs'), gatePath], { encoding: 'utf8', stdio: 'pipe' }) }; } catch (e) { r = { code: e.status, out: `${e.stdout}${e.stderr}` }; }
    assert.equal(r.code, 3, `${flag}: ${r.out}`);
    assert.match(r.out, /STALE: tracked files git status cannot see changes in/);
    rmSync(repo, { recursive: true });
  }
});

test('every quality skill honours checkins: none when it writes the test plan itself', () => {
  for (const skill of ['dybs-test-plan', 'dybs-review', 'dybs-gate', 'dybs-pr', 'dybs-tests']) {
    const t = readFileSync(join(ROOT, 'skills', skill, 'SKILL.md'), 'utf8').replace(/\s+/g, ' ');
    assert.match(t, /using the sections `quality\.md` describes\. With `checkins: none` in `dybs\/project\.md`, ask nothing: take the criteria and risks from the task and its context, use the existing seams only, and say so in the plan\./, skill);
  }
});

// --- Codex review on PR #3 (c2f0566): only the task's own gate is judged ---
test('a file that is not dybs/work/<task>/gate.md gets no decision', () => {
  const repo = mkdtempSync(join(tmpdir(), 'dybs-gate-git-'));
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
  g('init', '-q'); g('config', 'user.email', 't@example.com'); g('config', 'user.name', 'T');
  // The test every FULL row cites (tests/a.test.js) is committed with the code.
  mkdirSync(join(repo, 'tests'), { recursive: true }); writeFileSync(join(repo, 'tests/a.test.js'), 'test');
  mkdirSync(join(repo, 'dybs/work/t'), { recursive: true });
  mkdirSync(join(repo, 'notes'), { recursive: true });
  writeFileSync(join(repo, 'code.js'), 'one');
  g('add', '.'); g('commit', '-qm', 'code');
  const body = gate({ items: [full('a', 'P0')] }).replace(/^---\n/, `---\ncommit: ${g('rev-parse', '--short=7', 'HEAD')}\n`);
  const run = (p) => { try { return { code: 0, out: execFileSync('node', [join(ROOT, 'skills/dybs-gate/scripts/dybs-gate.mjs'), p], { encoding: 'utf8', stdio: 'pipe' }) }; } catch (e) { return { code: e.status, out: `${e.stdout}${e.stderr}` }; } };
  // Another name in the task folder: refused before it is read.
  const audit = join(repo, 'dybs/work/t/audit.md');
  writeFileSync(audit, body);
  let r = run(audit);
  assert.equal(r.code, 2, r.out); assert.match(r.out, /is not a gate/);
  rmSync(audit);
  // A gate.md outside dybs/work/<task>/: no decision either.
  const stray = join(repo, 'notes/gate.md');
  writeFileSync(stray, body);
  r = run(stray);
  assert.equal(r.code, 3, r.out); assert.match(r.out, /STALE: notes\/gate\.md is not a task gate/);
  rmSync(stray);
  // The task's own gate still passes.
  writeFileSync(join(repo, 'dybs/work/t/gate.md'), body);
  assert.equal(run(join(repo, 'dybs/work/t/gate.md')).code, 0);
  rmSync(repo, { recursive: true });
});

// --- Codex review on PR #3 (7e28efa): the tree is checked after the last history query ---
test('a file saved during the final history query gets no decision', () => {
  const repo = mkdtempSync(join(tmpdir(), 'dybs-gate-git-'));
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
  g('init', '-q'); g('config', 'user.email', 't@example.com'); g('config', 'user.name', 'T');
  // The test every FULL row cites (tests/a.test.js) is committed with the code.
  mkdirSync(join(repo, 'tests'), { recursive: true }); writeFileSync(join(repo, 'tests/a.test.js'), 'test');
  mkdirSync(join(repo, 'dybs/work/t'), { recursive: true });
  writeFileSync(join(repo, 'code.js'), 'one');
  g('add', '.'); g('commit', '-qm', 'code');
  const head = g('rev-parse', '--short=7', 'HEAD');
  const gatePath = join(repo, 'dybs/work/t/gate.md');
  writeFileSync(gatePath, gate({ items: [full('a', 'P0')] }).replace(/^---\n/, `---\ncommit: ${head}\n`));
  // The second `git log` (the last history query) is when the editor saves.
  const bin = mkdtempSync(join(tmpdir(), 'dybs-bin-'));
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  writeFileSync(join(bin, 'git'), `#!/bin/sh
"${realGit}" "$@"
code=$?
case " $* " in *" log "*)
  n=$(cat "${bin}/n" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "${bin}/n"
  if [ "$n" = 2 ]; then printf two > "${repo}/code.js"; fi;;
esac
exit $code
`, { mode: 0o755 });
  let r;
  try { r = { code: 0, out: execFileSync(process.execPath, [join(ROOT, 'skills/dybs-gate/scripts/dybs-gate.mjs'), gatePath], { encoding: 'utf8', stdio: 'pipe', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } }) }; } catch (e) { r = { code: e.status, out: `${e.stdout}${e.stderr}` }; }
  assert.equal(readFileSync(join(bin, 'n'), 'utf8').trim(), '2', 'the edit landed during the second history query');
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /STALE: uncommitted changes/);
  rmSync(repo, { recursive: true });
  rmSync(bin, { recursive: true });
});

// --- Codex review on PR #3 (d370ce5): ignored evidence and a commit during the last status ---
const gitRepo = () => {
  const repo = mkdtempSync(join(tmpdir(), 'dybs-gate-git-'));
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
  g('init', '-q'); g('config', 'user.email', 't@example.com'); g('config', 'user.name', 'T');
  // The test every FULL row cites (tests/a.test.js) is committed with the code.
  mkdirSync(join(repo, 'tests'), { recursive: true }); writeFileSync(join(repo, 'tests/a.test.js'), 'test');
  mkdirSync(join(repo, 'dybs/work/t'), { recursive: true });
  return { repo, g, gatePath: join(repo, 'dybs/work/t/gate.md') };
};
const runGate = (gatePath, env = process.env) => { try { return { code: 0, out: execFileSync(process.execPath, [join(ROOT, 'skills/dybs-gate/scripts/dybs-gate.mjs'), gatePath], { encoding: 'utf8', stdio: 'pipe', env }) }; } catch (e) { return { code: e.status, out: `${e.stdout}${e.stderr}` }; } };

test('a test cited as FULL evidence that git ignores gets no decision', () => {
  const { repo, g, gatePath } = gitRepo();
  writeFileSync(join(repo, '.gitignore'), 'ignored.test.js\n');
  writeFileSync(join(repo, 'code.js'), 'one');
  g('add', '.'); g('commit', '-qm', 'code');
  writeFileSync(join(repo, 'ignored.test.js'), 'test');
  const head = g('rev-parse', '--short=7', 'HEAD');
  const body = gate({ items: [full('a', 'P0')] }).replace('tests/a.test.js:1', 'ignored.test.js:1').replace(/^---\n/, `---\ncommit: ${head}\n`);
  assert.match(body, /ignored\.test\.js:1/);
  writeFileSync(gatePath, body);
  const r = runGate(gatePath);
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /STALE: cited evidence that git ignores, so no commit holds it: ignored\.test\.js/);
  // Tracked, the same test is evidence again.
  g('add', '-f', 'ignored.test.js'); g('commit', '-qm', 'test');
  writeFileSync(gatePath, body.replace(head, g('rev-parse', '--short=7', 'HEAD')));
  assert.equal(runGate(gatePath).code, 0);
  rmSync(repo, { recursive: true });
});

test('a commit made during the last status check gets no decision', () => {
  const { repo, g, gatePath } = gitRepo();
  writeFileSync(join(repo, 'app.js'), 'one');
  g('add', '.'); g('commit', '-qm', 'code');
  writeFileSync(gatePath, gate({ items: [full('a', 'P0')] }).replace(/^---\n/, `---\ncommit: ${g('rev-parse', '--short=7', 'HEAD')}\n`));
  // On the third `git status`, app.js changes and is committed first, so
  // that status sees a clean tree at the new HEAD.
  const bin = mkdtempSync(join(tmpdir(), 'dybs-bin-'));
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  writeFileSync(join(bin, 'git'), `#!/bin/sh
case " $* " in *" status "*)
  echo x >> "${bin}/n"
  if [ "$(wc -l < "${bin}/n")" -eq 3 ]; then printf two > "${repo}/app.js"; "${realGit}" -C "${repo}" commit -qam more >/dev/null; fi;;
esac
exec "${realGit}" "$@"
`, { mode: 0o755 });
  const r = runGate(gatePath, { ...process.env, PATH: `${bin}:${process.env.PATH}` });
  assert.equal(readFileSync(join(bin, 'n'), 'utf8').trim().split('\n').length, 3, 'committed during the third status');
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /STALE: the evidence changed while the gate was checking it/);
  rmSync(repo, { recursive: true });
  rmSync(bin, { recursive: true });
});

// --- Codex review on PR #3 (c5f426c): cited evidence is in the commit, as a regular file ---
test('a cited test the evidence commit does not hold gets no decision', () => {
  const { repo, g, gatePath } = gitRepo();
  writeFileSync(join(repo, 'code.js'), 'one');
  g('add', '.'); g('commit', '-qm', 'code');
  const body = gate({ items: [full('a', 'P0')] }).replace('tests/a.test.js:1', 'tests/does-not-exist.test.js:1').replace(/^---\n/, `---\ncommit: ${g('rev-parse', '--short=7', 'HEAD')}\n`);
  assert.match(body, /does-not-exist/);
  writeFileSync(gatePath, body);
  const r = runGate(gatePath);
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /STALE: cited evidence not in commit [0-9a-f]{7}: tests\/does-not-exist\.test\.js/);
  rmSync(repo, { recursive: true });
});

test('a cited test that is a link, or reached through one, gets no decision', () => {
  for (const viaFolder of [false, true]) {
    const { repo, g, gatePath } = gitRepo();
    const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
    writeFileSync(join(outside, 'a.test.js'), 'the reviewed test');
    rmSync(join(repo, 'tests'), { recursive: true });
    if (viaFolder) symlinkSync(outside, join(repo, 'tests'));
    else { mkdirSync(join(repo, 'tests')); symlinkSync(join(outside, 'a.test.js'), join(repo, 'tests/a.test.js')); }
    writeFileSync(join(repo, 'code.js'), 'one');
    g('add', '.'); g('commit', '-qm', 'code');
    writeFileSync(gatePath, gate({ items: [full('a', 'P0')] }).replace(/^---\n/, `---\ncommit: ${g('rev-parse', '--short=7', 'HEAD')}\n`));
    const r = runGate(gatePath);
    assert.equal(r.code, 3, `${viaFolder}: ${r.out}`);
    assert.match(r.out, viaFolder ? /cited evidence reached through a link, so no commit holds the test itself: tests\/a\.test\.js/ : /not a regular file in commit/);
    rmSync(repo, { recursive: true });
    rmSync(outside, { recursive: true });
  }
});

// --- Codex review on PR #3 (b789b61): every read is bound to the pinned gate ---
test('a gate read through a task folder swapped for a link during the read gets no decision', async () => {
  const mod = await import('../skills/dybs-gate/scripts/dybs-gate.mjs');
  const { renameSync } = await import('node:fs');
  const { repo, gatePath } = gateRepo();
  // The repository's real gate fails; an outside copy with the same commit passes.
  const passing = readFileSync(gatePath, 'utf8');
  writeFileSync(gatePath, passing.replace(/\| a \| P0 \| FULL \| tests\/a\.test\.js:1 \|/, '| a | P0 | NONE | none |'));
  assert.notEqual(readFileSync(gatePath, 'utf8'), passing, 'the real gate was changed to a failing one');
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  writeFileSync(join(outside, 'gate.md'), passing);
  const taskDir = dirname(gatePath);
  const real = { ...mod.gateFs };
  let swaps = 0;
  let swapped = false;
  const restore = () => { if (swapped) { rmSync(taskDir); renameSync(`${taskDir}.moved`, taskDir); swapped = false; } };
  // Every read of the gate goes through the task folder swapped for a link
  // to the outside folder, put back only when the next pin starts: pins
  // before and after see the real tree, the whole read sees the outside one.
  mod.gateFs.open = (p, flags) => {
    if (p === gatePath || p === realpathSync(gatePath)) {
      swaps++;
      swapped = true;
      renameSync(taskDir, `${taskDir}.moved`);
      symlinkSync(outside, taskDir);
    }
    return real.open(p, flags);
  };
  mod.gateFs.realpath = (p) => { restore(); return real.realpath(p); };
  const log = console.log; const err = console.error;
  let out = '';
  console.log = (...a) => { out += a.join(' ') + '\n'; }; console.error = console.log;
  let code;
  try { code = mod.main(['node', 'dybs-gate.mjs', gatePath]); } finally { restore(); Object.assign(mod.gateFs, real); console.log = log; console.error = err; }
  assert.ok(swaps >= 1, 'the gate was read through the swapped folder');
  assert.notEqual(code, 0, out);
  assert.doesNotMatch(out, /Decision: PASS/);
  rmSync(repo, { recursive: true });
  rmSync(outside, { recursive: true });
});

// --- Codex review on PR #3 (89faf4d): the cited line exists in the committed file ---
test('a cited line past the end of the committed test gets no decision', () => {
  const { repo, g, gatePath } = gitRepo();
  writeFileSync(join(repo, 'tests/a.test.js'), 'one\ntwo\nthree');
  writeFileSync(join(repo, 'code.js'), 'one');
  g('add', '.'); g('commit', '-qm', 'code');
  const head = g('rev-parse', '--short=7', 'HEAD');
  const at = (line) => gate({ items: [full('a', 'P0')] }).replace('tests/a.test.js:1', `tests/a.test.js:${line}`).replace(/^---\n/, `---\ncommit: ${head}\n`);
  writeFileSync(gatePath, at(999999));
  let r = runGate(gatePath);
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /STALE: cited evidence past the end of the file in commit [0-9a-f]{7}: tests\/a\.test\.js:999999 \(it has 3 lines\)/);
  // The last line (no newline after it) is still a line.
  writeFileSync(gatePath, at(3));
  assert.equal(runGate(gatePath).code, 0);
  writeFileSync(gatePath, at(4));
  assert.equal(runGate(gatePath).code, 3);
  rmSync(repo, { recursive: true });
});

// --- Codex review on PR #3 (a4ba4f5): ignored gate inputs, and untracked files listed one by one ---
test('a gate input that git ignores gets no decision', () => {
  for (const input of ['dybs/work/t/test-plan.md', 'dybs/context/prd.md']) {
    const { repo, g, gatePath } = gitRepo();
    writeFileSync(join(repo, '.gitignore'), `${input}\n`);
    writeFileSync(join(repo, 'code.js'), 'one');
    g('add', '.'); g('commit', '-qm', 'code');
    mkdirSync(dirname(join(repo, input)), { recursive: true });
    writeFileSync(join(repo, input), 'the plan the tables were checked against');
    writeFileSync(gatePath, gate({ items: [full('a', 'P0')] }).replace(/^---\n/, `---\ncommit: ${g('rev-parse', '--short=7', 'HEAD')}\n`));
    const r = runGate(gatePath);
    assert.equal(r.code, 3, `${input}: ${r.out}`);
    assert.match(r.out, new RegExp(`STALE: gate inputs that git ignores, so no commit holds them: ${input.replace(/[./]/g, '\\$&')}`));
    rmSync(repo, { recursive: true });
  }
});

test('the PR and gate skills list untracked files one by one', () => {
  for (const skill of ['dybs-gate', 'dybs-pr']) {
    const t = readFileSync(join(ROOT, 'skills', skill, 'SKILL.md'), 'utf8');
    assert.match(t, /`git status --porcelain --untracked-files=all`/, skill);
    assert.doesNotMatch(t, /`git status --porcelain`/, skill);
  }
});

// --- Codex review on PR #3 (a0bae56): security rows are P0; linked gate inputs get no decision ---
test('a security item below P0 is a format problem, not a decision', () => {
  for (const p of ['P1', 'P2', 'P3']) {
    const parsed = parseGate(gate({ items: [gap('auth', p, 'NONE', 'yes'), full('b', 'P2'), full('c', 'P2'), full('d', 'P2'), full('e', 'P2')] }));
    assert.match(parsed.problems.join(' '), new RegExp(`item auth: a security item is P0 \\(quality\\.md\\), not ${p}`), p);
  }
  assert.doesNotMatch(parseGate(gate({ items: [full('auth', 'P0', 'yes')] })).problems.join(' '), /security item is P0/);
});

test('a gate input that is a link gets no decision', () => {
  for (const which of ['file', 'folder']) {
    const { repo, g, gatePath } = gitRepo();
    const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
    writeFileSync(join(outside, 'test-plan.md'), 'the reviewed plan');
    if (which === 'file') symlinkSync(join(outside, 'test-plan.md'), join(repo, 'dybs/work/t/test-plan.md'));
    else { mkdirSync(join(repo, 'dybs/context'), { recursive: true }); symlinkSync(outside, join(repo, 'dybs/context/linked')); }
    writeFileSync(join(repo, 'code.js'), 'one');
    g('add', '.'); g('commit', '-qm', 'code');
    writeFileSync(gatePath, gate({ items: [full('a', 'P0')] }).replace(/^---\n/, `---\ncommit: ${g('rev-parse', '--short=7', 'HEAD')}\n`));
    const r = runGate(gatePath);
    assert.equal(r.code, 3, `${which}: ${r.out}`);
    assert.match(r.out, /STALE: gate inputs that are links/, which);
    rmSync(repo, { recursive: true });
    rmSync(outside, { recursive: true });
  }
});

// --- Codex review on PR #3 (5c2a6e6): late ignored inputs, unreadable folders, code-spanned paths ---
test('an ignored gate input added while the final diff runs gets no decision', () => {
  const { repo, g, gatePath } = gitRepo();
  mkdirSync(join(repo, 'dybs/context'), { recursive: true });
  writeFileSync(join(repo, '.gitignore'), 'late.md\n');
  g('add', '.'); g('commit', '-qm', 'code');
  writeFileSync(gatePath, gate({ items: [full('a', 'P0')] }).replace(/^---\n/, `---\ncommit: ${g('rev-parse', '--short=7', 'HEAD')}\n`));
  assert.equal(runGate(gatePath).code, 0, 'fresh before');
  const bin = mkdtempSync(join(tmpdir(), 'dybs-bin-'));
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  writeFileSync(join(bin, 'git'), `#!/bin/sh
case " $* " in *" diff "*) printf x > "${repo}/dybs/context/late.md";; esac
exec "${realGit}" "$@"
`, { mode: 0o755 });
  const r = runGate(gatePath, { ...process.env, PATH: `${bin}:${process.env.PATH}` });
  assert.ok(existsSync(join(repo, 'dybs/context/late.md')), 'created during the diff');
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /STALE: gate inputs that git ignores, so no commit holds them: dybs\/context\/late\.md/);
  rmSync(repo, { recursive: true });
  rmSync(bin, { recursive: true });
});

test('a gate input folder that cannot be read gets no decision', async () => {
  const mod = await import('../skills/dybs-gate/scripts/dybs-gate.mjs');
  const { repo, g, gatePath } = gitRepo();
  mkdirSync(join(repo, 'dybs/context/locked'), { recursive: true });
  writeFileSync(join(repo, 'dybs/context/locked/kept.md'), 'x');
  g('add', '.'); g('commit', '-qm', 'code');
  const text = gate({ items: [full('a', 'P0')] }).replace(/^---\n/, `---\ncommit: ${g('rev-parse', '--short=7', 'HEAD')}\n`);
  writeFileSync(gatePath, text);
  assert.equal(mod.freshness(gatePath, text).status, 'fresh');
  const real = mod.gateFs.readdir;
  mod.gateFs.readdir = (p, o) => {
    if (p.endsWith('/dybs/context/locked')) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
    return real(p, o);
  };
  let r;
  try { r = mod.freshness(gatePath, text); } finally { mod.gateFs.readdir = real; }
  assert.equal(r.status, 'stale');
  assert.match(r.reason, /gate input folders that cannot be read: dybs\/context\/locked \(EACCES\)/);
  rmSync(repo, { recursive: true });
});

test('a code span in evidence is one path, never its last word', async () => {
  const { evidenceTokens, hasLocation } = await import('../skills/dybs-gate/scripts/dybs-gate.mjs');
  assert.deepEqual(evidenceTokens('`tests/a b.test.js:1`'), ['tests/a b.test.js:1']);
  // As a code span, a path with a space is that path (checked whole).
  assert.ok(hasLocation('`tests/a b.test.js:1`'));
  assert.deepEqual(evidenceTokens('`tests/a.test.js:3`, tests/b.test.js:4; ``c.test.js:5``'), ['tests/a.test.js:3', 'c.test.js:5', 'tests/b.test.js:4']);
  assert.ok(hasLocation('see `tests/a.test.js:3`'));
  // As a gate: the row has no location, so FULL is refused, and the
  // unrelated root-level b.test.js is never taken as the evidence.
  const { repo, g, gatePath } = gitRepo();
  writeFileSync(join(repo, 'b.test.js'), 'test');
  g('add', '.'); g('commit', '-qm', 'code');
  const body = gate({ items: [full('a', 'P0')] }).replace('tests/a.test.js:1', '`tests/a b.test.js:1`').replace(/^---\n/, `---\ncommit: ${g('rev-parse', '--short=7', 'HEAD')}\n`);
  writeFileSync(gatePath, body);
  const r = runGate(gatePath);
  assert.notEqual(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /PASS/);
  rmSync(repo, { recursive: true });
});

// --- Codex review on PR #3 (44d4b1a): linked context root, task names, HEAD around the last look, character references ---
test('a dybs/context that is itself a link gets no decision', () => {
  const { repo, g, gatePath } = gitRepo();
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  symlinkSync(outside, join(repo, 'dybs/context'));
  g('add', '.'); g('commit', '-qm', 'code');
  writeFileSync(gatePath, gate({ items: [full('a', 'P0')] }).replace(/^---\n/, `---\ncommit: ${g('rev-parse', '--short=7', 'HEAD')}\n`));
  const r = runGate(gatePath);
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /STALE: gate inputs that are links, so the commit holds only where they point: dybs\/context/);
  rmSync(repo, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('a task folder named against the rule gets no decision, and the skill quotes its paths', () => {
  const { repo, g } = gitRepo();
  for (const name of ['a b', "it's", 'x$(touch y)', '-flag']) {
    const gatePath = join(repo, 'dybs/work', name, 'gate.md');
    mkdirSync(dirname(gatePath), { recursive: true });
    g('add', '.'); g('commit', '-qm', `code ${name}`, '--allow-empty');
    writeFileSync(gatePath, gate({ items: [full('a', 'P0')] }).replace(/^---\n/, `---\ncommit: ${g('rev-parse', '--short=7', 'HEAD')}\n`));
    const r = runGate(gatePath);
    assert.equal(r.code, 3, `${name}: ${r.out}`);
    assert.match(r.out, /is not named by the rule in quality\.md/, name);
    rmSync(dirname(gatePath), { recursive: true });
  }
  assert.ok(!existsSync(join(repo, 'y')));
  const skill = readFileSync(join(ROOT, 'skills/dybs-gate/SKILL.md'), 'utf8');
  assert.ok(skill.includes("node '<skills>/dybs-gate/scripts/dybs-gate.mjs' 'dybs/work/<task>/gate.md'"));
  const quality = readFileSync(join(ROOT, 'skills/dybs-gate/quality.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(quality, /only letters and digits \(in any script\), `\.`, `_` and `-`, and starts with a letter or digit/);
  rmSync(repo, { recursive: true });
});

test('a commit made while the last look at the tree runs gets no decision', () => {
  const { repo, g, gatePath } = gitRepo();
  writeFileSync(join(repo, 'app.js'), 'one');
  g('add', '.'); g('commit', '-qm', 'code');
  writeFileSync(gatePath, gate({ items: [full('a', 'P0')] }).replace(/^---\n/, `---\ncommit: ${g('rev-parse', '--short=7', 'HEAD')}\n`));
  // The fourth `git status` reports a clean tree, then app.js changes and
  // is committed before the gate decides.
  const bin = mkdtempSync(join(tmpdir(), 'dybs-bin-'));
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  writeFileSync(join(bin, 'git'), `#!/bin/sh
"${realGit}" "$@"
code=$?
case " $* " in *" status "*)
  echo x >> "${bin}/n"
  if [ "$(wc -l < "${bin}/n")" -eq 4 ]; then printf two > "${repo}/app.js"; "${realGit}" -C "${repo}" commit -qam more >/dev/null; fi;;
esac
exit $code
`, { mode: 0o755 });
  const r = runGate(gatePath, { ...process.env, PATH: `${bin}:${process.env.PATH}` });
  assert.equal(readFileSync(join(bin, 'n'), 'utf8').trim().split('\n').length, 4, 'committed after the fourth status');
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /STALE: the evidence changed while the gate was checking it/);
  rmSync(repo, { recursive: true });
  rmSync(bin, { recursive: true });
});

test('a character reference in evidence makes no location of its pieces', async () => {
  const { evidenceTokens, hasLocation } = await import('../skills/dybs-gate/scripts/dybs-gate.mjs');
  assert.deepEqual(evidenceTokens('tests/a&#46;test.js:1'), []);
  assert.ok(!hasLocation('tests/a&#46;test.js:1'));
  assert.ok(!hasLocation('tests/a&period;test.js:1'));
  // Inside a code span a reference is literal text, and plain lists still split.
  assert.deepEqual(evidenceTokens('`a&#46;b:1` x.test.js:2;y.test.js:3'), ['a&#46;b:1', 'x.test.js:2', 'y.test.js:3']);
  const { repo, g, gatePath } = gitRepo();
  writeFileSync(join(repo, 'test.js'), 'test');
  g('add', '.'); g('commit', '-qm', 'code');
  writeFileSync(gatePath, gate({ items: [full('a', 'P0')] }).replace('tests/a.test.js:1', 'tests/a&#46;test.js:1').replace(/^---\n/, `---\ncommit: ${g('rev-parse', '--short=7', 'HEAD')}\n`));
  const r = runGate(gatePath);
  assert.notEqual(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /PASS/);
  rmSync(repo, { recursive: true });
});

// --- Codex review on PR #3 (33798c2): backslashes in evidence, special-file inputs, merge base ---
test('evidence with a backslash is refused, never read as a folder separator', () => {
  const { repo, g, gatePath } = gitRepo();
  g('add', '.'); g('commit', '-qm', 'code');
  writeFileSync(gatePath, gate({ items: [full('a', 'P0')] }).replace('tests/a.test.js:1', 'tests\\a.test.js:1').replace(/^---\n/, `---\ncommit: ${g('rev-parse', '--short=7', 'HEAD')}\n`));
  const r = runGate(gatePath);
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /STALE: cited evidence tests\\a\.test\.js holds a backslash/);
  // A Windows drive is still outside the repository.
  writeFileSync(gatePath, gate({ items: [full('a', 'P0')] }).replace('tests/a.test.js:1', 'C:\\repo\\a.test.js:1').replace(/^---\n/, `---\ncommit: ${g('rev-parse', '--short=7', 'HEAD')}\n`));
  assert.match(runGate(gatePath).out, /is outside the repository/);
  rmSync(repo, { recursive: true });
});

test('a gate input that is a FIFO gets no decision', (t) => {
  if (process.platform === 'win32') return t.skip('no FIFOs');
  const { repo, g, gatePath } = gitRepo();
  mkdirSync(join(repo, 'dybs/context'), { recursive: true });
  writeFileSync(join(repo, 'dybs/context/prd.md'), 'x');
  g('add', '.'); g('commit', '-qm', 'code');
  execFileSync('mkfifo', [join(repo, 'dybs/context/domain.md')]);
  writeFileSync(gatePath, gate({ items: [full('a', 'P0')] }).replace(/^---\n/, `---\ncommit: ${g('rev-parse', '--short=7', 'HEAD')}\n`));
  const r = runGate(gatePath);
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /STALE: gate inputs that are not regular files or folders \(a FIFO, socket or device\), so no commit holds them: dybs\/context\/domain\.md/);
  rmSync(repo, { recursive: true });
});

test('dybs-review checks the merge base before it diffs', () => {
  const t = readFileSync(join(ROOT, 'skills/dybs-review/SKILL.md'), 'utf8').replace(/\s+/g, ' ');
  assert.ok(!t.includes('$(git merge-base'), 'no merge base by command substitution');
  assert.match(t, /When it prints no commit \(unrelated histories, such as an orphan branch\), stop and ask the human/);
});

// --- Codex review on PR #3 (b750d60): a risk status is open or mitigated, nothing else ---
test('a risk status that is not open or mitigated is a format problem, never read as open', () => {
  for (const status of ['', 'mitigatd', '{{mitigated}}', 'closed']) {
    const { problems } = parseGate(gate({ items: [full('a', 'P0')], risks: [['r1', 'technical', 2, status]] }));
    assert.ok(problems.some((p) => /risk r1: status must be open or mitigated/.test(p)), JSON.stringify(status));
    // The script gives no decision on such a gate (exit 2), never PASS.
    const { repo, gatePath } = gitRepo();
    writeFileSync(gatePath, gate({ items: [full('a', 'P0')], risks: [['r1', 'technical', 2, status]] }));
    const r = runGate(gatePath);
    assert.equal(r.code, 2, `${JSON.stringify(status)}: ${r.out}`);
    assert.doesNotMatch(r.out, /PASS/);
    rmSync(repo, { recursive: true });
  }
  for (const status of ['open', 'mitigated', 'Mitigated']) {
    assert.ok(!parseGate(gate({ items: [full('a', 'P0')], risks: [['r1', 'technical', 2, status]] })).problems.length, status);
  }
});

// --- Codex review on PR #3 (dacd71d): commas and Markdown in evidence; what the gate does not prove ---
test('a comma in a path is part of it, and Markdown-formatted evidence is no location', async () => {
  const { evidenceTokens, hasLocation } = await import('../skills/dybs-gate/scripts/dybs-gate.mjs');
  assert.deepEqual(evidenceTokens('tests/a,b.test.js:1'), ['tests/a,b.test.js:1']);
  assert.deepEqual(evidenceTokens('x.test.js:2;y.test.js:3, z.test.js:4,'), ['x.test.js:2', 'y.test.js:3', 'z.test.js:4']);
  for (const md of ['*b.test.js*:1', '**b.test.js**:1', '_b.test.js_:1', '__init__.py:3', '[b.test.js](u):1', '<b.test.js>:1', '~~b.test.js~~:1']) {
    assert.ok(!hasLocation(md), md);
  }
  assert.ok(hasLocation('`__init__.py:3`'));
  assert.ok(hasLocation('tests/test_foo.py:3'));
  // As a gate: the comma path is looked up whole, never as b.test.js.
  const { repo, g, gatePath } = gitRepo();
  writeFileSync(join(repo, 'b.test.js'), 'test');
  g('add', '.'); g('commit', '-qm', 'code');
  for (const ev of ['tests/a,b.test.js:1', '*b.test.js*:1']) {
    writeFileSync(gatePath, gate({ items: [full('a', 'P0')] }).replace('tests/a.test.js:1', ev).replace(/^---\n/, `---\ncommit: ${g('rev-parse', '--short=7', 'HEAD')}\n`));
    const r = runGate(gatePath);
    assert.notEqual(r.code, 0, `${ev}: ${r.out}`);
    assert.doesNotMatch(r.out, /PASS/, ev);
  }
  rmSync(repo, { recursive: true });
});

test('dybs-gate says what the script does not prove', () => {
  const t = readFileSync(join(ROOT, 'skills/dybs-gate/SKILL.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(t, /it does not prove the tests pass from a clean checkout, and files Git ignores \(dependencies, build output, local config\) are not looked at/);
  assert.match(t, /in a code span when the path holds a space, a comma or any Markdown character/);
});

// --- Codex review on PR #3 (cc9b8e8): a code-spanned path may hold spaces ---
test('a code-spanned test path with a space is FULL evidence, checked as written', () => {
  const { repo, g, gatePath } = gitRepo();
  writeFileSync(join(repo, 'tests/api cases.test.js'), 'test\nmore\n');
  g('add', '.'); g('commit', '-qm', 'code');
  const body = gate({ items: [full('a', 'P0')] }).replace('tests/a.test.js:1', '`tests/api cases.test.js:2`').replace(/^---\n/, `---\ncommit: ${g('rev-parse', '--short=7', 'HEAD')}\n`);
  assert.equal(parseGate(body).items[0].coverage, 'FULL');
  assert.deepEqual(parseGate(body).problems, []);
  writeFileSync(gatePath, body);
  const r = runGate(gatePath);
  assert.equal(r.code, 0, r.out);
  // Outside a code span a space separates locations: `cases.test.js:2` is
  // then checked on its own, is not in the commit, and nothing passes.
  writeFileSync(gatePath, body.replace('`tests/api cases.test.js:2`', 'tests/api cases.test.js:2'));
  const plain = runGate(gatePath);
  assert.notEqual(plain.code, 0, plain.out);
  assert.match(plain.out, /cited evidence not in commit [0-9a-f]+: cases\.test\.js/);
  rmSync(repo, { recursive: true });
});

// --- Codex review on PR #3 (704d28c): span padding, no repository, large listings ---
test('a code span shows its padding: a padded location is no location', async () => {
  const { hasLocation, evidenceTokens } = await import('../skills/dybs-gate/scripts/dybs-gate.mjs');
  assert.ok(hasLocation('` tests/a.test.js:1 `'), 'one space each side is not shown');
  assert.ok(!hasLocation('`  tests/a.test.js:1  `'));
  assert.ok(!hasLocation('`  tests/a.test.js:1`'));
  assert.deepEqual([...evidenceTokens('`  a.test.js:1  `')], [' a.test.js:1 ']);
  const { repo, gatePath } = committedGate(gate({ items: [full('a', 'P0')] }).replace('tests/a.test.js:1', '`  tests/a.test.js:1  `'));
  const r = runGate(gatePath);
  assert.notEqual(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /PASS/);
  rmSync(repo, { recursive: true });
});

test('outside a git repository the gate gives no decision', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dybs-nogit-'));
  mkdirSync(join(dir, 'dybs/work/t'), { recursive: true });
  const p = join(dir, 'dybs/work/t/gate.md');
  writeFileSync(p, gate({ items: [full('a', 'P0')] }).replace(/^---\n/, '---\ncommit: uncommitted\n'));
  const r = runGate(p);
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /STALE: the gate is not inside a git repository, so no commit holds the evidence/);
  rmSync(dir, { recursive: true });
});

test('a tracked-file listing larger than 1 MiB still gets a decision', () => {
  const files = { 'tests/a.test.js': 'test\n' };
  // About 1.3 MB of `ls-files -v -z` output.
  for (let i = 0; i < 9000; i++) files[`many/${'d'.repeat(120)}-${i}.txt`] = '';
  const { repo, gatePath } = committedGate(gate({ items: [full('a', 'P0')] }), files);
  assert.ok(execFileSync('git', ['-C', repo, 'ls-files', '-v', '-z'], { maxBuffer: 1 << 30 }).length > 1024 * 1024);
  const r = runGate(gatePath);
  assert.equal(r.code, 0, r.out);
  rmSync(repo, { recursive: true });
});

// --- Codex review on PR #3 (3c7afde): bare CR line endings, prototype names, full commit ids ---
test('a bare CR ends a line, as it does to a reader', () => {
  // `Archived<CR>---` under Items is a Setext heading: the table is no
  // longer under Items, so the gate has no Items table.
  const text = gate({ items: [full('a', 'P0')] }).replace('## Items\n\n', '## Items\n\nArchived\r---\n\n');
  assert.ok(parseGate(text).problems.some((p) => /underlined/.test(p)), JSON.stringify(parseGate(text).problems));
  // A whole file with CR line endings reads as with LF.
  const lfText = gate({ items: [full('a', 'P0')] });
  assert.deepEqual(parseGate(lfText.replace(/\n/g, '\r')).items, parseGate(lfText).items);
});

test('a Security cell naming a prototype property is no value', () => {
  for (const v of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    const p = parseGate(gate({ items: [['a', 'P1', 'NONE', '', v]] }));
    assert.ok(p.problems.some((x) => /security must be yes or no/.test(x)), v);
  }
});

test('dybs-pr compares the gate commit as a full id', () => {
  const t = readFileSync(join(ROOT, 'skills/dybs-pr/SKILL.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(t, /git log -1 --format=%H/);
  assert.match(t, /Compare full commit ids, never as written: resolve `commit:` with `git rev-parse --verify --end-of-options '<commit>\^\{commit\}'` first/);
});

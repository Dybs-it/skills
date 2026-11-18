// A question the human sends to someone else ("ask Q4: Anna: ...") waits in
// the doc's open questions as `- **Waiting on <who>** (since <date>): ...`.
// A doc with a waiting question is not accepted: the flow completes it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { validateDoc, validateProject, acceptDoc, parseWaiting, MANUAL_RULES } from '../skills/dybs-start/scripts/dybs-validate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'skills/dybs-start/scripts/dybs-validate.mjs');
const SAMPLE = join(ROOT, 'tests/fixtures/sample-project');
const PRD = readFileSync(join(SAMPLE, 'dybs/context/prd.md'), 'utf8');
const LINE = '- **Waiting on Anna** (since 2026-11-18): May we keep salaries? Ask: does finance allow storing them?';
const draft = (t) => t.replace('status: accepted', 'status: draft').replace(/^accepted: .*\n/m, '');
const withLine = (t, line = LINE) => t.replace('## Open questions\n', `## Open questions\n\n${line}\n`);
const copySample = () => { const d = mkdtempSync(join(tmpdir(), 'dybs-wait-')); cpSync(SAMPLE, d, { recursive: true }); return d; };
const edit = (dir, file, fn) => { const p = join(dir, 'dybs', file); writeFileSync(p, fn(readFileSync(p, 'utf8'))); };
const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

// --- reading the marker ---

test('a waiting line is read into who, question, since and ask', () => {
  assert.deepEqual(parseWaiting(withLine(draft(PRD))).waiting, [
    { who: 'Anna', question: 'May we keep salaries?', since: '2026-11-18', ask: 'does finance allow storing them?' },
  ]);
});

test('a doc without waiting lines has an empty waiting list, never a missing one', () => {
  const r = validateDoc('prd', draft(PRD));
  assert.deepEqual(r.waiting, []);
  assert.deepEqual(r.errors, []);
});

test('a waiting line wrapped over several lines is read whole', () => {
  const wrapped = '- **Waiting on Anna (finance)** (since 2026-11-18): May we keep\n  salaries for a year? Ask: does finance\n  allow storing them?';
  assert.deepEqual(parseWaiting(withLine(draft(PRD), wrapped)).waiting, [
    { who: 'Anna (finance)', question: 'May we keep salaries for a year?', since: '2026-11-18', ask: 'does finance allow storing them?' },
  ]);
});

test('several waiting lines, on several people, are all read in order', () => {
  const two = `${LINE}\n- **Waiting on Bas** (since 2026-11-17): Which bank? Ask: which bank the flat uses.`;
  const r = validateDoc('prd', withLine(draft(PRD), two));
  assert.deepEqual(r.waiting.map((w) => w.who), ['Anna', 'Bas']);
  assert.deepEqual(r.errors, []);
});

test('a waiting line in a comment or a code block is not a waiting question', () => {
  const hidden = `<!-- ${LINE} -->\n\n\`\`\`\n${LINE}\n\`\`\``;
  assert.deepEqual(validateDoc('prd', withLine(draft(PRD), hidden)).waiting, []);
});

test('a waiting line that is not in the exact form is an error, so the app never misses one', () => {
  for (const bad of [
    '- **Waiting on Anna**: May we keep salaries? Ask: finance', // no since
    '- **Waiting on Anna** (since 18-11-2026): May we keep salaries? Ask: finance', // not a date
    '- **Waiting on Anna** (since 2026-02-30): May we keep salaries? Ask: finance', // no such day
    '- **Waiting on Anna** (since 2026-11-18): May we keep salaries?', // no Ask:
    '- **waiting on Anna** (since 2026-11-18): May we keep salaries? Ask: finance', // wrong case
    '- **Waiting on** (since 2026-11-18): May we keep salaries? Ask: finance', // nobody
    '**Waiting on Anna** (since 2026-11-18): May we keep salaries? Ask: finance', // not a list item
  ]) {
    const r = validateDoc('prd', withLine(draft(PRD), bad));
    assert.deepEqual(r.rules, ['waiting'], bad);
    assert.match(r.errors[0], /- \*\*Waiting on <who>\*\* \(since YYYY-MM-DD\): <question> Ask: <what to ask>/, bad);
  }
});

// --- acceptance ---

test('a draft may wait on someone; an accepted doc may not', () => {
  assert.deepEqual(validateDoc('prd', withLine(draft(PRD))).errors, []);
  const r = validateDoc('prd', withLine(PRD));
  assert.deepEqual(r.rules, ['waiting']);
  assert.match(r.errors[0], /not accepted while a question waits on someone: Anna/);
});

test('--accept refuses a doc with a question waiting on someone, and accepts it once answered', () => {
  const dir = copySample();
  try {
    edit(dir, 'context/prd.md', (t) => withLine(draft(t)));
    const r = acceptDoc(dir, 'prd', '2026-11-18');
    assert.equal(r.ok, false);
    assert.match(r.errors.join('\n'), /waits on someone: Anna/);
    assert.match(readFileSync(join(dir, 'dybs/context/prd.md'), 'utf8'), /^status: draft$/m);
    edit(dir, 'context/prd.md', (t) => t.replace(`${LINE}\n`, ''));
    assert.equal(acceptDoc(dir, 'prd', '2026-11-18').ok, true);
  } finally { rmSync(dir, { recursive: true }); }
});

test('the agent\'s own assumptions never block acceptance; only waiting questions do', () => {
  const assumed = PRD.replace('## Open questions\n', '## Open questions\n\n- Reminders are weekly *(assumption)*. Is that right?\n');
  assert.deepEqual(validateDoc('prd', assumed).errors, []);
});

// --- what the validator reports ---

test('--json gives every doc a waiting array, empty when none', () => {
  const dir = copySample();
  try {
    edit(dir, 'context/prd.md', (t) => withLine(draft(t)));
    const out = JSON.parse(run([dir, '--json']).stdout);
    for (const r of out.results) assert.ok(Array.isArray(r.waiting), r.name);
    assert.deepEqual(out.results.find((r) => r.name === 'prd').waiting, [
      { who: 'Anna', question: 'May we keep salaries?', since: '2026-11-18', ask: 'does finance allow storing them?' },
    ]);
    assert.deepEqual(out.results.find((r) => r.name === 'scope').waiting, []);
  } finally { rmSync(dir, { recursive: true }); }
});

test('a missing or skipped doc still has an empty waiting array in --json', () => {
  const dir = copySample();
  try {
    rmSync(join(dir, 'dybs/context/ui.md'));
    const out = JSON.parse(run([dir, '--json']).stdout);
    const ui = out.results.find((r) => r.name === 'ui');
    assert.equal(ui.status, 'missing');
    assert.deepEqual(ui.waiting, []);
  } finally { rmSync(dir, { recursive: true }); }
});

test('the saved report carries the waiting questions too, for the app', () => {
  const dir = copySample();
  try {
    edit(dir, 'context/prd.md', (t) => withLine(draft(t)));
    assert.equal(run([dir, '--save']).status, 0);
    const rep = JSON.parse(readFileSync(join(dir, 'dybs/.validation.json'), 'utf8'));
    assert.deepEqual(rep.docs.find((d) => d.name === 'prd').waiting, [
      { who: 'Anna', question: 'May we keep salaries?', since: '2026-11-18', ask: 'does finance allow storing them?' },
    ]);
    assert.deepEqual(rep.docs.find((d) => d.name === 'scope').waiting, []);
  } finally { rmSync(dir, { recursive: true }); }
});

test('the plain report says what waits on whom', () => {
  const dir = copySample();
  try {
    edit(dir, 'context/prd.md', (t) => withLine(draft(t)));
    const r = run([dir]);
    assert.match(r.stdout, /waiting: Anna \(since 2026-11-18\): May we keep salaries\?/);
    assert.match(r.stdout, /Waiting on someone: prd: Anna \(1 question\)/);
  } finally { rmSync(dir, { recursive: true }); }
});

test('validateProject keeps waiting per doc', () => {
  const dir = copySample();
  try {
    edit(dir, 'context/prd.md', (t) => withLine(draft(t)));
    const prd = validateProject(dir).results.find((r) => r.name === 'prd');
    assert.equal(prd.waiting.length, 1);
  } finally { rmSync(dir, { recursive: true }); }
});

test('the waiting rule is a manual rule too, for checking by hand', () => {
  const rule = MANUAL_RULES.find((r) => r.id === 'waiting');
  assert.ok(rule);
  assert.match(rule.text, /`- \*\*Waiting on <who>\*\* \(since YYYY-MM-DD\): <question> Ask: <what to ask>`/);
  assert.match(rule.text, /not accepted/);
});

// --- the rules in the skills ---

const flat = (rel) => readFileSync(join(ROOT, 'skills', rel), 'utf8').replace(/\s+/g, ' ');

test('the interview gives four answers and the short forms the app sends', () => {
  const f = flat('dybs-start/interview.md');
  assert.match(f, /`Q1: accept`/);
  assert.match(f, /`Q2: <answer>`/);
  assert.match(f, /`unclear Q3` or `unclear Q3: <what is unclear>`/);
  assert.match(f, /`ask Q4: <who>: <what to ask>`/);
  assert.match(f, /`Answers to round <id> \(from Dybs\):`/);
  // Not clear: explained or reworded next round, never the recommendation.
  assert.match(f, /explain it or reword it in the next round/);
  assert.match(f, /Never take the recommendation for it/);
  // An old app's park line is read as unclear, and said so.
  assert.match(f, /`park Q3: <reason>`[^.]*is read as `unclear`/);
  // The marker form, exactly.
  assert.ok(f.includes('- **Waiting on Anna** (since 2026-11-18): May we keep salaries? Ask: does finance allow storing them?'));
  // Coming back: ask the waiting questions before anything else.
  assert.match(f, /before anything else[^.]*"Did Anna answer\?/);
  // No free "later" any more.
  assert.doesNotMatch(f, /park Q4: later/);
  assert.doesNotMatch(f, /An item the human parks/);
  assert.doesNotMatch(f, /parked R5/);
  assert.doesNotMatch(f, /parked by the human/);
});

test('the interview\'s waiting example is itself a valid waiting line', () => {
  const t = readFileSync(join(ROOT, 'skills/dybs-start/interview.md'), 'utf8');
  const line = t.split('\n').find((l) => l.startsWith('- **Waiting on'));
  assert.equal(parseWaiting(`---\ndoc: prd\n---\n${line}\n`).waiting.length, 1);
});

test('dybs-check lists waiting questions and never asks to accept a doc that has one', () => {
  const f = flat('dybs-check/SKILL.md');
  assert.match(f, /waiting on someone/i);
  assert.match(f, /Did Anna answer\?/);
  assert.match(f, /never ask for the acceptance of a doc with a waiting question/i);
  assert.doesNotMatch(f, /parked by the human/);
});

test('the method rules in dybs/ say a waiting question blocks acceptance', () => {
  assert.match(flat('dybs-start/assets/README.md'), /A doc with a question waiting on someone is not accepted until they answer/);
});

// --- review round 1 ---

test('a waiting line hidden in a checkbox, a blockquote or another bold form is reported, never missed', () => {
  for (const bad of [
    '- [ ] **Waiting on Anna** (since 2026-11-18): May we keep salaries? Ask: finance',
    '> - **Waiting on Anna** (since 2026-11-18): May we keep salaries? Ask: finance',
    '- __Waiting on Anna__ (since 2026-11-18): May we keep salaries? Ask: finance',
  ]) {
    const r = validateDoc('prd', withLine(draft(PRD), bad));
    assert.deepEqual(r.rules, ['waiting'], bad);
  }
});

test('a waiting item nested four spaces deep is still read', () => {
  const nested = `1. Money\n    ${LINE}`;
  assert.deepEqual(parseWaiting(withLine(draft(PRD), nested)).waiting.map((w) => w.who), ['Anna']);
});

test('a waiting item ends at a thematic break, a table row or a quote', () => {
  for (const after of ['---', '| a | b |', '> quoted']) {
    const [w] = parseWaiting(withLine(draft(PRD), `${LINE}\n${after}`)).waiting;
    assert.equal(w.ask, 'does finance allow storing them?', after);
  }
});

test('an unclear answer is asked again even at quick depth, never turned into an assumption', () => {
  const f = flat('dybs-start/interview.md');
  assert.match(f, /An item the human marked not clear is never an \*\(assumption\)\*/);
});

test('every skill asks about waiting questions before anything else, from step 1', () => {
  const f = flat('dybs-start/interview.md');
  const step1 = f.slice(f.indexOf('## 1. Collect first'), f.indexOf('## 2. Map what is open'));
  assert.match(step1, /\*\*Questions waiting on someone\*\*/);
  const section = f.slice(f.indexOf('## Questions waiting on someone'));
  assert.match(section, /With `checkins: none`, ask nothing: list them in the final report/);
});

test('the README no longer offers parking a question', () => {
  const t = readFileSync(join(ROOT, 'README.md'), 'utf8');
  assert.doesNotMatch(t, /parked by you with a reason/);
  assert.match(t, /answered, or waiting on someone you named/);
});

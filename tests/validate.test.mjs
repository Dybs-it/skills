import { test } from 'node:test';
import { unprivileged, UNPRIVILEGED_SKIP } from './unprivileged.mjs';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, cpSync, writeFileSync, rmSync, existsSync, symlinkSync, mkdirSync, chmodSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { DOCS, ORDER, MANUAL_RULES, validateDoc, validateProject, depthFor, acceptDoc, acceptedHash, nextStep, main, headings } from '../skills/dybs-start/scripts/dybs-validate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = join(ROOT, 'tests/fixtures/sample-project');

// Where each doc's template lives. Keeps templates and the validator contract in step.
const TEMPLATES = {
  project: 'skills/dybs-start/assets/project.md',
  prd: 'skills/dybs-prd/template.md',
  scope: 'skills/dybs-scope/template.md',
  domain: 'skills/dybs-domain/template.md',
  architecture: 'skills/dybs-architecture/template.md',
  ux: 'skills/dybs-ux/template.md',
  ui: 'skills/dybs-ui/template.md',
};

function copySample() {
  const dir = mkdtempSync(join(tmpdir(), 'dybs-'));
  cpSync(SAMPLE, dir, { recursive: true });
  return dir;
}

function edit(dir, file, fn) {
  const p = join(dir, 'dybs', file);
  writeFileSync(p, fn(readFileSync(p, 'utf8')));
}

test('every doc in ORDER has a template', () => {
  assert.deepEqual(Object.keys(TEMPLATES).sort(), [...ORDER].sort());
});

for (const name of ORDER) {
  test(`template for ${name} has every required section and fits the cap`, () => {
    const text = readFileSync(join(ROOT, TEMPLATES[name]), 'utf8');
    const r = validateDoc(name, text);
    const sectionErrors = r.errors.filter((e) => e.startsWith('missing section') || e.includes('words, cap'));
    assert.deepEqual(sectionErrors, []);
    assert.ok(r.warnings.some((w) => w.includes('placeholder')), 'a fresh template should still flag placeholders');
  });
}

test('sample project passes', () => {
  const report = validateProject(SAMPLE);
  assert.equal(report.ok, true, JSON.stringify(report.results, null, 2));
});

test('missing dybs folder is fatal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dybs-'));
  const report = validateProject(dir);
  assert.equal(report.ok, false);
  assert.match(report.fatal, /dybs-start/);
  rmSync(dir, { recursive: true });
});

test('missing section is an error', () => {
  const dir = copySample();
  edit(dir, 'context/scope.md', (t) => t.replace('## Out', '## Excluded'));
  const r = validateProject(dir).results.find((x) => x.name === 'scope');
  assert.ok(r.errors.some((e) => e.includes('"## Out"')));
  rmSync(dir, { recursive: true });
});

test('over the word cap is an error', () => {
  const dir = copySample();
  edit(dir, 'context/scope.md', (t) => t + '\n' + 'word '.repeat(DOCS.scope.maxWords.quick));
  const r = validateProject(dir).results.find((x) => x.name === 'scope');
  assert.ok(r.errors.some((e) => e.includes('cap is')));
  rmSync(dir, { recursive: true });
});

test('HTML comments do not count toward the cap', () => {
  const dir = copySample();
  edit(dir, 'context/scope.md', (t) => t + `\n<!-- ${'guidance '.repeat(DOCS.scope.maxWords.thorough)} -->\n`);
  const r = validateProject(dir).results.find((x) => x.name === 'scope');
  assert.deepEqual(r.errors, []);
  rmSync(dir, { recursive: true });
});

test('accepted without an accepted date is an error', () => {
  const dir = copySample();
  edit(dir, 'context/prd.md', (t) => t.replace(/^accepted: .*\n/m, ''));
  const r = validateProject(dir).results.find((x) => x.name === 'prd');
  assert.ok(r.errors.some((e) => e.includes('accepted: YYYY-MM-DD')));
  rmSync(dir, { recursive: true });
});

test('placeholder is a warning in a draft and an error once accepted', () => {
  const dir = copySample();
  edit(dir, 'context/ui.md', (t) => t + '\nTODO pick a font\n');
  edit(dir, 'context/ux.md', (t) => t + '\nTBD\n');
  const results = validateProject(dir).results;
  const ui = results.find((x) => x.name === 'ui');
  const ux = results.find((x) => x.name === 'ux');
  assert.deepEqual(ui.errors, []);
  assert.ok(ui.warnings.some((w) => w.includes('placeholder')));
  assert.ok(ux.errors.some((e) => e.includes('placeholder')));
  rmSync(dir, { recursive: true });
});

test('wrong doc name in frontmatter is an error', () => {
  const dir = copySample();
  edit(dir, 'context/ux.md', (t) => t.replace('doc: ux', 'doc: ui'));
  const r = validateProject(dir).results.find((x) => x.name === 'ux');
  assert.ok(r.errors.some((e) => e.includes('"doc" must be "ux"')));
  rmSync(dir, { recursive: true });
});

test('skipped docs are not required', () => {
  const dir = copySample();
  rmSync(join(dir, 'dybs/context/ui.md'));
  edit(dir, 'project.md', (t) => t.replace(/^skip:.*$/m, 'skip: ui'));
  const r = validateProject(dir).results.find((x) => x.name === 'ui');
  assert.equal(r.status, 'skipped');
  assert.equal(existsSync(join(dir, 'dybs/context/ui.md')), false);
  rmSync(dir, { recursive: true });
});

test('missing doc is reported as missing, not as an error', () => {
  const dir = copySample();
  rmSync(join(dir, 'dybs/context/domain.md'));
  const report = validateProject(dir);
  assert.equal(report.results.find((x) => x.name === 'domain').status, 'missing');
  assert.equal(report.ok, true);
  rmSync(dir, { recursive: true });
});

test('packaged README stays in step with the validator order', () => {
  const readme = readFileSync(join(ROOT, 'skills/dybs-start/assets/README.md'), 'utf8');
  assert.match(readme, new RegExp(ORDER.join(', ')));
});

test('depth: unset means quick; project depth and per-doc lists override', () => {
  assert.equal(depthFor('prd', {}), 'quick');
  assert.equal(depthFor('prd', { depth: 'thorough' }), 'thorough');
  assert.equal(depthFor('ui', { depth: 'thorough', quick: 'ui, ux' }), 'quick');
  assert.equal(depthFor('architecture', { depth: 'quick', thorough: 'architecture' }), 'thorough');
  assert.equal(depthFor('prd', { depth: 'nonsense' }), 'quick');
});

test('thorough depth allows a longer doc than quick', () => {
  const dir = copySample();
  const extra = 'word '.repeat(DOCS.scope.maxWords.quick);
  edit(dir, 'context/scope.md', (t) => t + '\n' + extra);
  const quick = validateProject(dir).results.find((x) => x.name === 'scope');
  assert.ok(quick.errors.some((e) => e.includes('quick cap')));
  edit(dir, 'project.md', (t) => t.replace(/^skip:.*$/m, 'skip:\nthorough: scope'));
  // The project setting alone does not raise the cap: the doc must say it
  // was written at thorough depth.
  const requested = validateProject(dir).results.find((x) => x.name === 'scope');
  assert.equal(requested.requestedDepth, 'thorough');
  assert.ok(requested.errors.some((e) => e.includes('quick cap')));
  edit(dir, 'context/scope.md', (t) => t.replace('status: accepted', 'status: accepted\ndepth: thorough'));
  const thorough = validateProject(dir).results.find((x) => x.name === 'scope');
  assert.deepEqual(thorough.errors, []);
  rmSync(dir, { recursive: true });
});

test('an invalid depth in a doc is an error', () => {
  const dir = copySample();
  edit(dir, 'context/prd.md', (t) => t.replace('status: accepted', 'status: accepted\ndepth: deep'));
  const r = validateProject(dir).results.find((x) => x.name === 'prd');
  assert.ok(r.errors.some((e) => e.includes('"depth"')));
  rmSync(dir, { recursive: true });
});

// Each manual rule is broken on its own in an otherwise valid doc; the
// validator must report exactly that rule. This is what keeps checking by
// hand and the validator equivalent, not just similar text.
const VALID_PRD = readFileSync(join(SAMPLE, 'dybs/context/prd.md'), 'utf8');
const VALID_PROJECT = readFileSync(join(SAMPLE, 'dybs/project.md'), 'utf8');
// Rules that only apply to project.md are broken there instead.
const BREAK_PROJECT = {
  'doc-lists': (t) => t.replace(/^skip:.*$/m, 'skip:\nthorough: archtecture'),
  'checkins': (t) => t.replace('checkins: each-doc', 'checkins: en'),
};
const BREAK = {
  'frontmatter': (t) => t.replace(/^---[\s\S]*?---\n/, ''),
  'doc-name': (t) => t.replace('doc: prd', 'doc: scope'),
  'status': (t) => t.replace('status: accepted', 'status: done'),
  'updated': (t) => t.replace(/updated: .*/, 'updated: yesterday'),
  'accepted-date': (t) => t.replace(/^accepted: .*\n/m, ''),
  'sections': (t) => t.replace('## Goals', '## Aims'),
  'depth': (t) => t.replace('status: accepted', 'status: accepted\ndepth: deep'),
  'cap': (t) => t + '\n' + 'word '.repeat(DOCS.prd.maxWords.quick),
  'accepted-hash': (t) => t.replace('status: accepted', 'status: accepted\naccepted-hash: 000000000000'),
  'html': (t) => t + '\n<div>\nhidden\n</div>\n',
  'placeholder': (t) => t + '\nTODO\n',
  ...BREAK_PROJECT,
};

test('every manual rule has a breaking fixture, and the fixtures cover nothing else', () => {
  assert.deepEqual(Object.keys(BREAK).sort(), MANUAL_RULES.map((r) => r.id).sort());
});

for (const rule of MANUAL_RULES) {
  test(`validator enforces manual rule "${rule.id}"`, () => {
    const [doc, valid] = rule.id in BREAK_PROJECT ? ['project', VALID_PROJECT] : ['prd', VALID_PRD];
    assert.deepEqual(validateDoc(doc, valid).rules, [], 'baseline must be valid');
    const r = validateDoc(doc, BREAK[rule.id](valid));
    if (rule.id === 'frontmatter') assert.ok(r.rules.includes('frontmatter'));
    else assert.deepEqual(r.rules, [rule.id]);
  });
}

test('validate reports ok, complete and accepted separately', () => {
  const report = validateProject(SAMPLE);
  assert.equal(report.ok, true);
  assert.equal(report.complete, true);
  assert.equal(report.accepted, false); // ui.md is still a draft
  const dir = copySample();
  rmSync(join(dir, 'dybs/context/ui.md'));
  const partial = validateProject(dir);
  assert.equal(partial.ok, true);
  assert.equal(partial.complete, false);
  rmSync(dir, { recursive: true });
});

// --- review findings on PR #2 ---

test('a quick doc in a thorough project needs deepening and is not reported as thorough', () => {
  const dir = copySample();
  edit(dir, 'project.md', (t) => t.replace(/^skip:.*$/m, 'skip:\ndepth: thorough'));
  edit(dir, 'context/prd.md', (t) => t.replace('status: accepted', 'status: accepted\ndepth: quick'));
  const report = validateProject(dir);
  const prd = report.results.find((x) => x.name === 'prd');
  assert.equal(prd.requestedDepth, 'thorough');
  assert.equal(prd.documentDepth, 'quick');
  assert.equal(prd.needsDeepening, true);
  assert.equal(report.atRequestedDepth, false);
  assert.ok(report.deepen.includes('prd'));
  // project.md's own depth key is the setting, never a doc to deepen
  assert.equal(report.results.find((x) => x.name === 'project').needsDeepening, false);
  rmSync(dir, { recursive: true });
});

test('a doc without a written depth is not assumed thorough', () => {
  const r = validateDoc('prd', readFileSync(join(SAMPLE, 'dybs/context/prd.md'), 'utf8'), 'thorough');
  assert.equal(r.documentDepth, null);
  assert.equal(r.needsDeepening, true);
});

test('the word cap follows the depth the doc was written at', () => {
  const long = (depth) => readFileSync(join(SAMPLE, 'dybs/context/scope.md'), 'utf8')
    .replace('status: accepted', `status: accepted\ndepth: ${depth}`) + '\n' + 'word '.repeat(DOCS.scope.maxWords.quick);
  // deepened doc in a quick project: thorough cap applies, no error
  assert.deepEqual(validateDoc('scope', long('thorough'), 'quick').rules, []);
  // quick doc in a thorough project: quick cap still applies
  assert.deepEqual(validateDoc('scope', long('quick'), 'thorough').rules, ['cap']);
});

test('deepening a single doc: listed under thorough, written thorough, nothing left to deepen', () => {
  const dir = copySample();
  edit(dir, 'project.md', (t) => t.replace(/^skip:.*$/m, 'skip:\nthorough: prd'));
  edit(dir, 'context/prd.md', (t) => t.replace('status: accepted', 'status: draft\ndepth: thorough'));
  const prd = validateProject(dir).results.find((x) => x.name === 'prd');
  assert.equal(prd.requestedDepth, 'thorough');
  assert.equal(prd.needsDeepening, false);
  rmSync(dir, { recursive: true });
});

test('acceptance lifecycle: accepted, changed, back to draft, accepted again', () => {
  const dir = copySample();
  const read = () => readFileSync(join(dir, 'dybs/context/prd.md'), 'utf8');
  const result = () => validateProject(dir).results.find((x) => x.name === 'prd');
  assert.equal(acceptDoc(dir, 'prd', '2026-10-04').ok, true);
  assert.match(read(), /^accepted-hash: [0-9a-f]{12}$/m);
  assert.deepEqual(result().errors, []);
  edit(dir, 'context/prd.md', (t) => t.replace('without having to nag', 'and get reminded'));
  assert.deepEqual(result().rules, ['accepted-hash']);
  edit(dir, 'context/prd.md', (t) => t.replace('status: accepted', 'status: draft').replace(/^accepted.*\n/gm, ''));
  assert.equal(result().status, 'draft');
  assert.deepEqual(result().errors, []);
  assert.equal(acceptDoc(dir, 'prd', '2026-10-05').ok, true);
  assert.equal(result().status, 'accepted');
  assert.deepEqual(result().errors, []);
  rmSync(dir, { recursive: true });
});

test('--accept refuses a doc that would not validate as accepted', () => {
  const dir = copySample();
  edit(dir, 'context/ui.md', (t) => t + '\nTODO pick a font\n');
  const r = acceptDoc(dir, 'ui');
  assert.equal(r.ok, false);
  assert.match(readFileSync(join(dir, 'dybs/context/ui.md'), 'utf8'), /status: draft/);
  rmSync(dir, { recursive: true });
});

test('acceptedHash ignores line endings and bookkeeping, not depth', () => {
  assert.equal(acceptedHash({}, 'a\r\nb\n'), acceptedHash({ status: 'draft', updated: '2026-01-01' }, 'a\nb\n'));
  assert.notEqual(acceptedHash({ depth: 'thorough' }, 'a'), acceptedHash({ depth: 'quick' }, 'a'));
});

// --- Codex review findings on PR #2 ---

test('a doc with no written depth gets the quick cap, even in a thorough project', () => {
  const long = VALID_PRD + '\n' + 'word '.repeat(DOCS.prd.maxWords.quick);
  assert.deepEqual(validateDoc('prd', long, 'thorough').rules, ['cap']);
});

test('changing the depth of an accepted doc breaks its acceptance', () => {
  const dir = copySample();
  edit(dir, 'context/prd.md', (t) => t.replace('status: accepted', 'status: draft\ndepth: thorough'));
  assert.equal(acceptDoc(dir, 'prd', '2026-10-04').ok, true);
  const result = () => validateProject(dir).results.find((x) => x.name === 'prd');
  assert.deepEqual(result().errors, []);
  edit(dir, 'context/prd.md', (t) => t.replace('depth: thorough', 'depth: quick'));
  assert.deepEqual(result().rules, ['accepted-hash']);
  rmSync(dir, { recursive: true });
});

test('project.md lists only known docs, and none as both quick and thorough', () => {
  const project = (extra) => validateDoc('project', VALID_PROJECT.replace(/^skip:.*$/m, `skip:\n${extra}`));
  assert.deepEqual(project('thorough: architecture, prd').rules, []);
  assert.deepEqual(validateDoc('project', VALID_PROJECT.replace(/^skip:.*$/m, 'skip: uix')).rules, ['doc-lists']);
  assert.deepEqual(project('quick: project').rules, ['doc-lists']);
  assert.deepEqual(project('quick: prd\nthorough: prd').rules, ['doc-lists']);
});

test('a flag without its doc name is a usage error, not a plain validation', () => {
  const quiet = (fn) => { const e = console.error; const l = console.log; console.error = () => {}; console.log = () => {}; try { return fn(); } finally { console.error = e; console.log = l; } };
  assert.equal(quiet(() => main(['node', 'v', SAMPLE, '--accept'])), 2);
  assert.equal(quiet(() => main(['node', 'v', SAMPLE, '--accept', '--json'])), 2);
  assert.equal(quiet(() => main(['node', 'v', SAMPLE, '--doc'])), 2);
  assert.equal(quiet(() => main(['node', 'v', SAMPLE, '--doc', 'prd'])), 0);
});

test('with check-ins at the end or none, drafts do not stop the route', () => {
  const results = [
    { name: 'project', status: 'draft', errors: [] },
    { name: 'prd', status: 'missing', errors: [] },
  ];
  assert.equal(nextStep(results, 'each-doc'), 'dybs-start'); // project.md belongs to dybs-start
  assert.equal(nextStep(results, 'end'), 'prd');
  assert.equal(nextStep(results, 'none'), 'prd');
  const dir = copySample();
  edit(dir, 'project.md', (t) => t.replace('checkins: each-doc', 'checkins: end'));
  assert.equal(validateProject(dir).checkins, 'end');
  rmSync(dir, { recursive: true });
});

// --- Codex review round 2 on PR #2 ---

const capture = (fn) => {
  const out = [];
  const { log, error } = console;
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => out.push(a.join(' '));
  try { return { code: fn(), out: out.join('\n') }; } finally { console.log = log; console.error = error; }
};

test('project.md can never skip itself', () => {
  const dir = copySample();
  edit(dir, 'project.md', (t) => t.replace(/^skip:.*$/m, 'skip: project'));
  const report = validateProject(dir);
  const project = report.results.find((x) => x.name === 'project');
  assert.notEqual(project.status, 'skipped');
  assert.deepEqual(project.rules, ['doc-lists']);
  assert.equal(report.ok, false);
  rmSync(dir, { recursive: true });
});

test('the acceptance hash covers every frontmatter setting, not the bookkeeping', () => {
  const dir = copySample();
  assert.equal(acceptDoc(dir, 'project', '2026-10-04').ok, true);
  const result = () => validateProject(dir).results.find((x) => x.name === 'project');
  assert.deepEqual(result().errors, []);
  edit(dir, 'project.md', (t) => t.replace('updated: 2026-10-04', 'updated: 2026-10-05'));
  assert.deepEqual(result().errors, []);
  edit(dir, 'project.md', (t) => t.replace('checkins: each-doc', 'checkins: end'));
  assert.deepEqual(result().rules, ['accepted-hash']);
  rmSync(dir, { recursive: true });
});

test('with checkins none, a doc that needs deepening does not block the final report', () => {
  const results = [{ name: 'prd', status: 'draft', errors: [], needsDeepening: true }];
  assert.equal(nextStep(results, 'none'), null);
  assert.equal(nextStep(results, 'end'), 'prd');
  assert.equal(nextStep(results, 'each-doc'), 'prd');
});

test('deferred drafts are never reported as accepted', () => {
  const dir = copySample();
  edit(dir, 'project.md', (t) => t.replace('checkins: each-doc', 'checkins: end'));
  const { out } = capture(() => main(['node', 'v', dir]));
  assert.doesNotMatch(out, /All Getting Started docs accepted/);
  assert.match(out, /Awaiting acceptance: ui/);
  rmSync(dir, { recursive: true });
});

test('--accept on a doc without frontmatter fails cleanly', () => {
  const dir = copySample();
  edit(dir, 'context/ui.md', (t) => t.replace(/^---[\s\S]*?---\n/, ''));
  const r = acceptDoc(dir, 'ui');
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /frontmatter/);
  assert.equal(capture(() => main(['node', 'v', dir, '--accept', 'ui'])).code, 1);
  rmSync(dir, { recursive: true });
});

test('--accept never writes through a symbolic link', () => {
  const dir = copySample();
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  const target = join(outside, 'ui.md');
  const original = readFileSync(join(dir, 'dybs/context/ui.md'), 'utf8');
  writeFileSync(target, original);
  rmSync(join(dir, 'dybs/context/ui.md'));
  symlinkSync(target, join(dir, 'dybs/context/ui.md'));
  const r = acceptDoc(dir, 'ui');
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /symbolic link/);
  assert.equal(readFileSync(target, 'utf8'), original);
  // a linked folder on the way is refused too
  const dir2 = copySample();
  const ctx = join(outside, 'context');
  cpSync(join(dir2, 'dybs/context'), ctx, { recursive: true });
  rmSync(join(dir2, 'dybs/context'), { recursive: true });
  symlinkSync(ctx, join(dir2, 'dybs/context'));
  const before = readFileSync(join(ctx, 'prd.md'), 'utf8');
  assert.equal(acceptDoc(dir2, 'prd').ok, false);
  assert.equal(readFileSync(join(ctx, 'prd.md'), 'utf8'), before);
  for (const d of [dir, dir2, outside]) rmSync(d, { recursive: true });
});

// --- Codex review round 3 on PR #2 ---

test('--doc also validates project.md, whose settings it uses', () => {
  const dir = copySample();
  assert.equal(acceptDoc(dir, 'project', '2026-10-04').ok, true);
  edit(dir, 'project.md', (t) => t.replace('checkins: each-doc', 'checkins: end'));
  const report = validateProject(dir, 'prd');
  assert.deepEqual(report.results.map((r) => r.name), ['project', 'prd']);
  assert.equal(report.ok, false);
  rmSync(dir, { recursive: true });
});

test('a placeholder left in frontmatter is caught like one in the body', () => {
  const draft = VALID_PROJECT.replace('status: accepted', 'status: draft').replace('kind: greenfield', 'kind: greenfield\ntype: {{web app | api}}');
  assert.ok(validateDoc('project', draft).warnings.some((w) => w.includes('placeholder')));
  const accepted = VALID_PROJECT.replace('kind: greenfield', 'kind: greenfield\ntype: {{web app | api}}');
  assert.deepEqual(validateDoc('project', accepted).rules, ['placeholder']);
});

test('a parked kickoff routes back to the kickoff, not to a doc', () => {
  const dir = copySample();
  edit(dir, 'project.md', (t) => t.replace('status: accepted', 'status: draft\nkickoff: parked'));
  const report = validateProject(dir);
  assert.equal(report.parked, true);
  const { out } = capture(() => main(['node', 'v', dir, '--json']));
  assert.equal(JSON.parse(out).next, 'kickoff');
  rmSync(dir, { recursive: true });
});

test('--accept keeps the doc\'s permissions', () => {
  const dir = copySample();
  const path = join(dir, 'dybs/context/prd.md');
  chmodSync(path, 0o600);
  assert.equal(acceptDoc(dir, 'prd', '2026-10-04').ok, true);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  rmSync(dir, { recursive: true });
});

// --- Codex review round 4 on PR #2 ---

test('acceptance is stamped with the local date, not the UTC one', () => {
  // Run in a zone west of UTC, where 23:30 local is already tomorrow in UTC,
  // so the test means the same on a machine set to UTC.
  const script = `import { localDate } from ${JSON.stringify(pathToFileURL(join(ROOT, 'skills/dybs-start/scripts/dybs-validate.mjs')).href)};
    console.log(localDate(new Date(2026, 9, 4, 23, 30)), localDate(new Date(2026, 9, 4, 0, 30)));`;
  const out = execFileSync('node', ['--input-type=module', '-e', script], { env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8' });
  assert.equal(out.trim(), '2026-10-04 2026-10-04');
});

test('--accept refuses while project.md, whose settings it uses, does not validate', () => {
  const dir = copySample();
  edit(dir, 'project.md', (t) => t.replace('checkins: each-doc', 'checkins: en'));
  const before = readFileSync(join(dir, 'dybs/context/prd.md'), 'utf8');
  const r = acceptDoc(dir, 'prd', '2026-10-04');
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /project\.md: "checkins"/);
  assert.equal(readFileSync(join(dir, 'dybs/context/prd.md'), 'utf8'), before);
  rmSync(dir, { recursive: true });
});

test('an accepted doc without a fingerprint is flagged as not verifiable', () => {
  const r = validateDoc('prd', VALID_PRD);
  assert.ok(r.warnings.some((w) => w.includes('without a fingerprint')));
  const dir = copySample();
  acceptDoc(dir, 'prd', '2026-10-04');
  const after = validateProject(dir).results.find((x) => x.name === 'prd');
  assert.ok(!after.warnings.some((w) => w.includes('without a fingerprint')));
  rmSync(dir, { recursive: true });
});

// --- Codex review round 5 on PR #2 ---

test('a frontmatter key that appears twice is an error, so --accept cannot be fooled', () => {
  const twice = VALID_PRD.replace('status: accepted', 'status: draft\nstatus: draft').replace(/^accepted: .*\n/m, '');
  assert.deepEqual(validateDoc('prd', twice).rules, ['frontmatter']);
  const dir = copySample();
  edit(dir, 'context/prd.md', (t) => t.replace('status: accepted', 'status: draft\nstatus: draft'));
  assert.equal(acceptDoc(dir, 'prd', '2026-10-04').ok, false);
  rmSync(dir, { recursive: true });
});

test('--accept checks project.md at its own requested depth', () => {
  const dir = copySample();
  // 300 words: over the quick cap (250), within the thorough cap (350)
  edit(dir, 'project.md', (t) => t.replace('checkins: each-doc', 'checkins: each-doc\ndepth: thorough') + '\n' + 'word '.repeat(300 - validateDoc('project', t).words));
  assert.deepEqual(validateProject(dir).results.find((x) => x.name === 'project').errors, []);
  assert.equal(acceptDoc(dir, 'prd', '2026-10-04').ok, true);
  rmSync(dir, { recursive: true });
});

test('the validator runs when called through a linked skill folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dybs-link-'));
  symlinkSync(join(ROOT, 'skills/dybs-start'), join(dir, 'dybs-start'));
  let out = '';
  try {
    out = execFileSync('node', [join(dir, 'dybs-start/scripts/dybs-validate.mjs'), SAMPLE], { encoding: 'utf8' });
  } catch (e) { out = e.stdout; }
  assert.match(out, /prd\.md/);
  rmSync(dir, { recursive: true });
});

// --- Codex review round 6 on PR #2 ---

test('a draft that keeps accepted or accepted-hash fails', () => {
  const draft = VALID_PRD.replace('status: accepted', 'status: draft');
  assert.deepEqual(validateDoc('prd', draft).rules, ['accepted-hash']);
  assert.deepEqual(validateDoc('prd', draft.replace(/^accepted: .*\n/m, '')).rules, []);
});

test('--accept with --json answers in JSON', () => {
  const dir = copySample();
  const ok = capture(() => main(['node', 'v', dir, '--accept', 'prd', '--json']));
  assert.equal(ok.code, 0);
  assert.deepEqual(JSON.parse(ok.out), { schema: 2, accept: 'prd', ok: true, errors: [], warnings: [] });
  edit(dir, 'context/ui.md', (t) => t + '\nTODO\n');
  const bad = capture(() => main(['node', 'v', dir, '--accept', 'ui', '--json']));
  assert.equal(bad.code, 1);
  assert.equal(JSON.parse(bad.out).ok, false);
  rmSync(dir, { recursive: true });
});

// --- Codex review round 7 on PR #2 ---

test('--accept refuses a doc while project.md is missing', () => {
  const dir = copySample();
  rmSync(join(dir, 'dybs/project.md'));
  const r = acceptDoc(dir, 'prd', '2026-10-04');
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /project\.md is missing/);
  rmSync(dir, { recursive: true });
});

test('a section heading inside a comment or a code fence does not count', () => {
  const hidden = (wrap) => VALID_PRD.replace('## Goals', wrap('## Goals'));
  assert.deepEqual(validateDoc('prd', hidden((h) => `<!--\n${h}\n-->`)).rules, ['sections']);
  assert.deepEqual(validateDoc('prd', hidden((h) => '```\n' + h + '\n```')).rules, ['sections']);
  assert.deepEqual(validateDoc('prd', VALID_PRD).rules, []);
});

test('a missing method README routes to dybs-start, not to a doc', () => {
  const dir = copySample();
  rmSync(join(dir, 'dybs/README.md'));
  const { out } = capture(() => main(['node', 'v', dir, '--json']));
  assert.equal(JSON.parse(out).next, 'dybs-start');
  rmSync(dir, { recursive: true });
});

test('a frontmatter line that is not key: value is an error, so no setting hides from the fingerprint', () => {
  const multi = VALID_PROJECT.replace(/^skip:.*$/m, 'skip:\nquick:\n  - prd');
  assert.deepEqual(validateDoc('project', multi).rules, ['frontmatter']);
});

test('project.md can never be skipped', () => {
  const dir = copySample();
  edit(dir, 'project.md', (t) => t.replace(/^skip:.*$/m, 'skip: project'));
  assert.notEqual(validateProject(dir).results.find((x) => x.name === 'project').status, 'skipped');
  rmSync(dir, { recursive: true });
});

// --- Codex review round 8 on PR #2 ---

test('--accept never replaces an edit saved while it ran', () => {
  const dir = copySample();
  const path = join(dir, 'dybs/context/ui.md');
  const r = acceptDoc(dir, 'ui', '2026-10-04', { beforeReplace: () => writeFileSync(path, readFileSync(path, 'utf8') + '\nedited meanwhile\n') });
  assert.equal(r.ok, false);
  assert.match(readFileSync(path, 'utf8'), /edited meanwhile/);
  assert.match(readFileSync(path, 'utf8'), /status: draft/);
  rmSync(dir, { recursive: true });
});

test('leading or trailing whitespace is part of the accepted content', () => {
  assert.notEqual(acceptedHash({}, '# PRD\n'), acceptedHash({}, '    # PRD\n'));
});

test('a four-backtick block may hold triple backticks without hiding what follows', () => {
  const withBlock = VALID_PRD.replace('## Goals', '````\n```\nexample\n```\n````\n\n## Goals');
  assert.deepEqual(validateDoc('prd', withBlock).rules, []);
  // ...and a heading after the inner ``` is still inside the block.
  assert.deepEqual(headings('````\n```\n## Hidden\n````\n\n## Shown\n'), ['Shown']);
});

test('--accept works on a filesystem without hard links', async () => {
  const mod = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  const real = mod.fsOps.link;
  mod.fsOps.link = () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); };
  try {
    const dir = copySample();
    assert.equal(mod.acceptDoc(dir, 'prd', '2026-10-04').ok, true);
    assert.match(readFileSync(join(dir, 'dybs/context/prd.md'), 'utf8'), /accepted-hash:/);
    rmSync(dir, { recursive: true });
  } finally {
    mod.fsOps.link = real;
  }
});

// --- Codex review round 9 on PR #2 ---

test('~~~ code blocks do not count toward the word cap', () => {
  const block = '\n~~~mermaid\n' + 'node '.repeat(DOCS.prd.maxWords.quick) + '\n~~~\n';
  assert.deepEqual(validateDoc('prd', VALID_PRD + block).rules, []);
});

test('--doc gives no project-wide next step', () => {
  const dir = copySample();
  rmSync(join(dir, 'dybs/context/scope.md'));
  const json = capture(() => main(['node', 'v', dir, '--doc', 'ui', '--json'])); // ui is a draft
  assert.equal(JSON.parse(json.out).next, null);
  const text = capture(() => main(['node', 'v', dir, '--doc', 'prd']));
  assert.doesNotMatch(text.out, /All docs written|Next:/);
  rmSync(dir, { recursive: true });
});

test('skip: must keep what a remaining doc needs', () => {
  const project = (skip) => validateDoc('project', VALID_PROJECT.replace(/^skip:.*$/m, `skip: ${skip}`));
  assert.deepEqual(project('ui').rules, []);
  assert.deepEqual(project('ux').rules, ['doc-lists']);
  assert.deepEqual(project('ux, ui').rules, []);
  assert.deepEqual(project('prd').rules, ['doc-lists']);
});

test('--accept puts the doc back when the final placement fails', async () => {
  const mod = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  const real = mod.fsOps.link;
  mod.fsOps.link = () => { throw Object.assign(new Error('disk gone'), { code: 'EIO' }); };
  const dir = copySample();
  const path = join(dir, 'dybs/context/prd.md');
  const before = readFileSync(path, 'utf8');
  try {
    assert.throws(() => mod.acceptDoc(dir, 'prd', '2026-10-04'), /disk gone/);
  } finally { mod.fsOps.link = real; }
  assert.equal(readFileSync(path, 'utf8'), before);
  rmSync(dir, { recursive: true });
});

test('without hard links, accept places the doc with an exclusive copy and refuses a target that appeared', async () => {
  const mod = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  const real = { ...mod.fsOps };
  mod.fsOps.link = () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); };
  const dir = mkdtempSync(join(tmpdir(), 'dybs-place-'));
  try {
    writeFileSync(join(dir, 'from'), 'new');
    mod.placeNoClobber(join(dir, 'from'), join(dir, 'to'));
    assert.equal(readFileSync(join(dir, 'to'), 'utf8'), 'new');
    // The source stays until the caller has recorded the placement.
    assert.equal(readFileSync(join(dir, 'from'), 'utf8'), 'new');
    rmSync(join(dir, 'from'));
    writeFileSync(join(dir, 'from'), 'newer');
    assert.throws(() => mod.placeNoClobber(join(dir, 'from'), join(dir, 'to')), (e) => e.code === 'EEXIST');
    assert.equal(readFileSync(join(dir, 'to'), 'utf8'), 'new');
  } finally {
    Object.assign(mod.fsOps, real);
    rmSync(dir, { recursive: true });
  }
});

test('indented code blocks are left out of the word count, list continuations are not', async () => {
  const { wordCount } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  assert.equal(wordCount('Intro words here.\n\n    alpha beta gamma delta\n    epsilon zeta\n\nAfter.'), 4);
  assert.equal(wordCount('Para line\n    continued here'), 4);
  assert.equal(wordCount('- item one\n\n    more of item\n'), 5);
});

test('placeholders after an unclosed HTML comment are ignored', () => {
  const dir = copySample();
  edit(dir, 'context/prd.md', (t) => t + '\n<!-- guidance that never closes\nTODO fill this in\n');
  const r = validateProject(dir).results.find((x) => x.name === 'prd');
  assert.ok(!r.warnings.some((w) => w.includes('placeholder')) && !r.errors.some((e) => e.includes('placeholder')));
  rmSync(dir, { recursive: true });
});

test('--accept refuses a doc whose required input is missing or invalid', () => {
  const dir = copySample();
  assert.equal(acceptDoc(dir, 'ui').ok, true, 'the sample ui doc is acceptable while ux.md is there');
  edit(dir, 'context/ui.md', (t) => t.replace('status: accepted', 'status: draft').replace(/^accepted.*\n/gm, ''));
  rmSync(join(dir, 'dybs/context/ux.md'));
  const r = acceptDoc(dir, 'ui');
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /ux\.md is missing/);
  assert.match(readFileSync(join(dir, 'dybs/context/ui.md'), 'utf8'), /status: draft/);
  rmSync(dir, { recursive: true });
  const bad = copySample();
  writeFileSync(join(bad, 'dybs/context/ux.md'), 'no frontmatter\n');
  assert.equal(acceptDoc(bad, 'ui').ok, false);
  rmSync(bad, { recursive: true });
});

test('validate refuses unknown options and a second folder', () => {
  const quiet = (fn) => { const e = console.error; const l = console.log; console.error = () => {}; console.log = () => {}; try { return fn(); } finally { console.error = e; console.log = l; } };
  const dir = copySample();
  assert.equal(quiet(() => main(['node', 'v', dir, '--accpet', 'ui'])), 2);
  assert.equal(quiet(() => main(['node', 'v', dir, dir])), 2);
  assert.equal(quiet(() => main(['node', 'v', dir, '-x'])), 2);
  assert.equal(quiet(() => main(['node', 'v', dir, '--verbose'])), 2);
  assert.equal(quiet(() => main(['node', 'v', '--jsno'])), 2);
  assert.match(readFileSync(join(dir, 'dybs/context/ui.md'), 'utf8'), /status: draft/);
  assert.equal(quiet(() => main(['node', 'v', dir, '--json'])), 0);
  rmSync(dir, { recursive: true });
});

test('dybs-start repairs a partial setup before routing', () => {
  const skill = readFileSync(join(ROOT, 'skills/dybs-start/SKILL.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(skill, /No `dybs\/project\.md`: the kickoff never finished/);
  assert.match(skill, /No `dybs\/README\.md` or `dybs\/team\.md`: copy the missing one from `assets\/`/);
});

test('tilde fences and indented code blocks are left out of the word count', async () => {
  const { wordCount } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  assert.equal(wordCount('one two\n\n~~~\nthree four five\n~~~\n'), 2);
  assert.equal(wordCount('one two\n\n    three four five\n'), 2);
});

test('a literal <!-- inside code is text, not a comment that hides the rest', async () => {
  const { wordCount, headings } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  const fenced = '## A\n\n```html\n<!-- start\n```\n\n## B\n\nafter words here';
  assert.deepEqual(headings(fenced), ['A', 'B']);
  assert.equal(wordCount(fenced), 5);
  const span = '## A\n\nUse `<!--` to open a comment.\n\n## B\n';
  assert.deepEqual(headings(span), ['A', 'B']);
  const real = '## A\n\n<!-- hidden\n## Hidden\n-->\n## B\n';
  assert.deepEqual(headings(real), ['A', 'B']);
});

test('frontmatter dates must exist in the calendar', () => {
  const dir = copySample();
  edit(dir, 'context/prd.md', (t) => t.replace(/^updated: .*$/m, 'updated: 2026-99-99'));
  const r = validateProject(dir).results.find((x) => x.name === 'prd');
  assert.ok(r.rules.includes('updated'));
  edit(dir, 'context/prd.md', (t) => t.replace(/^updated: .*$/m, 'updated: 2026-10-01').replace(/^accepted: .*$/m, 'accepted: 2026-02-31'));
  const r2 = validateProject(dir).results.find((x) => x.name === 'prd');
  assert.ok(r2.rules.includes('accepted-date'));
  rmSync(dir, { recursive: true });
});

test('placeholders after a literal <!-- in code still count; placeholders in code count too', () => {
  const dir = copySample();
  edit(dir, 'context/prd.md', (t) => t + '\n```html\n<!-- example\n```\n\nTODO decide this\n');
  const r = validateProject(dir).results.find((x) => x.name === 'prd');
  assert.ok(r.rules.includes('placeholder'));
  const dir2 = copySample();
  edit(dir2, 'context/prd.md', (t) => t + '\n```\nTODO in code\n```\n');
  assert.ok(validateProject(dir2).results.find((x) => x.name === 'prd').rules.includes('placeholder'));
  rmSync(dir, { recursive: true });
  rmSync(dir2, { recursive: true });
});

test('--accept --json reports an operational failure as JSON', async () => {
  const mod = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  const real = mod.fsOps.link;
  mod.fsOps.link = () => { throw Object.assign(new Error('EIO: i/o error'), { code: 'EIO' }); };
  const dir = copySample();
  const logs = [];
  const l = console.log; const e = console.error;
  console.log = (m) => logs.push(m); console.error = () => {};
  let code;
  try { code = main(['node', 'v', dir, '--accept', 'ui', '--json']); } finally { console.log = l; console.error = e; mod.fsOps.link = real; }
  assert.equal(code, 1);
  const out = JSON.parse(logs.join('\n'));
  assert.equal(out.ok, false);
  assert.equal(out.accept, 'ui');
  assert.match(out.errors.join(' '), /EIO/);
  // The failed accept left the doc as it was. With links failing, the
  // original cannot even be moved aside, so nothing changed at all.
  assert.match(readFileSync(join(dir, 'dybs/context/ui.md'), 'utf8'), /status: draft/);
  const { readdirSync } = await import('node:fs');
  assert.deepEqual(readdirSync(join(dir, 'dybs/context')).filter((n) => n.includes('.dybs-')), []);
  rmSync(dir, { recursive: true });
});

test('--accept never reuses the name of a kept old version', async () => {
  const dir = copySample();
  const kept = join(dir, 'dybs/context', `ui.md.dybs-${process.pid}.old`);
  writeFileSync(kept, 'an edit kept by an earlier run');
  assert.equal(acceptDoc(dir, 'ui', '2026-10-04').ok, true);
  assert.equal(readFileSync(kept, 'utf8'), 'an edit kept by an earlier run');
  rmSync(dir, { recursive: true });
});

test('a failure removing the temporary copy after placement is rolled back', async () => {
  const mod = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  const dir = copySample();
  const before = readFileSync(join(dir, 'dybs/context/ui.md'), 'utf8');
  const real = mod.fsOps.rm;
  mod.fsOps.rm = () => { throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' }); };
  try {
    assert.throws(() => acceptDoc(dir, 'ui', '2026-10-04'), /EBUSY/);
  } finally { mod.fsOps.rm = real; }
  assert.equal(readFileSync(join(dir, 'dybs/context/ui.md'), 'utf8'), before);
  rmSync(dir, { recursive: true });
});

test('dybs-start carries the generated manual contract for checking without Node', async () => {
  const { rulesBlock, checklistsBlock, contractBlock } = await import('../scripts/sync-rules.mjs');
  const skill = readFileSync(join(ROOT, 'skills/dybs-start/SKILL.md'), 'utf8');
  assert.ok(skill.includes(rulesBlock()));
  assert.ok(skill.includes(checklistsBlock()));
  // The sections and caps the rules refer to, for every doc.
  assert.ok(skill.includes(contractBlock()));
  for (const n of ORDER) assert.ok(skill.includes(`| \`${n}\` | \`dybs/${DOCS[n].file}\` | ${DOCS[n].sections.join(', ')} |`), n);
  assert.match(skill, /without\s+Node, check every doc against \*\*Checking by hand\*\*/);
});

test('fences in a block quote or a list item are code; an unclosed comment hides its placeholder', async () => {
  const { wordCount } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  assert.equal(wordCount('one two\n\n> ```\n> three four five\n> ```\n'), 2);
  assert.equal(wordCount('one two\n\n- ```js\n  three four five\n  ```\n'), 2);
  const dir = copySample();
  edit(dir, 'context/prd.md', (t) => t + '\n<!-- TODO never closed\n');
  const r = validateProject(dir).results.find((x) => x.name === 'prd');
  assert.ok(!r.rules.includes('placeholder'));
  rmSync(dir, { recursive: true });
});

test('an escaped <!-- is visible text, so its words count', async () => {
  const { wordCount } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  assert.equal(wordCount('one \\<!-- two three --> four'), 4);
  assert.equal(wordCount('one <!-- two three --> four'), 2);
  assert.equal(wordCount('one \\\\<!-- two three --> four'), 2);
});

test('checkins: none refuses any thorough doc', () => {
  const project = (extra) => {
    const dir = copySample();
    edit(dir, 'project.md', (t) => t.replace('checkins: each-doc', `checkins: none${extra}`));
    const r = validateProject(dir).results.find((x) => x.name === 'project');
    rmSync(dir, { recursive: true });
    return r;
  };
  assert.ok(!project('').rules.includes('checkins'), project('').errors.join('; '));
  assert.ok(project('\nthorough: prd').rules.includes('checkins'));
  assert.ok(project('\ndepth: thorough').rules.includes('checkins'));
  assert.ok(!project('\ndepth: thorough\nquick: prd, scope, domain, architecture, ux, ui').rules.includes('checkins'));
});

test('--doc and --accept may each appear once, and not together', () => {
  const quiet = (fn) => { const e = console.error; const l = console.log; console.error = () => {}; console.log = () => {}; try { return fn(); } finally { console.error = e; console.log = l; } };
  const dir = copySample();
  assert.equal(quiet(() => main(['node', 'v', dir, '--accept', 'ui', '--accept', 'prd'])), 2);
  assert.equal(quiet(() => main(['node', 'v', dir, '--doc', 'ui', '--doc', 'prd'])), 2);
  assert.equal(quiet(() => main(['node', 'v', dir, '--doc', 'prd', '--accept', 'ui'])), 2);
  assert.match(readFileSync(join(dir, 'dybs/context/ui.md'), 'utf8'), /status: draft/);
  rmSync(dir, { recursive: true });
});

test('dybs-start recovers a missing log before routing', () => {
  const skill = readFileSync(join(ROOT, 'skills/dybs-start/SKILL.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(skill, /No `dybs\/log\.md`: the decisions behind the docs are gone/);
  assert.match(skill, /never route on without it/);
});

test('a closing run of # is not part of a heading', async () => {
  const { headings } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  assert.deepEqual(headings('## Goals ##\n\n## Now #\n\n## C# basics\n'), ['Goals', 'Now', 'C# basics']);
});

test('--json reports a read failure as JSON', async () => {
  const { main } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  const { mkdirSync } = await import('node:fs');
  const dir = copySample();
  rmSync(join(dir, 'dybs/project.md'));
  mkdirSync(join(dir, 'dybs/project.md'));
  const logs = [];
  const l = console.log; const e = console.error;
  console.log = (m) => logs.push(m); console.error = () => {};
  let code;
  try { code = main(['node', 'v', dir, '--json']); } finally { console.log = l; console.error = e; }
  assert.equal(code, 1);
  const out = JSON.parse(logs.join('\n'));
  assert.equal(out.ok, false);
  assert.match(out.fatal, /could not read/);
  rmSync(dir, { recursive: true });
});

test('the validator runs when called through a linked skill folder', async () => {
  const { execFileSync } = await import('node:child_process');
  const { symlinkSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'dybs-link-'));
  symlinkSync(join(ROOT, 'skills/dybs-start'), join(dir, 'dybs-start'));
  let out = '';
  try {
    out = execFileSync('node', [join(dir, 'dybs-start/scripts/dybs-validate.mjs'), join(ROOT, 'tests/fixtures/sample-project')], { encoding: 'utf8' });
  } catch (e) { out = e.stdout; }
  assert.match(out, /prd\.md/);
  rmSync(dir, { recursive: true });
});

test('a code span across lines keeps <!-- literal, so a TODO in it still counts', () => {
  const dir = copySample();
  edit(dir, 'context/prd.md', (t) => t + '\nSee `example <!-- TODO -->\ncontinued` here.\n');
  const r = validateProject(dir).results.find((x) => x.name === 'prd');
  assert.ok(r.rules.includes('placeholder'));
  rmSync(dir, { recursive: true });
});

test('a comment that starts a line ends the paragraph, so a code span cannot reach past it', () => {
  // CommonMark (and GitHub): an HTML comment block interrupts a paragraph,
  // so this renders `See \`example`, a comment, then `continued\` here.`.
  const dir = copySample();
  edit(dir, 'context/prd.md', (t) => t + '\nSee `example\n<!-- TODO -->\ncontinued` here.\n');
  const r = validateProject(dir).results.find((x) => x.name === 'prd');
  assert.ok(!r.rules.includes('placeholder'));
  rmSync(dir, { recursive: true });
});

test('a backtick never closed in its paragraph is literal, so a later comment still hides', async () => {
  const { wordCount } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  assert.equal(wordCount('one ` two\n\n<!-- three four -->\nfive `'), 3);
  assert.equal(wordCount('one ` two <!-- hidden -->\n\nthree `'), 3);
});

test('raw HTML blocks are refused; comments, code and autolinks are fine', () => {
  const dir = copySample();
  edit(dir, 'project.md', (t) => t + '\n<pre>\n## Why\n</pre>\n');
  const r = validateProject(dir).results.find((x) => x.name === 'project');
  assert.ok(r.rules.includes('html'));
  const ok = copySample();
  edit(ok, 'project.md', (t) => t + '\n<!-- note -->\n\n```html\n<div>x</div>\n```\n\nSee <https://dybs.it>.\n');
  assert.ok(!validateProject(ok).results.find((x) => x.name === 'project').rules.includes('html'));
  rmSync(dir, { recursive: true });
  rmSync(ok, { recursive: true });
});

test('a fence in a multi-digit list item closes at the item indent', async () => {
  const { headings, wordCount } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  const text = '## A\n\n10. ```\n    code here\n    ```\n\n## B\n\nafter words';
  assert.deepEqual(headings(text), ['A', 'B']);
  assert.equal(wordCount(text), 4);
  // At the top level a closing fence indented four spaces is code, not a close.
  assert.deepEqual(headings('```\nx\n    ```\n## Hidden\n'), []);
});

test('processing instructions, declarations and CDATA are raw HTML too', () => {
  for (const opener of ['<?hidden', '<!DOCTYPE x', '<![CDATA[']) {
    const dir = copySample();
    edit(dir, 'project.md', (t) => t + `\n${opener}\n## Why\n`);
    assert.ok(validateProject(dir).results.find((x) => x.name === 'project').rules.includes('html'), opener);
    rmSync(dir, { recursive: true });
  }
});

test('--accept never writes through a folder swapped for a link after its checks', () => {
  const dir = copySample();
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  cpSync(join(dir, 'dybs/context'), outside, { recursive: true });
  const before = readFileSync(join(outside, 'ui.md'), 'utf8');
  const beforeReplace = () => {
    rmSync(join(dir, 'dybs/context'), { recursive: true });
    symlinkSync(outside, join(dir, 'dybs/context'));
  };
  assert.throws(() => acceptDoc(dir, 'ui', '2026-10-04', { beforeReplace }), /changed while it was being accepted/);
  assert.equal(readFileSync(join(outside, 'ui.md'), 'utf8'), before);
  rmSync(dir, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('an indented code block inside a list item is code', async () => {
  const { wordCount } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  assert.equal(wordCount('- item\n\n      code one two three\n\nafter'), 2);
  // At the item's own content indent it is a paragraph of the item.
  assert.equal(wordCount('- item\n\n  more words\n'), 3);
});

test('raw HTML in a block quote or list item is refused too', () => {
  for (const line of ['> <div>', '- <pre>', '> > <?x']) {
    const dir = copySample();
    edit(dir, 'project.md', (t) => t + `\n${line}\n`);
    assert.ok(validateProject(dir).results.find((x) => x.name === 'project').rules.includes('html'), line);
    rmSync(dir, { recursive: true });
  }
});

test('a fence at a list item content indent, and indented HTML in a quote', async () => {
  const { wordCount } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  assert.equal(wordCount('10. item\n\n    ```\n    code one two\n    ```\n\nafter'), 3);
  const dir = copySample();
  edit(dir, 'project.md', (t) => t + '\n>   <div>\n');
  assert.ok(validateProject(dir).results.find((x) => x.name === 'project').rules.includes('html'));
  rmSync(dir, { recursive: true });
});

test('--accept refuses a temporary copy edited in place before placement', () => {
  const dir = copySample();
  const before = readFileSync(join(dir, 'dybs/context/ui.md'), 'utf8');
  assert.throws(() => acceptDoc(dir, 'ui', '2026-10-04', { beforePlace: (tmp) => writeFileSync(tmp, 'tampered') }), /changed before it was placed/);
  assert.equal(readFileSync(join(dir, 'dybs/context/ui.md'), 'utf8'), before);
  rmSync(dir, { recursive: true });
});

test('--accept never replaces a dangling link that appeared at the doc path', async () => {
  const { lstatSync: lst, readdirSync: ls } = await import('node:fs');
  const dir = copySample();
  const path = join(dir, 'dybs/context/ui.md');
  const before = readFileSync(path, 'utf8');
  assert.throws(() => acceptDoc(dir, 'ui', '2026-10-04', { beforePlace: () => symlinkSync('/nonexistent/target', path) }), /original is kept at/);
  assert.ok(lst(path).isSymbolicLink());
  const kept = ls(join(dir, 'dybs/context')).find((n) => n.startsWith('ui.md.dybs-') && n.endsWith('.old'));
  assert.equal(readFileSync(join(dir, 'dybs/context', kept), 'utf8'), before);
  rmSync(dir, { recursive: true });
});

test('--json names the check as the next step once every doc is written', () => {
  const dir = copySample();
  edit(dir, 'project.md', (t) => t.replace('checkins: each-doc', 'checkins: end'));
  const logs = [];
  const l = console.log; console.log = (m) => logs.push(m);
  try { main(['node', 'v', dir, '--json']); } finally { console.log = l; }
  assert.equal(JSON.parse(logs.join('\n')).next, 'check');
  rmSync(dir, { recursive: true });
});

test('an indented code block inside a block quote is code', async () => {
  const { wordCount } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  assert.equal(wordCount('> quoted words\n>\n>     code one two three\n\nafter'), 3);
});

test('frontmatter quotes must form a matching pair', () => {
  for (const bad of ['status: "draft\'', 'status: "draft', "status: draft'"]) {
    const r = validateDoc('prd', VALID_PRD.replace('status: accepted', bad));
    assert.ok(r.rules.includes('frontmatter'), bad);
  }
  const ok = validateDoc('prd', VALID_PRD.replace(/^updated: (.*)$/m, 'updated: "$1"'));
  assert.ok(!ok.rules.includes('frontmatter'));
});

test('a missing or failing project.md routes to dybs-start', () => {
  assert.equal(nextStep([{ name: 'project', status: 'missing', errors: [] }]), 'dybs-start');
  assert.equal(nextStep([{ name: 'project', status: 'draft', errors: ['bad'] }], 'none'), 'dybs-start');
});

test('--accept restores the original without overwriting a save that appeared', async () => {
  const mod = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  const real = mod.fsOps.link;
  const dir = copySample();
  const path = join(dir, 'dybs/context/ui.md');
  let calls = 0;
  // The placement of the accepted copy fails after an editor saved a new
  // version at the path; the restore must not overwrite that save.
  // (The first link moves the original aside; the placement link is the one
  // from the temporary copy.)
  mod.fsOps.link = (from, to) => { if (String(from).endsWith('.tmp') && ++calls === 1) { writeFileSync(to, 'saved meanwhile'); throw Object.assign(new Error('EIO'), { code: 'EIO' }); } return real(from, to); };
  try {
    assert.throws(() => mod.acceptDoc(dir, 'ui', '2026-10-04'), /original is kept at/);
  } finally { mod.fsOps.link = real; }
  assert.equal(readFileSync(path, 'utf8'), 'saved meanwhile');
  rmSync(dir, { recursive: true });
});

test('--accept cleanup never deletes through a folder swapped for a link', async () => {
  const { renameSync: mv } = await import('node:fs');
  const dir = copySample();
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  const before = readFileSync(join(dir, 'dybs/context/ui.md'), 'utf8');
  let decoy;
  const beforeCleanup = (old) => {
    const name = old.slice(join(dir, 'dybs/context').length + 1);
    mkdirSync(join(outside, 'context'));
    decoy = join(outside, 'context', name);
    writeFileSync(decoy, before);
    mv(join(dir, 'dybs'), join(dir, 'dybs.moved'));
    symlinkSync(outside, join(dir, 'dybs'));
  };
  const r = acceptDoc(dir, 'ui', '2026-10-04', { beforeCleanup });
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => /kept at/.test(w)));
  assert.equal(readFileSync(decoy, 'utf8'), before);
  rmSync(dir, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('a fence indented inside a block quote is code', async () => {
  const { wordCount, headings } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  const text = '## A\n\n>  ```\n>  ## Hidden\n>  code words\n>  ```\n\n## B\n';
  assert.deepEqual(headings(text), ['A', 'B']);
  assert.equal(wordCount(text), 2);
});

test('--doc on a missing doc is a failure, a project-wide run is not', () => {
  const dir = copySample();
  rmSync(join(dir, 'dybs/context/ui.md'));
  assert.equal(validateProject(dir, 'ui').ok, false);
  assert.equal(validateProject(dir).ok, true);
  rmSync(dir, { recursive: true });
});

test('log recovery follows the check-in setting', () => {
  const skill = readFileSync(join(ROOT, 'skills/dybs-start/SKILL.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(skill, /`end`: do not ask now; list the recovered lines in `dybs-check`/);
  assert.match(skill, /`none`: ask nothing; list the recovered lines in the final report/);
});

test('--doc also checks project.md, which holds the settings', () => {
  const dir = copySample();
  assert.equal(validateProject(dir, 'prd').ok, true);
  edit(dir, 'project.md', (t) => t.replace('doc: project', 'doc: nope'));
  assert.equal(validateProject(dir, 'prd').ok, false);
  rmSync(join(dir, 'dybs/project.md'));
  const r = validateProject(dir, 'prd');
  assert.equal(r.ok, false);
  assert.ok(r.results.find((x) => x.name === 'project').errors.some((e) => e.includes('does not exist yet')));
  rmSync(dir, { recursive: true });
});

test('a fence ends with its block quote or list item; a bare ``` then opens a new one', async () => {
  const { headings } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  assert.deepEqual(headings('## A\n\n> ```\n> code\n```\n## Hidden\n```\n\n## B\n'), ['A', 'B']);
  assert.deepEqual(headings('## A\n\n- ```\n  code\n```\n## Hidden\n```\n\n## B\n'), ['A', 'B']);
  assert.deepEqual(headings('## A\n\n- item\n\n  ```\n  ## in code\n  ```\n\n## B\n'), ['A', 'B']);
});

test('a code span does not carry into a block quote or list item that interrupts it', async () => {
  const { visibleText } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  assert.equal(visibleText('ordinary unmatched `\n> # quote <!-- TODO -->\n> close `\n', { keepCode: true }), 'ordinary unmatched `\n> # quote \n> close `\n');
  assert.equal(visibleText('plain `\n> quoted <!-- TODO -->\n> close `\n', { keepCode: true }), 'plain `\n> quoted \n> close `\n');
  assert.equal(visibleText('a `\n- item <!-- TODO -->\nclose `\n', { keepCode: true }), 'a `\n- item \nclose `\n');
  assert.equal(visibleText('a `code\nstill <!-- x --> code` end\n', { keepCode: true }), 'a `code\nstill <!-- x --> code` end\n');
});

test('--accept rollback never moves an outside file reached through a swapped folder', async () => {
  const { renameSync, readdirSync: ls } = await import('node:fs');
  const dir = copySample();
  const ctx = join(dir, 'dybs/context');
  const before = readFileSync(join(ctx, 'ui.md'), 'utf8');
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  let decoy;
  assert.throws(() => acceptDoc(dir, 'ui', '2026-10-04', {
    beforePlace: (tmp) => {
      decoy = join(outside, tmp.slice(ctx.length + 1).replace(/\.tmp$/, '.old'));
      writeFileSync(decoy, 'someone else');
      renameSync(ctx, `${ctx}.moved`);
      symlinkSync(outside, ctx);
    },
  }), /original was not put back/);
  assert.equal(readFileSync(decoy, 'utf8'), 'someone else');
  assert.deepEqual(ls(outside), [decoy.slice(outside.length + 1)]);
  const kept = ls(`${ctx}.moved`).find((n) => n.endsWith('.old'));
  assert.equal(readFileSync(join(`${ctx}.moved`, kept), 'utf8'), before);
  rmSync(dir, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('a dybs/README.md that is not a file is an error', async () => {
  const { mkdirSync } = await import('node:fs');
  const dir = copySample();
  rmSync(join(dir, 'dybs/README.md'));
  mkdirSync(join(dir, 'dybs/README.md'));
  const r = validateProject(dir);
  assert.equal(r.ok, false);
  assert.ok(r.results.find((x) => x.name === 'readme').errors[0].includes('not a file'));
  rmSync(dir, { recursive: true });
});

test('a thematic break ends a code span like any other block', async () => {
  const { visibleText } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  assert.equal(visibleText('open `\n***\n<!-- TODO -->\nclose `\n', { keepCode: true }), 'open `\n***\n\nclose `\n');
  assert.equal(visibleText('open `\n___\n<!-- TODO -->\nclose `\n', { keepCode: true }), 'open `\n___\n\nclose `\n');
});

test('an indented code block may follow a heading or a closed fence directly', async () => {
  const { wordCount } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  assert.equal(wordCount('## Heading\n    code one two three\n\nafter'), 2);
  assert.equal(wordCount('```\nx\n```\n    code a b\n'), 0);
  assert.equal(wordCount('para one\n    still para\n'), 4);
});

test('with checkins: none, a doc may not declare itself thorough', () => {
  const dir = copySample();
  edit(dir, 'project.md', (t) => t.replace('checkins: each-doc', 'checkins: none'));
  assert.equal(validateProject(dir).results.find((x) => x.name === 'ui').errors.length, 0);
  edit(dir, 'context/ui.md', (t) => t.replace('status: draft', 'status: draft\ndepth: thorough'));
  const r = validateProject(dir);
  assert.equal(r.ok, false);
  assert.ok(r.results.find((x) => x.name === 'ui').rules.includes('checkins'));
  assert.equal(acceptDoc(dir, 'ui', '2026-10-04').ok, false);
  rmSync(dir, { recursive: true });
});

test('a fence in a nested list item ends where that item ends', async () => {
  const { wordCount } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  assert.equal(wordCount('10. outer\n    - nested\n      ```\n      code here\n    back to outer content\n'), 7);
  assert.equal(wordCount('- a\n  - b\n    ```\n    hidden words\n    ```\n  after\n'), 3);
});

test('an indented code block may follow a heading inside a block quote', async () => {
  const { wordCount } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  assert.equal(wordCount('> ## Example\n>     generated words here\n'), 1);
});

test('a dybs/README.md that cannot be read is an error', async (t) => {
  const { chmodSync: chmod, mkdtempSync: mk, cpSync: cp } = await import('node:fs');
  const { execFileSync: run } = await import('node:child_process');
  // Root reads anything, so the check runs as an unprivileged user there.
  const dir = mk(join(tmpdir(), 'dybs-unreadable-'));
  cp(SAMPLE, dir, { recursive: true });
  chmod(dir, 0o755);
  chmod(join(dir, 'dybs/README.md'), 0o000);
  const script = join(ROOT, 'skills/dybs-start/scripts/dybs-validate.mjs');
  const cmd = unprivileged([script, dir, '--json']);
  if (!cmd) return t.skip(UNPRIVILEGED_SKIP);
  let out;
  try { out = run(cmd[0], cmd[1], { encoding: 'utf8' }); } catch (e) { out = e.stdout; }
  const r = JSON.parse(out);
  assert.equal(r.ok, false);
  assert.match(r.results.find((x) => x.name === 'readme').errors[0], /cannot be read/);
  rmSync(dir, { recursive: true });
});

test('a tag on a line inside a multiline code span is code, not raw HTML', () => {
  const r = validateDoc('project', VALID_PROJECT + '\nSee `\n<span>\n` example.\n');
  assert.ok(!r.rules.includes('html'));
  const bad = validateDoc('project', VALID_PROJECT + '\nSee this.\n<span>\nnot code.\n');
  assert.ok(bad.rules.includes('html'));
});

test('quotes and lists: nested quote closers, quote exits, quoted ordered lists, headings that end a list', async () => {
  const { wordCount, visibleText } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  assert.equal(wordCount('> > ```\n> > code\n>  > ```\n> > after words\n'), 2);
  assert.equal(visibleText('> unmatched `\n<!-- TODO -->\nclose `\n', { keepCode: true }), '> unmatched `\n\nclose `\n');
  assert.equal(wordCount('> 10. item\n>\n>     continuation prose\n'), 4);
  assert.equal(wordCount('- item\n# Heading\n    example code\n'), 2);
  // A lazy continuation line keeps the quoted paragraph, and the span, open.
  assert.equal(visibleText('> a `x\nb <!-- c --> d`\n', { keepCode: true }), '> a `x\nb <!-- c --> d`\n');
  // Inside a quoted list item, code sits four past the item's content.
  assert.equal(wordCount('> - item\n>\n>       code here\n'), 1);
});

test('an unclosed comment ends with the block quote or list item it opened in', async () => {
  const { headings, wordCount } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  assert.deepEqual(headings('> <!-- note\n\n## A\n\n## B\n'), ['A', 'B']);
  assert.deepEqual(headings('- <!-- note\n  still comment\n\n## A\n'), ['A']);
  // A comment at top level after a list is not in the list: it runs on.
  assert.equal(wordCount('- a\n\n<!-- x\nhidden words\n-->\nshown\n'), 2);
});

test('an HTML block that interrupts a paragraph ends a code span', async () => {
  const { visibleText } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  assert.equal(visibleText('open `\n<div>\nx <!-- TODO --> y\nclose `\n', { keepCode: true }), 'open `\n<div>\nx  y\nclose `\n');
  // An inline tag (type 7) cannot interrupt a paragraph: the span holds.
  assert.equal(visibleText('open `\n<span>\nx <!-- TODO --> y\nclose `\n', { keepCode: true }), 'open `\n<span>\nx <!-- TODO --> y\nclose `\n');
});

test('--accept writes nothing through a folder swapped for a link before the write', async () => {
  const { renameSync, readdirSync: ls } = await import('node:fs');
  const dir = copySample();
  const ctx = join(dir, 'dybs/context');
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  assert.throws(() => acceptDoc(dir, 'ui', '2026-10-04', {
    beforeWrite: () => { renameSync(ctx, `${ctx}.moved`); symlinkSync(outside, ctx); },
    // Swapped back before the next check: only the pin taken before the
    // write can notice, and nothing may be left outside.
    beforeReplace: () => { rmSync(ctx); renameSync(`${ctx}.moved`, ctx); },
  }), /changed while it was being accepted/);
  assert.deepEqual(ls(outside), []);
  rmSync(dir, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('text after a comment on the same line is never a heading', async () => {
  const { headings, wordCount } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  assert.deepEqual(headings('<!-- note -->## Problem\n\n## Real\n'), ['Real']);
  assert.deepEqual(headings('<!--\nx\n--> ## Problem\n\n## Real\n'), ['Real']);
  assert.equal(wordCount('<!-- note -->two words\n'), 2);
  const dir = copySample();
  edit(dir, 'project.md', (t) => t + '\n<!-- x --><div>\n');
  assert.ok(validateProject(dir).results.find((x) => x.name === 'project').rules.includes('html'));
  rmSync(dir, { recursive: true });
});

test('only an ordered list starting at 1 interrupts a paragraph', async () => {
  const { visibleText } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  assert.equal(visibleText('ordinary `open\n2. still <!-- TODO -->\nclose`\n', { keepCode: true }), 'ordinary `open\n2. still <!-- TODO -->\nclose`\n');
  assert.equal(visibleText('ordinary `open\n1. item <!-- TODO -->\nclose`\n', { keepCode: true }), 'ordinary `open\n1. item \nclose`\n');
});

test('a block quote that opens with indented code interrupts the paragraph before it', async () => {
  const { wordCount } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  assert.equal(wordCount('paragraph\n>     alpha beta\n'), 1);
  // Inside the same quote, an indented line still continues the paragraph.
  assert.equal(wordCount('> paragraph\n>     still prose\n'), 3);
});

test('frontmatter quotes count only as a matching pair', async () => {
  const { parseFrontmatter } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  // Never quietly cleaned up into a valid value.
  assert.notEqual(parseFrontmatter("---\nstatus: 'accepted\n---\n").data.status, 'accepted');
  assert.notEqual(parseFrontmatter('---\ndoc: "project\'\n---\n').data.doc, 'project');
  assert.equal(parseFrontmatter('---\nstatus: "accepted"\n---\n').data.status, 'accepted');
});

test('--doc reports only the doc it checked, never "all accepted"', async () => {
  const { main } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  const dir = copySample();
  const logs = [];
  const l = console.log; console.log = (m) => logs.push(String(m));
  try { main(['node', 'v', dir, '--doc', 'project']); } finally { console.log = l; }
  assert.ok(!logs.join('\n').includes('All Getting Started docs accepted'));
  assert.match(logs.join('\n'), /project\.md passes/);
  rmSync(dir, { recursive: true });
});

test('more CommonMark boundaries: ordered fences, comment blocks after lists, setext headings', async () => {
  const { headings, wordCount } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  assert.deepEqual(headings('para\n2. ```\n## Visible\n'), ['Visible']);
  assert.deepEqual(headings('para\n2. ```\n   ## Visible\n'), ['Visible']);
  assert.deepEqual(headings('\n2. ```\n## Hidden\n'), ['Hidden']);
  assert.equal(wordCount('- item\n<!-- note -->\n    code words\n'), 1);
  assert.equal(wordCount('Heading\n===\n    code words\n'), 1);
  assert.equal(wordCount('Heading\n--\n    code words\n'), 1);
});

test('--accept catches a write through the temporary name after a link placement', async () => {
  const mod = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  const realLink = mod.fsOps.link;
  const dir = copySample();
  const path = join(dir, 'dybs/context/ui.md');
  let wrote = false;
  // A watcher writes into the shared inode through the temporary name,
  // after placement and before that name is gone.
  mod.fsOps.link = (from, to) => { const r = realLink(from, to); if (from.endsWith('.tmp')) { writeFileSync(from, 'a watcher wrote this'); wrote = true; } return r; };
  try {
    assert.throws(() => mod.acceptDoc(dir, 'ui', '2026-10-04'), /changed while it was being accepted/);
  } finally { mod.fsOps.link = realLink; }
  assert.ok(wrote);
  // The changed file is someone's now: kept, never deleted.
  assert.equal(readFileSync(path, 'utf8'), 'a watcher wrote this');
  rmSync(dir, { recursive: true });
});

test('a heading opening a list item, and a short setext underline, are block boundaries', async () => {
  const { wordCount, visibleText } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  assert.equal(wordCount('- ## Example\n      code words here\n'), 1);
  assert.equal(visibleText('open `\n--\ntext <!-- TODO -->\nclose `\n', { keepCode: true }), 'open `\n--\ntext \nclose `\n');
});

test('--accept never deletes a file that replaces its temporary name after the look', async () => {
  const mod = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  const { renameSync } = await import('node:fs');
  const dir = copySample();
  let replaced;
  mod.testHooks.afterLook = (p) => {
    if (replaced || !p.endsWith('.tmp')) return;
    replaced = p;
    writeFileSync(`${p}.x`, 'someone else');
    renameSync(`${p}.x`, p);
  };
  try { mod.acceptDoc(dir, 'ui', '2026-10-04'); } catch { /* either outcome is fine */ } finally { mod.testHooks.afterLook = null; }
  assert.ok(replaced);
  assert.equal(readFileSync(replaced, 'utf8'), 'someone else');
  rmSync(dir, { recursive: true });
});

test('an indented code block in a list item ends at its own code column', async () => {
  const { wordCount } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  assert.equal(wordCount('- item\n\n      code\n    ordinary prose\n'), 3);
  assert.equal(wordCount('- item\n\n      code\n      more code\n'), 1);
});

test('--accept never replaces a file that appears at the .old name', async () => {
  const mod = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  const dir = copySample();
  const path = join(dir, 'dybs/context/ui.md');
  const before = readFileSync(path, 'utf8');
  let foreign;
  assert.throws(() => mod.acceptDoc(dir, 'ui', '2026-10-04', {
    beforeMoveAside: (old) => { foreign = old; writeFileSync(old, 'someone else'); },
  }), /something appeared at/);
  assert.equal(readFileSync(foreign, 'utf8'), 'someone else');
  assert.equal(readFileSync(path, 'utf8'), before);
  rmSync(dir, { recursive: true });
});

test('without hard links, --accept reserves the .old name and still works', async () => {
  const mod = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  const real = { ...mod.fsOps };
  mod.fsOps.link = () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); };
  const dir = copySample();
  try { assert.equal(mod.acceptDoc(dir, 'ui', '2026-10-04').ok, true); } finally { Object.assign(mod.fsOps, real); }
  assert.match(readFileSync(join(dir, 'dybs/context/ui.md'), 'utf8'), /status: accepted/);
  rmSync(dir, { recursive: true });
});

test('dybs-check checks readiness only for docs that are not skipped', () => {
  const t = readFileSync(join(ROOT, 'skills/dybs-check/SKILL.md'), 'utf8');
  const step = t.slice(t.indexOf('6. **Readiness.**'), t.indexOf('7. **Depth.**'));
  assert.match(step, /does not list under `skip:`/);
});

test('indented code inside a nested list item starts four past the innermost item', async () => {
  const { wordCount } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  assert.equal(wordCount('10. outer\n    - nested\n\n        visible prose here\n'), 6);
  assert.equal(wordCount('10. outer\n    - nested\n\n          code here\n'), 3);
});

test('without hard links, --accept never loses an edit made while moving the doc aside', async () => {
  const mod = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  const real = { ...mod.fsOps };
  mod.fsOps.link = () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); };
  const dir = copySample();
  let err;
  try {
    mod.acceptDoc(dir, 'ui', '2026-10-04', { beforeAside: (p) => writeFileSync(p, 'edited after the copy') });
  } catch (e) { err = e; } finally { Object.assign(mod.fsOps, real); }
  assert.ok(err);
  // Back at its own name when that is still free, else kept where the error
  // says: either way the edit is where the user can find it.
  const kept = /back at its own name/.test(err.message) ? join(dir, 'dybs/context/ui.md') : err.message.match(/your version is kept at (\S+?)(;|$)/)?.[1];
  assert.ok(kept, err.message);
  assert.equal(readFileSync(kept, 'utf8'), 'edited after the copy');
  rmSync(dir, { recursive: true });
});

test('--accept refuses a project.md that is a link to a file elsewhere', async () => {
  const { renameSync } = await import('node:fs');
  const dir = copySample();
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  renameSync(join(dir, 'dybs/project.md'), join(outside, 'project.md'));
  symlinkSync(join(outside, 'project.md'), join(dir, 'dybs/project.md'));
  const r = acceptDoc(dir, 'ui', '2026-10-04');
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /refusing to accept/);
  assert.match(readFileSync(join(dir, 'dybs/context/ui.md'), 'utf8'), /status: draft/);
  rmSync(dir, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('fence closers measured from the container; quotes inside list items; quotes ending lists', async () => {
  const { wordCount, headings } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  // A closer may be indented at most three past its container, so this fence never closes.
  assert.deepEqual(headings('  ```\n     ```\n## Hidden\n'), []);
  // A quote inside a list item keeps its fence across continuation lines.
  assert.equal(wordCount('- > ```\n  > code words\n  > ```\n'), 0);
  assert.equal(wordCount('10. > ```\n    > code words\n    > ```\n'), 0);
  // A top-level quote ends the list, so a later indented block is code.
  assert.equal(wordCount('- item\n> quote\n\n    code here\n'), 2);
  // Unchanged: fences in a list item and in a quoted list item still close.
  assert.deepEqual(headings('- ```\n  x\n  ```\n## Shown\n'), ['Shown']);
  assert.deepEqual(headings('> - ```\n>   x\n>   ```\n## Shown\n'), ['Shown']);
});

test('doc skills stop without the method README and fingerprint each acceptance', () => {
  for (const doc of ['prd', 'scope', 'domain', 'architecture', 'ux', 'ui']) {
    const t = readFileSync(join(ROOT, `skills/dybs-${doc}/SKILL.md`), 'utf8');
    assert.match(t, /\*\*No `dybs\/README\.md`, or one that cannot be read:\*\*[\s\S]*?stop/, doc);
    assert.match(t, /\*\*Accepting:\*\*[\s\S]*?`--accept <name>`/, doc);
    assert.ok(t.includes(`when the human accepts, \`--accept ${doc}\``), doc);
  }
});

test('--accept undoes an acceptance whose required input changed while it ran', async () => {
  const mod = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  for (const [hook, input] of [['beforeWrite', 'dybs/context/ux.md'], ['beforePlacedCheck', 'dybs/project.md']]) {
    const dir = copySample();
    const path = join(dir, 'dybs/context/ui.md');
    const before = readFileSync(path, 'utf8');
    assert.throws(() => mod.acceptDoc(dir, 'ui', '2026-10-04', {
      [hook]: () => writeFileSync(join(dir, input), 'not a valid doc any more'),
    }), new RegExp(`${input} changed while`));
    // The acceptance does not stand: the doc is back as it was.
    assert.equal(readFileSync(path, 'utf8'), before, hook);
    rmSync(dir, { recursive: true });
  }
});

test('--accept rollback never deletes a save that replaces the placed doc', async () => {
  const mod = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  const { renameSync } = await import('node:fs');
  const dir = copySample();
  const path = join(dir, 'dybs/context/ui.md');
  let saved = false;
  let failing = false;
  // An editor saves atomically (temp file + rename) after the rollback has
  // checked the placed doc and before it is removed.
  mod.testHooks.afterLook = (p) => {
    if (saved || !failing || p !== path) return;
    saved = true;
    writeFileSync(`${p}.x`, 'the editor saved this');
    renameSync(`${p}.x`, p);
  };
  try {
    assert.throws(() => mod.acceptDoc(dir, 'ui', '2026-10-04', {
      beforePlacedCheck: () => { failing = true; throw new Error('fail after placement'); },
    }), /fail after placement/);
  } finally { mod.testHooks.afterLook = null; }
  assert.ok(saved);
  assert.equal(readFileSync(path, 'utf8'), 'the editor saved this');
  rmSync(dir, { recursive: true });
});

test('an unclosed <!-- in a paragraph is literal text, not a comment to the end', async () => {
  const { visibleText } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  // Never closed: CommonMark shows everything after it (checked against commonmark.js).
  assert.match(visibleText('ordinary <!-- never closes\nTODO visible\n'), /TODO visible/);
  assert.match(visibleText('ordinary <!-- a\n\nTODO later\n-->\n'), /TODO later/);
  // Closed later in the same paragraph, or opening a block: hidden.
  assert.doesNotMatch(visibleText('ordinary <!-- a\nTODO hidden\n-->\n'), /TODO/);
  assert.doesNotMatch(visibleText('<!-- a\n\nTODO hidden\n'), /TODO/);
});

test('without hard links, --accept re-checks the folders right before moving the doc aside', async () => {
  const mod = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  const { renameSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const real = { ...mod.fsOps };
  mod.fsOps.link = () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); };
  const dir = copySample();
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  mkdirSync(join(outside, 'context'));
  writeFileSync(join(outside, 'context/ui.md'), 'someone else');
  let swapped = false;
  try {
    // After the copy, dybs/ becomes a link to an outside folder with its own ui.md.
    assert.throws(() => mod.acceptDoc(dir, 'ui', '2026-10-04', {
      beforeAside: () => {
        swapped = true;
        renameSync(join(dir, 'dybs'), join(dir, 'dybs.moved'));
        symlinkSync(outside, join(dir, 'dybs'));
      },
    }), /changed/);
  } finally { Object.assign(mod.fsOps, real); }
  assert.ok(swapped);
  assert.equal(readFileSync(join(outside, 'context/ui.md'), 'utf8'), 'someone else', 'the outside doc keeps its name');
  rmSync(dir, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('--accept reports a previous version it could not remove instead of claiming a clean success', async () => {
  const mod = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  const real = { ...mod.fsOps };
  const dir = copySample();
  mod.fsOps.rename = (from, to) => {
    if (from.endsWith('.old')) throw Object.assign(new Error('locked'), { code: 'EPERM' });
    return real.rename(from, to);
  };
  let r;
  try { r = mod.acceptDoc(dir, 'ui', '2026-10-04'); } finally { Object.assign(mod.fsOps, real); }
  assert.equal(r.ok, true);
  assert.match((r.warnings || []).join(' '), /kept at \S+\.old/);
  rmSync(dir, { recursive: true });
});

test('a heading inside an unclosed comment in a list item never counts as present', async () => {
  const { headings } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  // CommonMark: `- <!--` opens an HTML block in the item, to the end (checked against commonmark.js).
  assert.deepEqual(headings('- <!--\n  ## Problem\n'), []);
  assert.deepEqual(headings('10. <!--\n    ## Problem\n'), []);
  assert.deepEqual(headings('## Goal\n'), ['Goal']);
});

test('list indentation is measured in tab-expanded columns, and a lazy line keeps its paragraph open', async () => {
  const { wordCount } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  // `-\t` puts the content at column four: six spaces is prose, not code
  // (checked against commonmark.js).
  assert.equal(wordCount('-\titem\n\n      six words\n'), 3);
  // A line that drops out of the quote lazily continues its paragraph, so
  // the re-quoted indented line is prose too.
  assert.equal(wordCount('> q\nlazy\n>       deep words\n'), 4);
  // A real indented block is still code.
  assert.equal(wordCount('-\titem\n\n        code words\n'), 1);
});

test('--doc checks the docs the named doc cannot be written without', () => {
  const dir = copySample();
  const ux = join(dir, 'dybs/context/ux.md');
  rmSync(ux);
  let r = validateProject(dir, 'ui');
  assert.equal(r.ok, false);
  assert.match(r.results.find((x) => x.name === 'ux').errors.join(' '), /ui cannot be written without it/);
  writeFileSync(ux, 'not a valid doc');
  r = validateProject(dir, 'ui');
  assert.equal(r.ok, false);
  assert.ok(r.results.find((x) => x.name === 'ux').errors.length);
  rmSync(dir, { recursive: true });
});

test('--accept re-checks the folders right before linking the doc aside', async () => {
  const mod = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  const { renameSync, readdirSync } = await import('node:fs');
  const dir = copySample();
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  mkdirSync(join(outside, 'context'));
  writeFileSync(join(outside, 'context/ui.md'), 'someone else');
  assert.throws(() => mod.acceptDoc(dir, 'ui', '2026-10-04', {
    beforeMoveAside: () => {
      renameSync(join(dir, 'dybs'), join(dir, 'dybs.moved'));
      symlinkSync(outside, join(dir, 'dybs'));
    },
  }), /changed/);
  // Nothing was created or removed outside the project.
  assert.deepEqual(readdirSync(join(outside, 'context')), ['ui.md']);
  assert.equal(readFileSync(join(outside, 'context/ui.md'), 'utf8'), 'someone else');
  rmSync(dir, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('only paragraph text takes a setext underline, and 2. or a fence with a backtick in its info never interrupts one', async () => {
  const { wordCount, visibleText } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  // Each case is checked against commonmark.js.
  // `==` after a heading starts a paragraph; the indented line continues it.
  assert.equal(wordCount('# Title\n==\n    many words\n'), 3);
  // A lazy `==` is paragraph text, not an underline.
  assert.equal(wordCount('> q\ntext\n==\n    code words\n'), 4);
  // `2. <!--` after paragraph text is more of that paragraph: the opener is literal.
  assert.match(visibleText('ordinary\n2. <!--\n   TODO x\n', { keepCode: true }), /TODO x/);
  // ```` ``` bad` ```` is no fence, so it does not end the open code span.
  assert.match(visibleText('open ``\n``` bad`\ntext <!-- TODO -->\n``\n', { keepCode: true }), /TODO/);
});

test('emphasized placeholders and inline HTML anywhere in a line are caught', () => {
  for (const p of ['_TODO_', '*TBD*', '__TODO__']) {
    assert.ok(validateDoc('prd', VALID_PRD + `\nStill ${p} here.\n`).rules.includes('placeholder'), p);
  }
  // `TODOs` is a word, not the placeholder.
  assert.ok(!validateDoc('prd', VALID_PRD + '\nNo TODOs left.\n').rules.includes('placeholder'));
  const hidden = VALID_PRD.replace('## Goals', 'intro <details>\n\n## Goals') + '\ntext </details>\n';
  assert.ok(validateDoc('prd', hidden).rules.includes('html'));
  // Code spans, escapes and autolinks are not raw HTML.
  for (const ok of ['use `<details>` here', 'a \\<div> b', 'see <https://example.com>']) {
    assert.ok(!validateDoc('prd', VALID_PRD + `\n${ok}\n`).rules.includes('html'), ok);
  }
});

test('--accept refuses a doc swapped for a link to the same text, on both move-aside paths', async () => {
  const mod = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  const real = { ...mod.fsOps };
  for (const noLinks of [false, true]) {
    const dir = copySample();
    const path = join(dir, 'dybs/context/ui.md');
    const theirs = join(dir, 'their-ui.md');
    writeFileSync(theirs, readFileSync(path, 'utf8'));
    if (noLinks) mod.fsOps.link = () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); };
    try {
      assert.throws(() => mod.acceptDoc(dir, 'ui', '2026-10-04', {
        beforeMoveAside: () => { rmSync(path); symlinkSync(theirs, path); },
      }), /no longer a regular file/);
    } finally { Object.assign(mod.fsOps, real); }
    const { lstatSync } = await import('node:fs');
    assert.ok(lstatSync(path).isSymbolicLink(), `the user's link stays (noLinks=${noLinks})`);
    rmSync(dir, { recursive: true });
  }
});

test('--accept stops without a readable method README', async () => {
  const mod = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  for (const breakIt of [(p) => rmSync(p), (p) => { rmSync(p); mkdirSync(p); }]) {
    const dir = copySample();
    const path = join(dir, 'dybs/context/ui.md');
    const before = readFileSync(path, 'utf8');
    breakIt(join(dir, 'dybs/README.md'));
    const r = mod.acceptDoc(dir, 'ui', '2026-10-04');
    assert.equal(r.ok, false);
    assert.match(r.errors.join(' '), /README\.md/);
    assert.equal(readFileSync(path, 'utf8'), before);
    rmSync(dir, { recursive: true });
  }
});

test('--accept cleanup re-checks the folders right before removing the old version', async () => {
  const mod = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  const { renameSync, linkSync, existsSync: exists } = await import('node:fs');
  const dir = copySample();
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  mkdirSync(join(outside, 'context'));
  let kept = null;
  // After the cleanup's check, dybs/ becomes a link to an outside folder
  // holding another name for the very same old file.
  mod.testHooks.afterLook = (p) => {
    if (kept || !p.endsWith('.old')) return;
    kept = join(outside, 'context', p.split('/').at(-1));
    linkSync(p, kept);
    renameSync(join(dir, 'dybs'), join(dir, 'dybs.moved'));
    symlinkSync(outside, join(dir, 'dybs'));
  };
  try { mod.acceptDoc(dir, 'ui', '2026-10-04'); } catch { /* either outcome is fine */ } finally { mod.testHooks.afterLook = null; }
  assert.ok(kept, 'the hook ran on the old version');
  assert.ok(exists(kept), 'the outside name must survive');
  rmSync(dir, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('2. followed by a heading after paragraph text is more of that paragraph', async () => {
  const { wordCount } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  // commonmark.js: one paragraph, so the indented line is prose.
  assert.equal(wordCount('ordinary\n2. ## fake\n    many words\n'), 5);
});

test('without hard links, a placement copy that fails halfway leaves nothing behind', async () => {
  const mod = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  const real = { ...mod.fsOps };
  mod.fsOps.link = () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); };
  mod.fsOps.write = (fd) => { real.write(fd, 'partial'); throw Object.assign(new Error('no space left'), { code: 'ENOSPC' }); };
  const dir = mkdtempSync(join(tmpdir(), 'dybs-place-'));
  try {
    writeFileSync(join(dir, 'from'), 'new');
    assert.throws(() => mod.placeNoClobber(join(dir, 'from'), join(dir, 'to')), (e) => e.code === 'ENOSPC');
    assert.ok(!existsSync(join(dir, 'to')), 'the partial copy is removed');
  } finally { Object.assign(mod.fsOps, real); rmSync(dir, { recursive: true }); }
});

test('--accept names the real place of a previous version it could not remove', async () => {
  const mod = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  const real = { ...mod.fsOps };
  const dir = copySample();
  // The final unlink of the old version fails after its private move.
  mod.fsOps.rm = (p, ...rest) => {
    if (/\.old\.[0-9a-f-]{36}\.rm$/.test(p)) throw Object.assign(new Error('locked'), { code: 'EPERM' });
    return real.rm(p, ...rest);
  };
  let r;
  try { r = mod.acceptDoc(dir, 'ui', '2026-10-04'); } finally { Object.assign(mod.fsOps, real); }
  assert.equal(r.ok, true);
  const kept = (r.warnings || []).join(' ').match(/kept at (\S+)$/)?.[1];
  assert.ok(kept && existsSync(kept), `reported ${kept}`);
  rmSync(dir, { recursive: true });
});

test('HTML right after a code span that closes on a later line is still refused', () => {
  assert.ok(validateDoc('prd', VALID_PRD + '\ntext `code\nstill code` <div>\n').rules.includes('html'));
  assert.ok(!validateDoc('prd', VALID_PRD + '\ntext `code\nstill <div> code` after\n').rules.includes('html'));
});

test('without hard links, --accept never moves a save made after the copy', async () => {
  const mod = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  const { renameSync } = await import('node:fs');
  const real = { ...mod.fsOps };
  mod.fsOps.link = () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); };
  const dir = copySample();
  const path = join(dir, 'dybs/context/ui.md');
  try {
    assert.throws(() => mod.acceptDoc(dir, 'ui', '2026-10-04', {
      beforeAside: (p) => { writeFileSync(`${p}.x`, 'saved by the editor'); renameSync(`${p}.x`, p); },
    }), /changed while it was being moved aside/);
  } finally { Object.assign(mod.fsOps, real); }
  assert.equal(readFileSync(path, 'utf8'), 'saved by the editor');
  rmSync(dir, { recursive: true });
});

test('a comment opened in a quote inside a list item ends when a line leaves that quote', async () => {
  const { visibleText, wordCount } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  // Each case is checked against commonmark.js.
  assert.match(visibleText('- > <!--\n  TODO visible outside quote\n', { keepCode: true }), /TODO visible/);
  // A deeper quote under plain text starts its own paragraph: `===` there
  // underlines nothing, and the indented line after it is prose.
  assert.equal(wordCount('ordinary\n> ===\n>     hidden words\n'), 3);
  // A quote outside the list item is not the paragraph inside it: the
  // indented line stays prose (CommonMark counts 2 words; never fewer).
  assert.ok(wordCount('- > <!--\n  > more\n> ===\n>     hidden words\n') >= 2);
});

test('--accept never removes its temporary copy through a folder swapped for a link', async () => {
  const mod = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  const { renameSync, linkSync } = await import('node:fs');
  const dir = copySample();
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  mkdirSync(join(outside, 'context'));
  let kept = null;
  mod.testHooks.afterLook = (p) => {
    if (kept || !p.endsWith('.tmp')) return;
    kept = join(outside, 'context', p.split('/').at(-1));
    linkSync(p, kept);
    renameSync(join(dir, 'dybs'), join(dir, 'dybs.moved'));
    symlinkSync(outside, join(dir, 'dybs'));
  };
  try { mod.acceptDoc(dir, 'ui', '2026-10-04'); } catch { /* either outcome is fine */ } finally { mod.testHooks.afterLook = null; }
  assert.ok(kept, 'the hook ran on the temporary copy');
  assert.ok(existsSync(kept), 'the outside name must survive');
  rmSync(dir, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('without hard links, a move-aside copy in --accept that fails halfway leaves nothing behind', async () => {
  const mod = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  const { readdirSync } = await import('node:fs');
  const real = { ...mod.fsOps };
  const dir = copySample();
  const path = join(dir, 'dybs/context/ui.md');
  const before = readFileSync(path, 'utf8');
  mod.fsOps.link = () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); };
  mod.fsOps.write = (fd, data) => {
    if (String(data) === before) { real.write(fd, 'partial'); throw Object.assign(new Error('no space left'), { code: 'ENOSPC' }); }
    return real.write(fd, data);
  };
  try { assert.throws(() => mod.acceptDoc(dir, 'ui', '2026-10-04'), /no space left/); } finally { Object.assign(mod.fsOps, real); }
  assert.equal(readFileSync(path, 'utf8'), before);
  assert.deepEqual(readdirSync(join(dir, 'dybs/context')).filter((n) => n.includes('.old')), []);
  rmSync(dir, { recursive: true });
});

test('placeholders written with character references are still placeholders', () => {
  for (const p of ['T&#79;DO', 'T&#x42;D', '&lbrace;&lbrace;name&rbrace;&rbrace;', '&#123;&#123;x}}']) {
    assert.ok(validateDoc('prd', VALID_PRD + `\nStill ${p} here.\n`).rules.includes('placeholder'), p);
  }
  assert.ok(!validateDoc('prd', VALID_PRD + '\nFish &amp; chips.\n').rules.includes('placeholder'));
});

test('a heading inside a list item keeps the item, so its indented prose still counts', async () => {
  const { wordCount } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  // commonmark.js: an h2 and a paragraph, both inside the item.
  assert.equal(wordCount('- item\n  ## Details\n    many words\n'), 4);
});

test('--doc without a doc name is refused, never a whole-project pass', async () => {
  const err = console.error; const log = console.log;
  console.error = () => {}; console.log = () => {};
  try {
    const { main } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
    for (const args of [['--doc'], ['--doc', ''], ['--doc', '--json']]) {
      assert.equal(main(['node', 'dybs-validate.mjs', SAMPLE, ...args]), 2, args.join(' '));
    }
  } finally { console.error = err; console.log = log; }
});

test('without hard links, --accept checks the folders before a fallback copy writes anything', async () => {
  const mod = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  const { renameSync } = await import('node:fs');
  const real = { ...mod.fsOps };
  const dir = copySample();
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  mkdirSync(join(outside, 'context'));
  let swapped = false;
  mod.fsOps.link = (from) => {
    if (!swapped && from.endsWith('.tmp')) {
      swapped = true;
      writeFileSync(join(outside, 'context', from.split('/').at(-1)), 'staged elsewhere');
      renameSync(join(dir, 'dybs'), join(dir, 'dybs.moved'));
      symlinkSync(outside, join(dir, 'dybs'));
    }
    throw Object.assign(new Error('no hard links'), { code: 'EPERM' });
  };
  try { assert.throws(() => mod.acceptDoc(dir, 'ui', '2026-10-04'), /changed/); } finally { Object.assign(mod.fsOps, real); }
  assert.ok(swapped);
  assert.ok(!existsSync(join(outside, 'context/ui.md')), 'nothing is written outside');
  rmSync(dir, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('compact comments <!--> and <!---> close at once', async () => {
  const { visibleText } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  // commonmark.js: a complete comment, then an ordinary paragraph.
  assert.match(visibleText('<!-->\nTODO after\n', { keepCode: true }), /TODO after/);
  assert.match(visibleText('<!--->\nTODO after\n', { keepCode: true }), /TODO after/);
});

test('--doc on a doc under skip: is not reported as passing', () => {
  const dir = copySample();
  edit(dir, 'project.md', (t) => t.replace(/^skip:.*$/m, 'skip: ui'));
  rmSync(join(dir, 'dybs/context/ui.md'));
  const r = validateProject(dir, 'ui');
  assert.equal(r.ok, false);
  assert.match(r.results.find((x) => x.name === 'ui').errors.join(' '), /under skip/);
  rmSync(dir, { recursive: true });
});

test('a tag on the opening line of a multi-line code span is code, not raw HTML', () => {
  assert.ok(!validateDoc('prd', VALID_PRD + '\nSee `<span>\ncontinued` here.\n').rules.includes('html'));
  // Prose before the opening run is still judged.
  assert.ok(validateDoc('prd', VALID_PRD + '\n<div> see `<span>\ncontinued` here.\n').rules.includes('html'));
});

test('a folder swapped during the --accept move-aside link leaves no name outside the project', async () => {
  const mod = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  const { renameSync, readdirSync } = await import('node:fs');
  const real = { ...mod.fsOps };
  const dir = copySample();
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  mkdirSync(join(outside, 'context'));
  writeFileSync(join(outside, 'context/ui.md'), 'theirs');
  let swapped = false;
  mod.fsOps.link = (from, to) => {
    if (!swapped && to.endsWith('.old')) {
      swapped = true;
      renameSync(join(dir, 'dybs'), join(dir, 'dybs.moved'));
      symlinkSync(outside, join(dir, 'dybs'));
    }
    return real.link(from, to);
  };
  try { assert.throws(() => mod.acceptDoc(dir, 'ui', '2026-10-04'), /changed/); } finally { Object.assign(mod.fsOps, real); }
  assert.ok(swapped);
  assert.deepEqual(readdirSync(join(outside, 'context')).filter((n) => n.endsWith('.old')), []);
  assert.equal(readFileSync(join(outside, 'context/ui.md'), 'utf8'), 'theirs');
  rmSync(dir, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('a placeholder written with character references in frontmatter is still a placeholder', () => {
  const t = VALID_PRD.replace(/^---\n/, '---\nnote: T&#79;DO\n');
  assert.ok(validateDoc('prd', t).rules.includes('placeholder'));
});

test('--doc accepts only real doc names, and stray arguments are refused', async () => {
  const { main } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  const err = console.error; const log = console.log;
  console.error = () => {}; console.log = () => {};
  try {
    for (const args of [['--doc', 'toString'], ['--doc', 'constructor'], ['/not/the/project'], ['--bogus']]) {
      assert.equal(main(['node', 'dybs-validate.mjs', SAMPLE, ...args]), 2, args.join(' '));
    }
  } finally { console.error = err; console.log = log; }
});

test('--accept accepts only real doc names', async () => {
  const { main } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  const err = console.error; const log = console.log;
  console.error = () => {}; console.log = () => {};
  try {
    for (const name of ['toString', 'constructor', '__proto__']) {
      assert.equal(main(['node', 'dybs-validate.mjs', SAMPLE, '--accept', name]), 2, name);
    }
  } finally { console.error = err; console.log = log; }
});

test('--accept refuses a doc the project skips', () => {
  const dir = copySample();
  edit(dir, 'project.md', (t) => t.replace(/^skip:.*$/m, 'skip: ui'));
  const path = join(dir, 'dybs/context/ui.md');
  const before = readFileSync(path, 'utf8');
  const r = acceptDoc(dir, 'ui', '2026-10-04');
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /under skip/);
  assert.equal(readFileSync(path, 'utf8'), before);
  rmSync(dir, { recursive: true });
});

test('without hard links, --accept keeps the doc mode whatever the umask', async () => {
  const mod = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  const real = { ...mod.fsOps };
  const dir = copySample();
  const path = join(dir, 'dybs/context/ui.md');
  chmodSync(path, 0o644);
  mod.fsOps.link = () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); };
  const old = process.umask(0o077);
  try { assert.equal(mod.acceptDoc(dir, 'ui', '2026-10-04').ok, true); } finally { process.umask(old); Object.assign(mod.fsOps, real); }
  assert.equal(statSync(path).mode & 0o777, 0o644);
  rmSync(dir, { recursive: true });
});

test('a folder swapped during the --accept placement leaves no new name outside the project', async () => {
  const mod = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  const { renameSync, readdirSync } = await import('node:fs');
  const real = { ...mod.fsOps };
  const dir = copySample();
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  mkdirSync(join(outside, 'context'));
  let swapped = null;
  mod.fsOps.link = (from, to) => {
    if (!swapped && from.endsWith('.tmp') && to.endsWith('ui.md')) {
      swapped = from.split('/').at(-1);
      writeFileSync(join(outside, 'context', swapped), 'theirs');
      renameSync(join(dir, 'dybs'), join(dir, 'dybs.moved'));
      symlinkSync(outside, join(dir, 'dybs'));
    }
    return real.link(from, to);
  };
  try { assert.throws(() => mod.acceptDoc(dir, 'ui', '2026-10-04'), /changed/); } finally { Object.assign(mod.fsOps, real); }
  assert.ok(swapped);
  assert.ok(!existsSync(join(outside, 'context/ui.md')), 'the placed name is removed again');
  assert.equal(readFileSync(join(outside, 'context', swapped), 'utf8'), 'theirs');
  rmSync(dir, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('dybs-start has a recovery step for a method README that cannot be read', () => {
  const t = readFileSync(join(ROOT, 'skills/dybs-start/SKILL.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(t, /is a file that cannot be read \(its permissions\), stop and ask the human to fix its permissions or move it aside/);
});

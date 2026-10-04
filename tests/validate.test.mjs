import { test } from 'node:test';
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
  assert.equal(nextStep(results, 'each-doc'), 'project');
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
  assert.deepEqual(JSON.parse(ok.out), { schema: 2, accept: 'prd', ok: true, errors: [] });
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
  const { constants } = await import('node:fs');
  const real = { ...mod.fsOps };
  const calls = [];
  mod.fsOps.link = () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); };
  mod.fsOps.copyFile = (from, to, flags) => { calls.push(flags); return real.copyFile(from, to, flags); };
  const dir = mkdtempSync(join(tmpdir(), 'dybs-place-'));
  try {
    writeFileSync(join(dir, 'from'), 'new');
    mod.placeNoClobber(join(dir, 'from'), join(dir, 'to'));
    assert.equal(readFileSync(join(dir, 'to'), 'utf8'), 'new');
    assert.ok(!existsSync(join(dir, 'from')));
    assert.equal(calls.length, 1);
    assert.ok(calls[0] & constants.COPYFILE_EXCL);
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

test('--accept --json reports an operational failure as JSON', () => {
  const dir = copySample();
  const leftover = join(dir, 'dybs/context', `ui.md.dybs-${process.pid}.tmp`);
  writeFileSync(leftover, 'left over');
  const logs = [];
  const l = console.log; const e = console.error;
  console.log = (m) => logs.push(m); console.error = () => {};
  let code;
  try { code = main(['node', 'v', dir, '--accept', 'ui', '--json']); } finally { console.log = l; console.error = e; }
  assert.equal(code, 1);
  const out = JSON.parse(logs.join('\n'));
  assert.equal(out.ok, false);
  assert.equal(out.accept, 'ui');
  assert.match(out.errors.join(' '), /EEXIST|exists/);
  rmSync(dir, { recursive: true });
});

test('dybs-start carries the generated manual contract for checking without Node', async () => {
  const { rulesBlock, checklistsBlock } = await import('../scripts/sync-rules.mjs');
  const skill = readFileSync(join(ROOT, 'skills/dybs-start/SKILL.md'), 'utf8');
  assert.ok(skill.includes(rulesBlock()));
  assert.ok(skill.includes(checklistsBlock()));
  assert.match(skill, /without\s+Node, check every doc against \*\*Checking by hand\*\*/);
});

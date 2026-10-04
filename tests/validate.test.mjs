import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, cpSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DOCS, ORDER, MANUAL_RULES, validateDoc, validateProject, depthFor, acceptDoc, acceptedHash, nextStep, main } from '../skills/dybs-start/scripts/dybs-validate.mjs';

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
  assert.equal(acceptedHash({}, 'a\r\nb\n'), acceptedHash({ status: 'draft', updated: '2026-01-01' }, 'a\nb'));
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
  assert.deepEqual(project('skip: uix').rules, ['doc-lists']);
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

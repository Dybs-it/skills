import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, cpSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DOCS, ORDER, MANUAL_RULES, validateDoc, validateProject } from '../skills/dybs-start/scripts/dybs-validate.mjs';

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
  edit(dir, 'context/scope.md', (t) => t + '\n' + 'word '.repeat(DOCS.scope.maxWords));
  const r = validateProject(dir).results.find((x) => x.name === 'scope');
  assert.ok(r.errors.some((e) => e.includes('cap is')));
  rmSync(dir, { recursive: true });
});

test('HTML comments do not count toward the cap', () => {
  const dir = copySample();
  edit(dir, 'context/scope.md', (t) => t + `\n<!-- ${'guidance '.repeat(DOCS.scope.maxWords)} -->\n`);
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

// Each manual rule is broken on its own in an otherwise valid doc; the
// validator must report exactly that rule. This is what keeps checking by
// hand and the validator equivalent, not just similar text.
const VALID_PRD = readFileSync(join(SAMPLE, 'dybs/context/prd.md'), 'utf8');
const BREAK = {
  'frontmatter': (t) => t.replace(/^---[\s\S]*?---\n/, ''),
  'doc-name': (t) => t.replace('doc: prd', 'doc: scope'),
  'status': (t) => t.replace('status: accepted', 'status: done'),
  'updated': (t) => t.replace(/updated: .*/, 'updated: yesterday'),
  'accepted-date': (t) => t.replace(/^accepted: .*\n/m, ''),
  'sections': (t) => t.replace('## Goals', '## Aims'),
  'cap': (t) => t + '\n' + 'word '.repeat(DOCS.prd.maxWords),
  'html': (t) => t + '\n<div>\nhidden\n</div>\n',
  'placeholder': (t) => t + '\nTODO\n',
};

test('every manual rule has a breaking fixture, and the fixtures cover nothing else', () => {
  assert.deepEqual(Object.keys(BREAK).sort(), MANUAL_RULES.map((r) => r.id).sort());
});

for (const rule of MANUAL_RULES) {
  test(`validator enforces manual rule "${rule.id}"`, () => {
    assert.deepEqual(validateDoc('prd', VALID_PRD).rules, [], 'baseline must be valid');
    const r = validateDoc('prd', BREAK[rule.id](VALID_PRD));
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

test('project.md can never be skipped', () => {
  const dir = copySample();
  edit(dir, 'project.md', (t) => t.replace(/^skip:.*$/m, 'skip: project'));
  assert.notEqual(validateProject(dir).results.find((x) => x.name === 'project').status, 'skipped');
  rmSync(dir, { recursive: true });
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
  edit(dir, 'context/prd.md', (t) => t + '\nSee `example\n<!-- TODO -->\ncontinued` here.\n');
  const r = validateProject(dir).results.find((x) => x.name === 'prd');
  assert.ok(r.rules.includes('placeholder'));
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

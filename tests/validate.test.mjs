import { test } from 'node:test';
import { unprivileged, UNPRIVILEGED_SKIP } from './unprivileged.mjs';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, cpSync, writeFileSync, rmSync, existsSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
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
  // A folder where a doc should be is reported as that doc's error, in JSON.
  assert.match(JSON.stringify(out.results), /project\.md is not a regular file/);
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

test('an indented code block inside a block quote is code', async () => {
  const { wordCount } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  assert.equal(wordCount('> quoted words\n>\n>     code one two three\n\nafter'), 3);
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

test('a heading opening a list item, and a short setext underline, are block boundaries', async () => {
  const { wordCount, visibleText } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  assert.equal(wordCount('- ## Example\n      code words here\n'), 1);
  assert.equal(visibleText('open `\n--\ntext <!-- TODO -->\nclose `\n', { keepCode: true }), 'open `\n--\ntext \nclose `\n');
});

test('an indented code block in a list item ends at its own code column', async () => {
  const { wordCount } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  assert.equal(wordCount('- item\n\n      code\n    ordinary prose\n'), 3);
  assert.equal(wordCount('- item\n\n      code\n      more code\n'), 1);
});

test('indented code inside a nested list item starts four past the innermost item', async () => {
  const { wordCount } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  assert.equal(wordCount('10. outer\n    - nested\n\n        visible prose here\n'), 6);
  assert.equal(wordCount('10. outer\n    - nested\n\n          code here\n'), 3);
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

test('an unclosed <!-- in a paragraph is literal text, not a comment to the end', async () => {
  const { visibleText } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  // Never closed: CommonMark shows everything after it (checked against commonmark.js).
  assert.match(visibleText('ordinary <!-- never closes\nTODO visible\n'), /TODO visible/);
  assert.match(visibleText('ordinary <!-- a\n\nTODO later\n-->\n'), /TODO later/);
  // Closed later in the same paragraph, or opening a block: hidden.
  assert.doesNotMatch(visibleText('ordinary <!-- a\nTODO hidden\n-->\n'), /TODO/);
  assert.doesNotMatch(visibleText('<!-- a\n\nTODO hidden\n'), /TODO/);
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

test('2. followed by a heading after paragraph text is more of that paragraph', async () => {
  const { wordCount } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  // commonmark.js: one paragraph, so the indented line is prose.
  assert.equal(wordCount('ordinary\n2. ## fake\n    many words\n'), 5);
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
    // A second `--doc` is refused, not silently dropped.
    for (const args of [['--doc'], ['--doc', ''], ['--doc', '--json'], ['--doc', 'project', '--doc', 'prd']]) {
      assert.equal(main(['node', 'dybs-validate.mjs', SAMPLE, ...args]), 2, args.join(' '));
    }
  } finally { console.error = err; console.log = log; }
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

test('a list item opening with indented code, and lines leaving that item, are read as CommonMark does', async () => {
  const { visibleText, wordCount, headings } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  // `-     <!--`: five spaces after the marker make the rest indented code.
  for (const d of ['-     <!-- TODO\n', '1.     <!-- TODO\n', '> -     <!-- TODO\n']) {
    assert.match(visibleText(d, { keepCode: true }), /TODO/, d);
    assert.ok(!validateDoc('prd', VALID_PRD + '\n' + d).ok, d);
  }
  // Left of the item's content and after an HTML block: indented code.
  assert.match(visibleText('-    <!-- x\n    <!-- TODO\nTODO -->\n', { keepCode: true }), /TODO\nTODO/);
  // A lazy line outside the list's quote is measured from the margin.
  assert.match(visibleText('> - y\n    <!-- TODO\n', { keepCode: true }), /TODO/);
  // A quote closed by a blank line takes its list with it.
  assert.match(visibleText('> - y\n\n    <!-- TODO\nTODO -->\n', { keepCode: true }), /<!-- TODO/);
  // An inline comment that closes keeps its paragraph going.
  assert.equal(wordCount('text\n    <!-- TODO\nTODO -->\n    <!-- TODO\n'), 2);
  // A fence outside the list's quote opens at the margin and holds `## H`.
  assert.deepEqual(headings('> - y\n   ```\n## H\n'), []);
  assert.deepEqual(headings('> - y\n    <!-- TODO\n   ```\n## H\n'), []);
  // `    <!--` at the item's content column opens an HTML block there, so
  // the inline comment above it never closes.
  assert.match(visibleText('- a\n      <!-- TODO\n    <!--\n-->\n', { keepCode: true }), /TODO/);
});

test('a missing method README routes to dybs-start, never to a "readme" phase', async () => {
  const { main } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  const dir = copySample();
  rmSync(join(dir, 'dybs/README.md'));
  const logs = [];
  const l = console.log; const e = console.error;
  console.log = (m) => logs.push(m); console.error = () => {};
  try { main(['node', 'v', dir, '--json']); } finally { console.log = l; console.error = e; }
  assert.equal(JSON.parse(logs.join('\n')).next, 'project');
  logs.length = 0;
  console.log = (m) => logs.push(m); console.error = () => {};
  try { main(['node', 'v', dir]); } finally { console.log = l; console.error = e; }
  assert.ok(!logs.join('\n').includes('Next: readme'));
  rmSync(dir, { recursive: true });
});

test('list items, quotes and formatting cannot hide a placeholder or raw HTML (round 9)', async () => {
  const { visibleText } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  // `  2. ` inside an item's paragraph continues it; no comment opens.
  assert.match(visibleText('- ordinary\n  2. <!--\n     TODO\n', { keepCode: true }), /TODO/);
  // Formatting that splits a placeholder still shows it whole.
  for (const x of ['T**O**DO', '[TO](x)DO', 'T`O`DO', '{**{x}**}']) {
    assert.ok(validateDoc('prd', VALID_PRD + '\n' + x + '\n').rules.includes('placeholder'), x);
  }
  // A blank line ends the quote and its fence: the next quote is read.
  assert.ok(validateDoc('prd', VALID_PRD + '\n> ```\n\n> <div>visible</div>\n').rules.includes('html'));
  assert.match(visibleText('- > ```\n>\n  > TODO\n'), /TODO/);
  // `- - <!--`: the comment sits in the inner item, which `  TODO` leaves.
  assert.match(visibleText('- - <!--\n  TODO visible\n', { keepCode: true }), /TODO visible/);
});

test('every list marker on one line counts: `- - item` content sits at column 4', async () => {
  const { wordCount } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  // commonmark.js: "more words here" is a paragraph in the inner item.
  assert.equal(wordCount('- - item\n\n      more words here\n'), 4);
});

test('balanced link destinations and empty list items read as CommonMark does', async () => {
  const { wordCount, visibleText } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  // `](foo(bar))` is one destination: the link text and what follows read `TODO`.
  assert.ok(validateDoc('prd', VALID_PRD + '\nT[O](foo(bar))DO\n').rules.includes('placeholder'));
  // `-` alone takes its one space: content at column 2, so five spaces are
  // three inside the item, a paragraph (commonmark.js: `<li>more words here</li>`).
  assert.equal(wordCount('-\n     more words here\n'), 3);
  // ...and `      <!--` under it is four past that, indented code, not a comment.
  assert.match(visibleText('-\n      <!--\n   TODO\n-->\n', { keepCode: true }), /TODO/);
  // An empty item ends at a blank line: what follows is read from the margin.
  assert.match(visibleText('  - \n\n     <!-- x\n    code TODO\n', { keepCode: true }), /TODO/);
  // A bare `-` right after paragraph text is its setext underline, no item:
  // `     <!--` below the heading is indented code.
  assert.match(visibleText('-->\n-\n     <!--\n   TODO\n', { keepCode: true }), /TODO/);
});

test('quoted link titles and inline comments holding `--` cannot hide a placeholder', () => {
  // `"x)"` is the link's title: the destination closes after it, so the text reads TODO.
  assert.ok(validateDoc('prd', VALID_PRD + '\nT[O](foo "x)")DO\n').rules.includes('placeholder'));
  // Inside a paragraph, a comment holding `--` is literal text on the older
  // grammar GitHub renders with, so its TODO is visible there.
  assert.ok(validateDoc('prd', VALID_PRD + '\nordinary <!-- TODO -- bad --> text\n').rules.includes('placeholder'));
  assert.ok(validateDoc('prd', VALID_PRD + '\nordinary <!-- TODO\nstill -- bad --> text\n').rules.includes('placeholder'));
  // A well-formed inline comment, and any block comment, still hide.
  assert.ok(!validateDoc('prd', VALID_PRD + '\nordinary <!-- TODO --> text\n').rules.includes('placeholder'));
  assert.ok(!validateDoc('prd', VALID_PRD + '\n<!-- TODO -- block -->\n').rules.includes('placeholder'));
});

test('items opening with code, link destinations, escapes and escaped title quotes read as CommonMark does', async () => {
  const { wordCount } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  // `-\t\tfoo`: one column of padding, the rest indented code (CommonMark example 7).
  assert.equal(wordCount('-\t\tfoo bar\n'), 0);
  assert.ok(!validateDoc('prd', VALID_PRD + '\n-     <div>code</div>\n').rules.includes('html'));
  // A link destination in angle brackets is no raw HTML.
  assert.ok(!validateDoc('prd', VALID_PRD + '\nSee [the details](<details>).\n').rules.includes('html'));
  // `\{\{x\}\}` renders as `{{x}}`.
  assert.ok(validateDoc('prd', VALID_PRD + '\n\\{\\{product\\}\\}\n').rules.includes('placeholder'));
  // An escaped quote does not close a link title.
  assert.ok(validateDoc('prd', VALID_PRD + '\nT[O](foo "x\\")")DO\n').rules.includes('placeholder'));
});

test('a reference definition with an angle-bracketed destination is no raw HTML', () => {
  assert.ok(!validateDoc('prd', VALID_PRD + '\nSee [the details].\n\n[the details]: <details>\n').rules.includes('html'));
  // A real tag on its own line still is.
  assert.ok(validateDoc('prd', VALID_PRD + '\n<details>\n').rules.includes('html'));
});

test('link metadata is no prose, formatted headings count, and a FIFO doc never hangs the check', async () => {
  const { wordCount } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  // Destinations, titles and reference definitions are not shown (commonmark.js).
  assert.equal(wordCount('[hello](https://example.com/a-long-path)\n'), 1);
  assert.equal(wordCount('x [a](<b c> "t t") y\n'), 3);
  assert.equal(wordCount('text\n\n[r]: http://x "a title"\n'), 1);
  // Malformed ones are text, and count.
  assert.equal(wordCount('text [b](c d e)\n'), 5);
  assert.equal(wordCount('[r]: s t\n'), 3);
  // `## **Goals**` renders as Goals.
  const formatted = VALID_PRD.replace(/^## (.+)$/gm, '## **$1**');
  assert.ok(!validateDoc('prd', formatted).rules.includes('sections'), 'formatted headings satisfy the sections');
  // A FIFO at a doc's name: an error, not a hang.
  const dir = copySample();
  rmSync(join(dir, 'dybs/context/prd.md'));
  execFileSync('mkfifo', [join(dir, 'dybs/context/prd.md')]);
  const r = validateProject(dir);
  assert.equal(r.ok, false);
  assert.match(r.results.find((x) => x.name === 'prd').errors.join(' '), /not a regular file/);
  rmSync(dir, { recursive: true });
});

test('a malformed link never hides raw HTML from the check', () => {
  // Unescaped whitespace makes this no link: `<details>` is rendered raw HTML.
  assert.ok(validateDoc('prd', VALID_PRD + '\n[x](bad destination <details>)\n').rules.includes('html'));
  // A well-formed one is still fine.
  assert.ok(!validateDoc('prd', VALID_PRD + '\n[x](<details>)\n').rules.includes('html'));
});

test('only a well-formed reference definition is left out of the HTML scan, the headings and the word count', async () => {
  const { wordCount } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  // Trailing text makes this no definition: `<details>` is rendered raw HTML.
  assert.ok(validateDoc('prd', VALID_PRD + '\n[x]: <details> garbage\n').rules.includes('html'));
  // Inside a paragraph it is no definition either.
  assert.ok(validateDoc('prd', VALID_PRD + '\ntext\n[x]: <details>\n').rules.includes('html'));
  // A well-formed one, also with a title, is still fine.
  assert.ok(!validateDoc('prd', VALID_PRD + '\n[x]: <details> "a title"\n').rules.includes('html'));
  // `## [Goals](bad destination)` renders the brackets and the destination.
  const broken = VALID_PRD.replace('## Goals', '## [Goals](bad destination)');
  assert.ok(validateDoc('prd', broken).rules.includes('sections'));
  const linked = VALID_PRD.replace('## Goals', '## [Goals](https://example.com/goals "t")');
  assert.ok(!validateDoc('prd', linked).rules.includes('sections'));
  // A reference link renders its text only when the label is defined.
  const undefinedRef = VALID_PRD.replace('## Goals', '## [Goals][g]');
  assert.ok(validateDoc('prd', undefinedRef).rules.includes('sections'));
  assert.ok(!validateDoc('prd', undefinedRef + '\n[g]: https://example.com\n').rules.includes('sections'));
  // A title on the line after the destination is not shown.
  assert.equal(wordCount('text\n\n[r]: /url\n  "a long title here"\n'), 1);
  assert.equal(wordCount('text\n\n[r]: /url\n(a long title)\n'), 1);
  // Only directly after a definition without a title of its own.
  assert.equal(wordCount('text\n\n[r]: /url "t"\n"shown words"\n'), 3);
  // A label of only whitespace defines nothing.
  assert.equal(wordCount("[ ]: /u\n"), 1);
});

test('a destination is stripped only after a link opener, and headings are compared as rendered', async () => {
  const { wordCount } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  // No `[` opener: `](<details>)` is text and `<details>` raw HTML.
  assert.ok(validateDoc('prd', VALID_PRD + '\nRaw ](<details>) content\n').rules.includes('html'));
  // An escaped opener is none either.
  assert.ok(validateDoc('prd', VALID_PRD + '\n\\[a](<details>)\n').rules.includes('html'));
  // A link inside link text makes the outer one text (CommonMark).
  assert.ok(validateDoc('prd', VALID_PRD + '\n[a [b](c)](<details>)\n').rules.includes('html'));
  assert.ok(!validateDoc('prd', VALID_PRD + '\n[a](<details>)\n').rules.includes('html'));
  assert.equal(wordCount('Raw ](https://example.com/x) y\n'), 6);
  // `## Wh&#121;` renders as Why.
  const ref = VALID_PRD.replace('## Goals', '## Go&#97;ls');
  assert.ok(!validateDoc('prd', ref).rules.includes('sections'));
});

test('headings are read as rendered: inside a list or quote, and with escapes', () => {
  // `- ## Problem` and `> ## Users` render as H2s.
  const contained = VALID_PRD.replace('## Problem', '- ## Problem').replace('## Users', '> ## Users');
  assert.ok(!validateDoc('prd', contained).rules.includes('sections'));
  // A list cannot start at 2 inside a paragraph: there it is text.
  const lazy = VALID_PRD.replace('## Problem', 'text\n2. ## Problem');
  assert.ok(validateDoc('prd', lazy).rules.includes('sections'));
  // Five spaces after the marker make indented code.
  const code = VALID_PRD.replace('## Problem', '-     ## Problem');
  assert.ok(validateDoc('prd', code).rules.includes('sections'));
  // `\'` renders as `'`; an escaped marker stays literal.
  const VALID_UI = readFileSync(join(SAMPLE, 'dybs/context/ui.md'), 'utf8');
  assert.ok(!validateDoc('ui', VALID_UI).rules.includes('sections'));
  const escaped = VALID_UI.replace("## Do and don't", "## Do and don\\'t");
  assert.notEqual(escaped, VALID_UI);
  assert.ok(!validateDoc('ui', escaped).rules.includes('sections'));
  const literal = VALID_PRD.replace('## Goals', '## Go\\*als');
  assert.ok(validateDoc('prd', literal).rules.includes('sections'));
  // An escaped `&` starts no character reference.
  assert.ok(validateDoc('prd', VALID_PRD.replace('## Goals', '## Go\\&#97;ls')).rules.includes('sections'));
});

test('a context folder that cannot be searched fails validation, not "missing"', (t) => {
  const dir = copySample();
  chmodSync(dir, 0o755);
  chmodSync(join(dir, 'dybs/context'), 0o000);
  const cmd = unprivileged([join(ROOT, 'skills/dybs-start/scripts/dybs-validate.mjs'), dir, '--json']);
  if (!cmd) { chmodSync(join(dir, 'dybs/context'), 0o755); rmSync(dir, { recursive: true }); return t.skip(UNPRIVILEGED_SKIP); }
  let out; let code = 0;
  try { out = execFileSync(cmd[0], cmd[1], { encoding: 'utf8', stdio: 'pipe' }); } catch (e) { out = e.stdout; code = e.status; }
  chmodSync(join(dir, 'dybs/context'), 0o755);
  assert.notEqual(code, 0, out);
  assert.match(out, /EACCES/);
  rmSync(dir, { recursive: true });
});

test('headings, placeholders and counts follow CommonMark for nesting, escapes, emphasis and reference labels', async () => {
  const { wordCount } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  // Recursively balanced destinations are one link.
  assert.ok(!validateDoc('prd', VALID_PRD.replace('## Goals', '## [Goals](foo(bar(baz)))')).rules.includes('sections'));
  assert.equal(wordCount('x [a](foo(bar(baz(qux)))) y\n'), 3);
  // Escaped asterisks render literally: `T*O*DO` is no TODO.
  assert.ok(!validateDoc('prd', VALID_PRD + '\nT\\*O\\*DO\n').rules.includes('placeholder'));
  assert.ok(validateDoc('prd', VALID_PRD + '\nT*O*DO\n').rules.includes('placeholder'));
  // Single tildes are text in CommonMark; only real emphasis is read through.
  // Code span content is literal: no emphasis read through inside it.
  for (const literal of ['G~o~als', 'Goals_', 'Go_al_s', '*Goals', 'G``o***al***s``']) {
    assert.ok(validateDoc('prd', VALID_PRD.replace('## Goals', `## ${literal}`)).rules.includes('sections'), literal);
  }
  for (const formatted of ['*Goals*', '_Goals_', 'G*oa*ls', '***Goals***', '`Goals`']) {
    assert.ok(!validateDoc('prd', VALID_PRD.replace('## Goals', `## ${formatted}`)).rules.includes('sections'), formatted);
  }
  // A full reference link shows its text, not its label.
  assert.equal(wordCount('[shown][three hidden words]\n\n[three hidden words]: /u\n'), 1);
  // Not after an escaped opener: then the label is a link of its own, shown.
  assert.equal(wordCount('\\[x][three hidden words]\n\n[three hidden words]: /u\n'), 4);
});

test('character references are counted as the text they render', async () => {
  const { wordCount } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  assert.equal(wordCount('A &amp; B\n'), 2);
  assert.equal(wordCount('Fran&#231;ais\n'), 1);
  // In code, and after an escaped `&`, a reference is shown as written.
  assert.equal(wordCount('`A &amp; B`\n'), 3);
  assert.equal(wordCount('A \\&amp; B\n'), 3);
  // A code span that may continue on the next line keeps its paragraph raw.
  assert.equal(wordCount('x `open\n&amp; y`\n'), 4);
});

test('a heading in a quote inside a list item counts', () => {
  assert.ok(!validateDoc('prd', VALID_PRD.replace('## Goals', '- > ## Goals')).rules.includes('sections'));
  assert.ok(!validateDoc('prd', VALID_PRD.replace('## Goals', '> - > ## Goals')).rules.includes('sections'));
});

test('project.md is validated from the same snapshot its settings came from', async () => {
  const mod = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  const dir = copySample();
  const projectPath = join(dir, 'dybs/project.md');
  // Saved between the settings read and its own validation: this run judges
  // the old project.md, never a mix of the two.
  mod.validateHooks.afterSettings = () => writeFileSync(projectPath, readFileSync(projectPath, 'utf8').replace(/^doc: project$/m, 'doc: wrong'));
  let r;
  try { r = validateProject(dir); } finally { mod.validateHooks.afterSettings = null; }
  assert.deepEqual(r.results.find((x) => x.name === 'project').errors, []);
  rmSync(dir, { recursive: true });
});

test('a malformed link is no placeholder, and an ordered item after a quoted heading starts a list', () => {
  // `(bad destination)` is no link destination: the text is not TODO.
  assert.ok(!validateDoc('prd', VALID_PRD + '\nT[O](bad destination)DO\n').rules.includes('placeholder'));
  assert.ok(validateDoc('prd', VALID_PRD + '\nT[O](good)DO\n').rules.includes('placeholder'));
  // After a heading inside the same quote, `2.` may start a list.
  const quoted = VALID_PRD.replace('## Goals', '> ## Intro\n> 2. ## Goals');
  assert.ok(!validateDoc('prd', quoted).rules.includes('sections'));
  assert.ok(validateDoc('prd', VALID_PRD.replace('## Goals', '> text\n> 2. ## Goals')).rules.includes('sections'));
});

test('code spans keep link syntax as text, defined references can split a placeholder, and a break ends a block', async () => {
  const { wordCount } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  // Inline code renders as written: all four words count.
  assert.equal(wordCount('`[shown][three hidden words]`\n\n[three hidden words]: /u\n'), 4);
  assert.equal(wordCount('`[a](http://x/y)` z\n'), 5);
  // `T[O][r]DO` renders TODO when `r` is defined.
  assert.ok(validateDoc('prd', VALID_PRD + '\nT[O][r]DO\n\n[r]: /url\n').rules.includes('placeholder'));
  assert.ok(validateDoc('prd', VALID_PRD + '\nT[O][]DO\n\n[o]: /url\n').rules.includes('placeholder'));
  // A thematic break ends the block before it: `2.` may start a list.
  assert.ok(!validateDoc('prd', VALID_PRD.replace('## Goals', '***\n2. ## Goals')).rules.includes('sections'));
});

test('a doc swapped for a link right before it is read is never read through the link', async () => {
  const mod = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  const { symlinkSync } = await import('node:fs');
  const dir = copySample();
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  const doc = join(dir, 'dybs/context/ui.md');
  writeFileSync(join(outside, 'ui.md'), readFileSync(doc, 'utf8'));
  mod.validateHooks.beforeRead = (p) => {
    if (p !== doc) return;
    rmSync(doc);
    symlinkSync(join(outside, 'ui.md'), doc);
  };
  let r;
  try { r = validateProject(dir, 'ui'); } finally { mod.validateHooks.beforeRead = null; }
  assert.equal(r.ok, false);
  assert.notDeepEqual(r.results.find((x) => x.name === 'ui').errors, []);
  rmSync(dir, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('destinations allow only punctuation escapes and one line ending; labels fold case; a destination may follow its label line', async () => {
  const { wordCount } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  // `\ ` escapes nothing in a destination: no link, so `<details>` is raw.
  assert.ok(validateDoc('prd', VALID_PRD + '\n[x](foo\\ <details>)\n').rules.includes('html'));
  // One line ending inside the target is allowed: `T[O](\nurl)DO` reads TODO.
  assert.ok(validateDoc('prd', VALID_PRD + '\nT[O](\nurl)DO\n').rules.includes('placeholder'));
  // A definition whose destination is on the next line.
  assert.ok(validateDoc('prd', VALID_PRD + '\nT[O][r]DO\n\n[r]:\n /url\n').rules.includes('placeholder'));
  assert.equal(wordCount('[r]:\n/url\n'), 0);
  // An underline after `[r]:` makes a heading, not a definition.
  assert.equal(wordCount('[r]:\n===\n'), 1);
  // `ẞ` folds to `ss`.
  assert.ok(validateDoc('prd', VALID_PRD + '\nT[O][ẞ]DO\n\n[ss]: /url\n').rules.includes('placeholder'));
});

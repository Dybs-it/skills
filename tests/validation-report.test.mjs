// --save: a whole-project validation written to dybs/.validation.json, so an
// app can show verdicts without running a project's own scripts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, cpSync, writeFileSync, existsSync, symlinkSync, mkdirSync, readdirSync, renameSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'skills/dybs-start/scripts/dybs-validate.mjs');
const SAMPLE = join(ROOT, 'tests/fixtures/sample-project');
const copySample = () => { const d = mkdtempSync(join(tmpdir(), 'dybs-save-')); cpSync(SAMPLE, d, { recursive: true }); return d; };
const run = (args) => spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

test('--save writes every doc with its verdict and the sha256 of its bytes', () => {
  const dir = copySample();
  const r = run([dir, '--save']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Saved dybs\/\.validation\.json\./);
  const rep = JSON.parse(readFileSync(join(dir, 'dybs/.validation.json'), 'utf8'));
  assert.equal(rep.kind, 'dybs-validation');
  assert.equal(rep.schema, 1);
  assert.ok(!Number.isNaN(Date.parse(rep.generatedAt)));
  const map = rep.docs.find((d) => d.name === 'map');
  assert.deepEqual({ file: map.file, status: map.status, valid: map.valid }, { file: 'dybs/discovery/map.md', status: 'accepted', valid: true });
  assert.equal(map.sha256, sha(join(dir, 'dybs/discovery/map.md')));
  assert.equal(rep.docs.length, 11);
  assert.deepEqual(readdirSync(join(dir, 'dybs')).filter((n) => n.endsWith('.tmp')), []);
});

test('--save with --json reports where it saved, and records a failing doc as invalid', () => {
  const dir = copySample();
  writeFileSync(join(dir, 'dybs/context/scope.md'), '---\ndoc: scope\nstatus: draft\n---\n# Scope\n');
  const r = run([dir, '--save', '--json']);
  const out = JSON.parse(r.stdout);
  assert.equal(out.saved, 'dybs/.validation.json');
  const rep = JSON.parse(readFileSync(join(dir, 'dybs/.validation.json'), 'utf8'));
  const scope = rep.docs.find((d) => d.name === 'scope');
  assert.equal(scope.valid, false);
  assert.ok(scope.errors > 0);
  assert.equal(rep.ok, false);
});

test('--save is refused with --doc, --accept and --set', () => {
  const dir = copySample();
  for (const extra of [['--doc', 'map'], ['--accept', 'map'], ['--set', 'working', 'github=no']]) {
    const r = run([dir, '--save', ...extra]);
    assert.equal(r.status, 2, extra.join(' '));
    assert.match(r.stderr, /--save goes with a plain validation/);
  }
  assert.equal(existsSync(join(dir, 'dybs/.validation.json')), false);
});

test('--save does not write through a symlink', () => {
  const dir = copySample();
  const outside = join(mkdtempSync(join(tmpdir(), 'dybs-out-')), 'victim.json');
  writeFileSync(outside, 'keep me');
  symlinkSync(outside, join(dir, 'dybs/.validation.json'));
  const r = run([dir, '--save']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not saved/);
  assert.equal(readFileSync(outside, 'utf8'), 'keep me');
});

test('--save does not replace a directory', () => {
  const dir = copySample();
  mkdirSync(join(dir, 'dybs/.validation.json'));
  const r = run([dir, '--save', '--json']);
  assert.equal(r.status, 1);
  assert.match(JSON.parse(r.stdout).saveError, /not a regular file/);
});

test('without --save nothing is written', () => {
  const dir = copySample();
  execFileSync('node', [SCRIPT, dir], { encoding: 'utf8' });
  assert.equal(existsSync(join(dir, 'dybs/.validation.json')), false);
});

test('a doc edited between validating and saving keeps the hash of the bytes that were validated (Codex review, PR 11)', async () => {
  const { validateProject, validateHooks, saveValidationReport } = await import(SCRIPT);
  const dir = copySample();
  const project = join(dir, 'dybs/project.md');
  const map = join(dir, 'dybs/discovery/map.md');
  const validatedProject = sha(project);
  const validatedMap = sha(map);
  // project.md replaced right after its settings were read: it is validated
  // from the bytes read before, so the saved hash must be of those bytes.
  validateHooks.afterSettings = () => writeFileSync(project, '---\ndoc: project\nstatus: accepted\n---\nbroken\n');
  let report;
  try { report = validateProject(dir); } finally { validateHooks.afterSettings = null; }
  // And a doc saved by an editor after the whole check, before the save.
  writeFileSync(map, readFileSync(map, 'utf8') + '\nEdited later.\n');
  saveValidationReport(dir, report, null);
  const rep = JSON.parse(readFileSync(join(dir, 'dybs/.validation.json'), 'utf8'));
  const byName = Object.fromEntries(rep.docs.map((d) => [d.name, d]));
  assert.equal(byName.project.valid, true);
  assert.equal(byName.project.sha256, validatedProject);
  assert.notEqual(byName.project.sha256, sha(project));
  assert.equal(byName.map.sha256, validatedMap);
  assert.notEqual(byName.map.sha256, sha(map));
});

test('acceptedUnchanged is true only when --accept fingerprinted the doc (field run, PR 11)', () => {
  const dir = copySample();
  // The sample's docs were accepted by hand: no accepted-hash.
  let r = run([dir, '--save']);
  let rep = JSON.parse(readFileSync(join(dir, 'dybs/.validation.json'), 'utf8'));
  const map = () => rep.docs.find((d) => d.name === 'map');
  assert.equal(map().status, 'accepted');
  assert.equal(map().acceptedUnchanged, false);
  // Back to draft, then accepted through the validator.
  const p = join(dir, 'dybs/discovery/map.md');
  writeFileSync(p, readFileSync(p, 'utf8').replace('status: accepted', 'status: draft').replace(/^accepted: .*\n/m, ''));
  r = run([dir, '--accept', 'map']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  run([dir, '--save']);
  rep = JSON.parse(readFileSync(join(dir, 'dybs/.validation.json'), 'utf8'));
  assert.equal(map().acceptedUnchanged, true);
  // A draft is never a verified acceptance.
  assert.equal(rep.docs.find((d) => d.name === 'ui').acceptedUnchanged, false);
});

// Review round 1 (dybs-review on PR 11).
const report = (dir) => JSON.parse(readFileSync(join(dir, 'dybs/.validation.json'), 'utf8'));
const tmps = (d) => existsSync(d) ? readdirSync(d).filter((n) => n.endsWith('.tmp')) : [];
const toDraft = (p) => writeFileSync(p, readFileSync(p, 'utf8').replace('status: accepted', 'status: draft').replace(/^accepted: .*\n/m, ''));

test('a doc edited after --accept is saved as invalid and not acceptedUnchanged (V2)', () => {
  const dir = copySample();
  const p = join(dir, 'dybs/discovery/map.md');
  toDraft(p);
  assert.equal(run([dir, '--accept', 'map']).status, 0);
  appendFileSync(p, '\nEdited after acceptance.\n');
  run([dir, '--save']);
  const map = report(dir).docs.find((d) => d.name === 'map');
  assert.equal(map.status, 'accepted');
  assert.equal(map.valid, false);
  assert.equal(map.acceptedUnchanged, false);
});

test('--accept refreshes a saved report, so the doc just accepted is not stale (P1)', () => {
  const dir = copySample();
  const p = join(dir, 'dybs/discovery/map.md');
  toDraft(p);
  run([dir, '--save']);
  assert.equal(report(dir).docs.find((d) => d.name === 'map').status, 'draft');
  const r = run([dir, '--accept', 'map']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Updated dybs\/\.validation\.json\./);
  const map = report(dir).docs.find((d) => d.name === 'map');
  assert.equal(map.status, 'accepted');
  assert.equal(map.acceptedUnchanged, true);
  assert.equal(map.sha256, sha(p));
});

test('--set refreshes a saved report too (P1)', () => {
  const dir = copySample();
  run([dir, '--save']);
  const r = run([dir, '--set', 'working', 'github=no', '--json']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).saved, 'dybs/.validation.json');
  assert.equal(report(dir).docs.find((d) => d.name === 'working').sha256, sha(join(dir, 'dybs/context/working.md')));
});

test('--accept creates no report when none was saved (P1)', () => {
  const dir = copySample();
  toDraft(join(dir, 'dybs/discovery/map.md'));
  assert.equal(run([dir, '--accept', 'map']).status, 0);
  assert.equal(existsSync(join(dir, 'dybs/.validation.json')), false);
});

test('the saved values are the ones --json reports for the same project (V3)', () => {
  const dir = copySample();
  writeFileSync(join(dir, 'dybs/context/scope.md'), '---\ndoc: scope\nstatus: draft\n---\n# Scope\n');
  const json = JSON.parse(run([dir, '--json']).stdout);
  run([dir, '--save']);
  const rep = report(dir);
  for (const k of ['next', 'complete', 'accepted', 'atRequestedDepth', 'ok']) assert.deepEqual(rep[k], json[k], k);
  assert.equal(rep.next, 'scope');
  for (const r of json.results.filter((x) => x.name !== 'readme')) {
    const d = rep.docs.find((x) => x.name === r.name);
    assert.deepEqual([d.status, d.errors, d.warnings, d.needsDeepening], [r.status, r.errors.length, r.warnings.length, !!r.needsDeepening], r.name);
  }
});

test('--json prints no per-doc hash or fingerprint flag (P2)', () => {
  const dir = copySample();
  const json = JSON.parse(run([dir, '--json']).stdout);
  for (const r of json.results) {
    assert.equal('sha256' in r, false, r.name);
    assert.equal('fingerprinted' in r, false, r.name);
  }
});

test('a failed save still prints the verdict, then the error (P4)', () => {
  const dir = copySample();
  mkdirSync(join(dir, 'dybs/.validation.json'));
  const r = run([dir, '--save']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /dybs\/|discovery\/map\.md/);
  assert.match(r.stdout, /Next:|All Getting Started docs|All docs written/);
  assert.match(r.stderr, /not saved/);
});

test('--save refuses a dybs/ that is a link, and writes nothing where it points (V1)', () => {
  const dir = copySample();
  const outside = mkdtempSync(join(tmpdir(), 'dybs-out-'));
  cpSync(join(dir, 'dybs'), outside, { recursive: true });
  renameSync(join(dir, 'dybs'), join(dir, 'dybs.moved'));
  symlinkSync(outside, join(dir, 'dybs'));
  const r = run([dir, '--save']);
  assert.equal(r.status, 1);
  assert.equal(existsSync(join(outside, '.validation.json')), false);
  assert.deepEqual(tmps(outside), []);
});

test('--save in a folder without dybs/ fails and creates nothing (V6)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dybs-empty-'));
  const r = run([dir, '--save']);
  assert.equal(r.status, 1);
  assert.equal(existsSync(join(dir, 'dybs')), false);
});

test('dybs/ swapped for a link while saving: the report stays in the folder that was checked (X2)', async () => {
  const { validateProject, saveHooks, saveValidationReport, projectNext } = await import(SCRIPT);
  const dir = copySample();
  const outside = mkdtempSync(join(tmpdir(), 'dybs-out-'));
  const rep = validateProject(dir);
  saveHooks.beforeCreate = () => { renameSync(join(dir, 'dybs'), join(dir, 'dybs.real')); symlinkSync(outside, join(dir, 'dybs')); };
  try { saveValidationReport(dir, rep, projectNext(rep)); } finally { saveHooks.beforeCreate = null; }
  assert.equal(existsSync(join(outside, '.validation.json')), false);
  assert.deepEqual(readdirSync(outside), []);
  assert.equal(JSON.parse(readFileSync(join(dir, 'dybs.real/.validation.json'), 'utf8')).kind, 'dybs-validation');
});

test('dybs/ swapped before the save enters it: refused, nothing written anywhere (X2)', async () => {
  const { validateProject, saveHooks, saveValidationReport, projectNext } = await import(SCRIPT);
  const dir = copySample();
  const outside = mkdtempSync(join(tmpdir(), 'dybs-out-'));
  const rep = validateProject(dir);
  saveHooks.afterOpenDir = () => { renameSync(join(dir, 'dybs'), join(dir, 'dybs.real')); symlinkSync(outside, join(dir, 'dybs')); };
  try {
    assert.throws(() => saveValidationReport(dir, rep, projectNext(rep)), /changed while the report was being saved/);
  } finally { saveHooks.afterOpenDir = null; }
  assert.deepEqual(readdirSync(outside), []);
  assert.equal(existsSync(join(dir, 'dybs.real/.validation.json')), false);
});

test('a failed write or rename leaves no temporary file (P3, V4)', async () => {
  const { validateProject, saveHooks, saveValidationReport, projectNext } = await import(SCRIPT);
  for (const hook of ['beforeWrite', 'beforeRename']) {
    const dir = copySample();
    const rep = validateProject(dir);
    const cwd = process.cwd();
    saveHooks[hook] = () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); };
    try {
      assert.throws(() => saveValidationReport(dir, rep, projectNext(rep)), /disk full/);
    } finally { saveHooks[hook] = null; }
    assert.deepEqual(tmps(join(dir, 'dybs')), [], hook);
    assert.equal(existsSync(join(dir, 'dybs/.validation.json')), false, hook);
    assert.equal(process.cwd(), cwd, hook);
  }
});

test('the report records what every verdict depends on: project.md and the validator (X3)', () => {
  const dir = copySample();
  run([dir, '--save']);
  const rep = report(dir);
  assert.equal(rep.basis['dybs/project.md'], sha(join(dir, 'dybs/project.md')));
  assert.equal(rep.basis.validator, sha(SCRIPT));
});

test('a draft that kept an accepted-hash is not fingerprinted (V5)', async () => {
  const { validateDoc } = await import(SCRIPT);
  const text = readFileSync(join(SAMPLE, 'dybs/discovery/map.md'), 'utf8').replace('status: accepted', 'status: draft').replace(/^accepted: .*\n/m, 'accepted-hash: 0123456789ab\n');
  const r = validateDoc('map', text);
  assert.equal(r.status, 'draft');
  assert.equal(r.fingerprinted, false);
});

test('every skill with a Validating step carries the same text, with --save (S5)', () => {
  const block = (t) => {
    const i = t.indexOf('- **Validating:**');
    return i < 0 ? null : t.slice(i, t.indexOf('\n\n', i));
  };
  const blocks = readdirSync(join(ROOT, 'skills'))
    .map((s) => [s, block(readFileSync(join(ROOT, 'skills', s, 'SKILL.md'), 'utf8'))])
    .filter(([, b]) => b !== null);
  assert.ok(blocks.length >= 9, `found ${blocks.length}`);
  for (const [s, b] of blocks) {
    assert.equal(b, blocks[0][1], s);
    assert.match(b, /node <path> \. --save/, s);
  }
});

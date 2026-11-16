// --save: a whole-project validation written to dybs/.validation.json, so an
// app can show verdicts without running a project's own scripts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, cpSync, writeFileSync, existsSync, symlinkSync, mkdirSync, readdirSync } from 'node:fs';
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

test('an acceptance is verified only when --accept fingerprinted it (field run, PR 11)', () => {
  const dir = copySample();
  // The sample's docs were accepted by hand: no accepted-hash.
  let r = run([dir, '--save']);
  let rep = JSON.parse(readFileSync(join(dir, 'dybs/.validation.json'), 'utf8'));
  const map = () => rep.docs.find((d) => d.name === 'map');
  assert.equal(map().status, 'accepted');
  assert.equal(map().acceptanceVerified, false);
  // Back to draft, then accepted through the validator.
  const p = join(dir, 'dybs/discovery/map.md');
  writeFileSync(p, readFileSync(p, 'utf8').replace('status: accepted', 'status: draft').replace(/^accepted: .*\n/m, ''));
  r = run([dir, '--accept', 'map']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  run([dir, '--save']);
  rep = JSON.parse(readFileSync(join(dir, 'dybs/.validation.json'), 'utf8'));
  assert.equal(map().acceptanceVerified, true);
  // A draft is never a verified acceptance.
  assert.equal(rep.docs.find((d) => d.name === 'ui').acceptanceVerified, false);
});

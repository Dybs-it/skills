import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  PKG_ROOT, MANIFEST, installTarget, uninstallTarget, detectTargets, skillNames, desiredFiles,
} from '../src/install.mjs';

const project = () => mkdtempSync(join(tmpdir(), 'dybs-install-'));
const ops = (r) => Object.fromEntries(r.actions.map((a) => [a.rel, a.op]));
const SKILL = 'dybs-prd/SKILL.md';

test('fresh install writes every skill file and a manifest', () => {
  const root = project();
  installTarget(root, 'claude');
  for (const s of skillNames()) assert.ok(existsSync(join(root, '.claude/skills', s, 'SKILL.md')), s);
  assert.ok(existsSync(join(root, '.claude/skills/dybs-start/scripts/dybs-validate.mjs')));
  const m = JSON.parse(readFileSync(join(root, '.claude/skills', MANIFEST), 'utf8'));
  assert.equal(Object.keys(m.files).length, Object.keys(desiredFiles('claude')).length);
  rmSync(root, { recursive: true });
});

test('re-install is a no-op', () => {
  const root = project();
  installTarget(root, 'agents');
  const r = installTarget(root, 'agents');
  assert.ok(r.actions.every((a) => a.op === 'same'));
  rmSync(root, { recursive: true });
});

test('a file the user edited is never overwritten without --force', () => {
  const root = project();
  installTarget(root, 'claude');
  const p = join(root, '.claude/skills', SKILL);
  writeFileSync(p, 'my own version');
  const r = installTarget(root, 'claude');
  assert.equal(ops(r)[SKILL], 'conflict');
  assert.equal(readFileSync(p, 'utf8'), 'my own version');
  // and it stays ours in the manifest, so a second run still treats it as a conflict
  assert.equal(ops(installTarget(root, 'claude'))[SKILL], 'conflict');
  rmSync(root, { recursive: true });
});

test('--force replaces an edited file and keeps a backup', () => {
  const root = project();
  installTarget(root, 'claude');
  const p = join(root, '.claude/skills', SKILL);
  writeFileSync(p, 'my own version');
  const r = installTarget(root, 'claude', { force: true });
  assert.equal(ops(r)[SKILL], 'replace');
  assert.equal(readFileSync(`${p}.bak`, 'utf8'), 'my own version');
  assert.notEqual(readFileSync(p, 'utf8'), 'my own version');
  rmSync(root, { recursive: true });
});

test('a pre-existing file we never installed is a conflict, not an overwrite', () => {
  const root = project();
  const p = join(root, '.claude/skills', SKILL);
  mkdirSync(join(root, '.claude/skills/dybs-prd'), { recursive: true });
  writeFileSync(p, 'someone else');
  const r = installTarget(root, 'claude');
  assert.equal(r.actions.find((a) => a.rel === SKILL).why, 'not installed by dybs-skills');
  assert.equal(readFileSync(p, 'utf8'), 'someone else');
  rmSync(root, { recursive: true });
});

test('an unchanged file from an older version is updated', () => {
  const root = project();
  installTarget(root, 'claude');
  const dir = join(root, '.claude/skills');
  const p = join(dir, SKILL);
  // Simulate an older shipped version: different bytes, recorded in the manifest.
  writeFileSync(p, 'old shipped version');
  const m = JSON.parse(readFileSync(join(dir, MANIFEST), 'utf8'));
  m.files[SKILL] = createHash('sha256').update('old shipped version').digest('hex');
  writeFileSync(join(dir, MANIFEST), JSON.stringify(m));
  assert.equal(ops(installTarget(root, 'claude'))[SKILL], 'update');
  assert.notEqual(readFileSync(p, 'utf8'), 'old shipped version');
  rmSync(root, { recursive: true });
});

test('a file no longer shipped is removed only if unchanged', () => {
  const root = project();
  installTarget(root, 'claude');
  const dir = join(root, '.claude/skills');
  const m = JSON.parse(readFileSync(join(dir, MANIFEST), 'utf8'));
  mkdirSync(join(dir, 'dybs-old'), { recursive: true });
  writeFileSync(join(dir, 'dybs-old/SKILL.md'), 'retired');
  writeFileSync(join(dir, 'dybs-old/notes.md'), 'edited by user');
  m.files['dybs-old/SKILL.md'] = createHash('sha256').update('retired').digest('hex');
  m.files['dybs-old/notes.md'] = createHash('sha256').update('as shipped').digest('hex');
  writeFileSync(join(dir, MANIFEST), JSON.stringify(m));
  const r = ops(installTarget(root, 'claude'));
  assert.equal(r['dybs-old/SKILL.md'], 'remove');
  assert.equal(r['dybs-old/notes.md'], 'keep');
  assert.equal(existsSync(join(dir, 'dybs-old/SKILL.md')), false);
  assert.equal(readFileSync(join(dir, 'dybs-old/notes.md'), 'utf8'), 'edited by user');
  rmSync(root, { recursive: true });
});

test('other skills in the same folder are never touched', () => {
  const root = project();
  mkdirSync(join(root, '.claude/skills/bmad-help'), { recursive: true });
  writeFileSync(join(root, '.claude/skills/bmad-help/SKILL.md'), 'bmad');
  installTarget(root, 'claude');
  uninstallTarget(root, 'claude');
  assert.equal(readFileSync(join(root, '.claude/skills/bmad-help/SKILL.md'), 'utf8'), 'bmad');
  rmSync(root, { recursive: true });
});

test('uninstall removes our unchanged files and keeps edited ones', () => {
  const root = project();
  installTarget(root, 'claude');
  writeFileSync(join(root, '.claude/skills', SKILL), 'edited');
  const r = uninstallTarget(root, 'claude');
  assert.equal(ops(r)[SKILL], 'keep');
  assert.equal(existsSync(join(root, '.claude/skills/dybs-start')), false);
  assert.equal(readFileSync(join(root, '.claude/skills', SKILL), 'utf8'), 'edited');
  assert.equal(existsSync(join(root, '.claude/skills', MANIFEST)), false);
  rmSync(root, { recursive: true });
});

test('dry run writes nothing', () => {
  const root = project();
  const r = installTarget(root, 'claude', { dryRun: true });
  assert.ok(r.actions.every((a) => a.op === 'add'));
  assert.equal(existsSync(join(root, '.claude')), false);
  rmSync(root, { recursive: true });
});

test('opencode commands point at the shared .agents skills', () => {
  const root = project();
  installTarget(root, 'opencode');
  const files = readdirSync(join(root, '.opencode/commands')).filter((f) => f.endsWith('.md'));
  assert.equal(files.length, skillNames().length);
  assert.match(readFileSync(join(root, '.opencode/commands/dybs-start.md'), 'utf8'), /\.agents\/skills\/dybs-start\/SKILL\.md/);
  rmSync(root, { recursive: true });
});

test('target detection', () => {
  const root = project();
  assert.deepEqual(detectTargets(root), ['claude', 'agents']);
  mkdirSync(join(root, '.opencode'));
  assert.deepEqual(detectTargets(root), ['opencode', 'agents']);
  writeFileSync(join(root, 'CLAUDE.md'), '');
  assert.deepEqual(detectTargets(root), ['claude', 'opencode', 'agents']);
  rmSync(root, { recursive: true });
});

test('CLI: install, status, validate, uninstall', () => {
  const root = project();
  const cli = (...args) => execFileSync('node', [join(PKG_ROOT, 'bin/dybs-skills.mjs'), ...args], { encoding: 'utf8' });
  assert.match(cli('install', root, '--tools', 'claude'), /dybs start/);
  assert.match(cli('status', root), /claude\s+\.claude\/skills\s+v\d/);
  assert.match(cli('validate', join(PKG_ROOT, 'tests/fixtures/sample-project')), /Next: ui/);
  cli('uninstall', root);
  assert.equal(existsSync(join(root, '.claude/skills/dybs-start')), false);
  rmSync(root, { recursive: true });
});

test('CLI: conflicts exit non-zero', () => {
  const root = project();
  const bin = join(PKG_ROOT, 'bin/dybs-skills.mjs');
  execFileSync('node', [bin, 'install', root, '--tools', 'claude']);
  writeFileSync(join(root, '.claude/skills', SKILL), 'edited');
  assert.throws(() => execFileSync('node', [bin, 'install', root, '--tools', 'claude'], { stdio: 'pipe' }));
  rmSync(root, { recursive: true });
});

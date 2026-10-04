import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, cpSync, symlinkSync,
  readdirSync, lstatSync, chmodSync, statSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  PKG_ROOT, SKILLS_SRC, findInstalls, update, updateInstall, skillNames, shippedFiles, knownHashes, sha,
} from '../src/update.mjs';
import { DOCS, ORDER } from '../skills/dybs-start/scripts/dybs-validate.mjs';
import { rulesBlock } from '../scripts/sync-rules.mjs';

const SKILL = 'SKILL.md';

// Lay out a project the way `npx skills add` does: real files in
// .agents/skills, Claude Code's folder symlinked to them.
function project(skills = skillNames()) {
  const root = mkdtempSync(join(tmpdir(), 'dybs-update-'));
  mkdirSync(join(root, '.agents/skills'), { recursive: true });
  mkdirSync(join(root, '.claude/skills'), { recursive: true });
  for (const s of skills) {
    cpSync(join(SKILLS_SRC, s), join(root, '.agents/skills', s), { recursive: true });
    symlinkSync(`../../.agents/skills/${s}`, join(root, '.claude/skills', s));
  }
  return root;
}
const ops = (r) => Object.fromEntries(r.actions.map((a) => [a.rel, a.op]));
const prd = (root) => join(root, '.agents/skills/dybs-prd', SKILL);

test('finds installs once each, following symlinks', () => {
  const root = project();
  const installs = findInstalls([root]);
  assert.equal(installs.length, skillNames().length);
  assert.ok(installs.every((i) => i.via.length === 2));
  rmSync(root, { recursive: true });
});

test('a current install is up to date', () => {
  const root = project();
  const { results } = update([root]);
  assert.ok(results.every((r) => r.actions.every((a) => a.op === 'same')));
  rmSync(root, { recursive: true });
});

test('an untouched older version is updated', () => {
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const [install] = findInstalls([root]);
  assert.equal(ops(updateInstall(install, { known }))[SKILL], 'update');
  assert.equal(readFileSync(prd(root), 'utf8'), shippedFiles('dybs-prd')[SKILL].toString());
  rmSync(root, { recursive: true });
});

test('a file the user changed is never overwritten without --force', () => {
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'my own version');
  const { results } = update([root]);
  assert.equal(ops(results[0])[SKILL], 'conflict');
  assert.equal(readFileSync(prd(root), 'utf8'), 'my own version');
  rmSync(root, { recursive: true });
});

test('--force replaces a changed file and keeps a backup', () => {
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'my own version');
  const { results } = update([root], { force: true });
  assert.equal(ops(results[0])[SKILL], 'replace');
  assert.equal(readFileSync(`${prd(root)}.bak`, 'utf8'), 'my own version');
  rmSync(root, { recursive: true });
});

test('only installed skills are touched; others are reported', () => {
  const root = project(['dybs-prd']);
  const { results, notInstalled } = update([root]);
  assert.deepEqual(results.map((r) => r.skill), ['dybs-prd']);
  assert.ok(notInstalled.includes('dybs-start'));
  assert.equal(existsSync(join(root, '.agents/skills/dybs-start')), false);
  rmSync(root, { recursive: true });
});

test('a missing shipped file inside an installed skill is added', () => {
  const root = project(['dybs-prd']);
  rmSync(join(root, '.agents/skills/dybs-prd/template.md'));
  const { results } = update([root]);
  assert.equal(ops(results[0])['template.md'], 'add');
  assert.ok(existsSync(join(root, '.agents/skills/dybs-prd/template.md')));
  rmSync(root, { recursive: true });
});

test('a file no longer shipped is removed only if untouched', () => {
  const root = project(['dybs-prd']);
  const dir = join(root, '.agents/skills/dybs-prd');
  writeFileSync(join(dir, 'retired.md'), 'as shipped');
  writeFileSync(join(dir, 'notes.md'), 'edited by user');
  const known = { ...knownHashes(), 'dybs-prd/retired.md': [sha('as shipped')], 'dybs-prd/notes.md': [sha('as shipped')] };
  const r = ops(updateInstall(findInstalls([root])[0], { known }));
  assert.equal(r['retired.md'], 'remove');
  assert.equal(r['notes.md'], 'keep');
  assert.equal(existsSync(join(dir, 'retired.md')), false);
  assert.equal(readFileSync(join(dir, 'notes.md'), 'utf8'), 'edited by user');
  rmSync(root, { recursive: true });
});

test('other skills in the same folder are never touched', () => {
  const root = project(['dybs-prd']);
  mkdirSync(join(root, '.claude/skills/bmad-help'));
  writeFileSync(join(root, '.claude/skills/bmad-help/SKILL.md'), 'bmad');
  update([root], { force: true });
  assert.equal(readFileSync(join(root, '.claude/skills/bmad-help/SKILL.md'), 'utf8'), 'bmad');
  rmSync(root, { recursive: true });
});

test('dry run writes nothing', () => {
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'my own version');
  update([root], { force: true, dryRun: true });
  assert.equal(readFileSync(prd(root), 'utf8'), 'my own version');
  assert.equal(existsSync(`${prd(root)}.bak`), false);
  rmSync(root, { recursive: true });
});

test('every shipped file is fingerprinted in known-hashes (run scripts/record-hashes.mjs)', () => {
  const known = knownHashes();
  for (const s of skillNames()) {
    for (const [rel, buf] of Object.entries(shippedFiles(s))) {
      assert.ok((known[`${s}/${rel}`] || []).includes(sha(buf)), `${s}/${rel} not recorded`);
    }
  }
});

test('every skill except dybs-start carries the same standalone section', () => {
  const block = (s) => {
    const t = readFileSync(join(SKILLS_SRC, s, SKILL), 'utf8');
    const i = t.indexOf('## If something is not installed');
    assert.ok(i >= 0, `${s} lacks the standalone section`);
    return t.slice(i);
  };
  const others = skillNames().filter((s) => s !== 'dybs-start');
  for (const s of others) assert.equal(block(s), block(others[0]), s);
});

test('dybs-check doc contract table matches the validator', () => {
  const t = readFileSync(join(SKILLS_SRC, 'dybs-check', SKILL), 'utf8');
  for (const n of ORDER) {
    const row = t.split('\n').find((l) => l.startsWith(`| \`${n}\` |`));
    assert.ok(row, `no row for ${n}`);
    assert.ok(row.includes(DOCS[n].sections.join(', ')), `${n} sections`);
    assert.ok(row.includes(`| ${DOCS[n].maxWords} |`), `${n} cap`);
  }
});

test('CLI: status, update, validate', () => {
  const root = project(['dybs-prd', 'dybs-start']);
  const cli = (...a) => execFileSync('node', [join(PKG_ROOT, 'bin/dybs-skills.mjs'), ...a], { encoding: 'utf8', stdio: 'pipe' });
  assert.match(cli('status', root), /dybs-prd .*also via 1 link/);
  assert.match(cli('update', root), /up to date[\s\S]*Not installed/);
  writeFileSync(prd(root), 'edited');
  assert.throws(() => cli('update', root));
  assert.match(cli('validate', join(PKG_ROOT, 'tests/fixtures/sample-project')), /Next: ui/);
  const empty = mkdtempSync(join(tmpdir(), 'dybs-empty-'));
  assert.match(cli('update', empty), /npx skills add Dybs-it\/skills/);
  rmSync(root, { recursive: true });
  rmSync(empty, { recursive: true });
});

// --- review findings on PR #1 ---

const olderTemplate = 'an older shipped template';
const knownWithOlder = () => ({ ...knownHashes(), 'dybs-prd/template.md': [...(knownHashes()['dybs-prd/template.md'] || []), sha(olderTemplate)] });

test('a symlinked file inside a skill is never written through, even with --force', () => {
  const root = project(['dybs-prd']);
  const outside = join(root, 'outside.md');
  writeFileSync(outside, olderTemplate);
  const tpl = join(root, '.agents/skills/dybs-prd/template.md');
  rmSync(tpl);
  symlinkSync('../../../outside.md', tpl);
  for (const force of [false, true]) {
    const r = updateInstall(findInstalls([root])[0], { known: knownWithOlder(), force });
    assert.equal(ops(r)['template.md'], 'unsafe');
    assert.equal(r.blocked, true);
    assert.equal(readFileSync(outside, 'utf8'), olderTemplate);
  }
  rmSync(root, { recursive: true });
});

test('a symlinked directory inside a skill is never written through', () => {
  const root = project(['dybs-start']);
  const elsewhere = join(root, 'elsewhere');
  mkdirSync(elsewhere);
  const scripts = join(root, '.agents/skills/dybs-start/scripts');
  rmSync(scripts, { recursive: true });
  symlinkSync('../../../elsewhere', scripts);
  const r = updateInstall(findInstalls([root])[0], { force: true });
  assert.equal(ops(r)['scripts/dybs-validate.mjs'], 'unsafe');
  assert.equal(existsSync(join(elsewhere, 'dybs-validate.mjs')), false);
  rmSync(root, { recursive: true });
});

test('a dangling symlink is not treated as a missing file', () => {
  const root = project(['dybs-prd']);
  const tpl = join(root, '.agents/skills/dybs-prd/template.md');
  rmSync(tpl);
  symlinkSync('../../../nowhere.md', tpl);
  const r = updateInstall(findInstalls([root])[0], { force: true });
  assert.equal(ops(r)['template.md'], 'unsafe');
  assert.equal(existsSync(join(root, 'nowhere.md')), false);
  rmSync(root, { recursive: true });
});

test('a skill with a conflict is left completely unchanged', () => {
  const root = project(['dybs-prd']);
  const dir = join(root, '.agents/skills/dybs-prd');
  writeFileSync(join(dir, SKILL), 'my own instructions');      // conflict
  writeFileSync(join(dir, 'template.md'), olderTemplate);       // would be an update
  writeFileSync(join(dir, 'retired.md'), 'as shipped');         // would be removed
  const known = { ...knownWithOlder(), 'dybs-prd/retired.md': [sha('as shipped')] };
  const r = updateInstall(findInstalls([root])[0], { known });
  assert.equal(r.blocked, true);
  assert.equal(r.applied, false);
  assert.equal(readFileSync(join(dir, SKILL), 'utf8'), 'my own instructions');
  assert.equal(readFileSync(join(dir, 'template.md'), 'utf8'), olderTemplate);
  assert.equal(readFileSync(join(dir, 'retired.md'), 'utf8'), 'as shipped');
  rmSync(root, { recursive: true });
});

test('a missing file in a conflicted skill is not added either', () => {
  const root = project(['dybs-prd']);
  const dir = join(root, '.agents/skills/dybs-prd');
  writeFileSync(join(dir, SKILL), 'my own instructions');
  rmSync(join(dir, 'template.md'));
  const r = updateInstall(findInstalls([root])[0]);
  assert.equal(r.blocked, true);
  assert.equal(existsSync(join(dir, 'template.md')), false);
  rmSync(root, { recursive: true });
});

test('every skill carries the generated manual rules, word for word', () => {
  for (const s of skillNames().filter((n) => n !== 'dybs-start')) {
    const t = readFileSync(join(SKILLS_SRC, s, SKILL), 'utf8');
    assert.ok(t.includes(rulesBlock()), `${s}: run node scripts/sync-rules.mjs`);
  }
});

test('CLI: update --json gives a plan and exits 1 when a skill is blocked', () => {
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'edited');
  let out;
  try {
    execFileSync('node', [join(PKG_ROOT, 'bin/dybs-skills.mjs'), 'update', root, '--dry-run', '--json'], { encoding: 'utf8', stdio: 'pipe' });
    assert.fail('expected exit 1');
  } catch (err) {
    out = JSON.parse(err.stdout);
  }
  assert.equal(out.schema, 1);
  assert.equal(out.results[0].blocked, true);
  assert.equal(out.results[0].actions.find((a) => a.rel === SKILL).op, 'conflict');
  rmSync(root, { recursive: true });
});

test('--force never writes its backup through a dangling link', () => {
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'my own version');
  symlinkSync('../../../trap.md', `${prd(root)}.bak`);
  const r = update([root], { force: true }).results[0];
  const a = r.actions.find((x) => x.rel === SKILL);
  assert.equal(a.op, 'replace');
  assert.ok(a.backup.endsWith('.bak1'));
  assert.equal(readFileSync(a.backup, 'utf8'), 'my own version');
  assert.equal(existsSync(join(root, 'trap.md')), false);
  rmSync(root, { recursive: true });
});

test('a failure at any step of an update leaves the skill exactly as it was', async () => {
  const { planInstall, applyPlan } = await import('../src/update.mjs');
  const files = Object.keys(shippedFiles('dybs-prd'));
  const snapshot = (dir) => {
    const out = {};
    const walk = (d, pre = '') => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (lstatSync(p).isDirectory()) walk(p, `${pre}${n}/`);
        else out[`${pre}${n}`] = readFileSync(p, 'utf8');
      }
    };
    walk(dir);
    return out;
  };
  // Every shipped file is an older known version, one is missing (add), one
  // was edited (replace with --force), one is no longer shipped (remove).
  const setup = () => {
    const root = project(['dybs-prd']);
    const dir = join(root, '.agents/skills/dybs-prd');
    const known = {};
    for (const rel of files) {
      writeFileSync(join(dir, rel), `old ${rel}`);
      known[`dybs-prd/${rel}`] = [sha(`old ${rel}`)];
    }
    rmSync(join(dir, files[files.length - 1]));
    writeFileSync(join(dir, files[0]), 'my edit');
    writeFileSync(join(dir, 'gone.md'), 'old gone');
    known['dybs-prd/gone.md'] = [sha('old gone')];
    return { root, dir, known };
  };
  let failures = 0;
  for (let failAt = 0; ; failAt++) {
    const { root, dir, known } = setup();
    const before = snapshot(dir);
    const [install] = findInstalls([root]);
    const plan = planInstall(install, { known, force: true });
    try {
      applyPlan(plan, { failAt });
    } catch {
      failures++;
      assert.deepEqual(snapshot(dir), before, `failure at step ${failAt}`);
      rmSync(root, { recursive: true });
      continue;
    }
    // No more steps to fail: the whole update applied.
    assert.equal(readFileSync(join(dir, files[1]), 'utf8'), shippedFiles('dybs-prd')[files[1]].toString());
    assert.ok(!existsSync(join(dir, 'gone.md')));
    assert.ok(Object.keys(snapshot(dir)).every((n) => !n.includes('.dybs-')));
    rmSync(root, { recursive: true });
    break;
  }
  assert.ok(failures >= files.length, `only ${failures} steps were exercised`);
});

test('a linked .claude folder cannot pull an outside install into a project update', () => {
  const shared = project(['dybs-prd']);
  const root = mkdtempSync(join(tmpdir(), 'dybs-update-'));
  symlinkSync(join(shared, '.claude'), join(root, '.claude'));
  writeFileSync(prd(shared), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const { results, skipped } = update([root], { known });
  assert.equal(results.length, 0);
  assert.equal(skipped.length, 1);
  assert.equal(readFileSync(prd(shared), 'utf8'), 'old shipped version');
  // Asking for the outside folder itself still updates it.
  assert.equal(update([shared], { known }).results.length, 1);
  rmSync(root, { recursive: true });
  rmSync(shared, { recursive: true });
});

// --- Codex review on #2, fixed in #1's code ---

test('an edit made after the plan is never lost: the update aborts and restores it', async () => {
  const { planInstall, applyPlan } = await import('../src/update.mjs');
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const [install] = findInstalls([root]);
  const plan = planInstall(install, { known });
  writeFileSync(prd(root), 'edited while the update ran');
  assert.throws(() => applyPlan(plan), /changed since the update was planned/);
  assert.equal(readFileSync(prd(root), 'utf8'), 'edited while the update ran');
  assert.ok(readdirSync(join(root, '.agents/skills/dybs-prd')).every((n) => !n.includes('.dybs-')));
  rmSync(root, { recursive: true });
});

test('a file that appears after the plan is never overwritten', async () => {
  const { planInstall, applyPlan } = await import('../src/update.mjs');
  const root = project(['dybs-prd']);
  const tpl = join(root, '.agents/skills/dybs-prd/template.md');
  rmSync(tpl);
  const [install] = findInstalls([root]);
  const plan = planInstall(install);
  assert.equal(plan.actions.find((a) => a.rel === 'template.md').op, 'add');
  writeFileSync(tpl, 'mine, written meanwhile');
  assert.throws(() => applyPlan(plan), /appeared since the update was planned/);
  assert.equal(readFileSync(tpl, 'utf8'), 'mine, written meanwhile');
  rmSync(root, { recursive: true });
});

test('an updated file keeps its permissions', () => {
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  chmodSync(prd(root), 0o600);
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const [install] = findInstalls([root]);
  updateInstall(install, { known });
  assert.equal(readFileSync(prd(root), 'utf8'), shippedFiles('dybs-prd')[SKILL].toString());
  assert.equal(statSync(prd(root)).mode & 0o777, 0o600);
  rmSync(root, { recursive: true });
});

test('CLI: an unknown option or a second folder is refused, nothing is written', () => {
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const cli = join(PKG_ROOT, 'bin/dybs-skills.mjs');
  const code = (args) => { try { execFileSync('node', [cli, ...args], { stdio: 'pipe', cwd: root }); return 0; } catch (e) { return e.status; } };
  assert.equal(code(['update', '--dry-rnu']), 2);
  assert.equal(code(['update', root, '--dry-rnu']), 2);
  assert.equal(code(['update', root, root]), 2);
  assert.equal(readFileSync(prd(root), 'utf8'), 'old shipped version');
  rmSync(root, { recursive: true });
});

test('an install that lost SKILL.md is found and repaired', () => {
  const root = project(['dybs-prd']);
  rmSync(prd(root));
  const { results } = update([root]);
  assert.equal(results.length, 1);
  assert.equal(ops(results[0])[SKILL], 'add');
  assert.equal(readFileSync(prd(root), 'utf8'), shippedFiles('dybs-prd')[SKILL].toString());
  rmSync(root, { recursive: true });
});

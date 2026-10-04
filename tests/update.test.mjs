import { test } from 'node:test';
import { unprivileged, UNPRIVILEGED_SKIP } from './unprivileged.mjs';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, cpSync, symlinkSync,
  readdirSync, lstatSync, chmodSync, statSync, constants as fsConstants,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  PKG_ROOT, SKILLS_SRC, findInstalls, discover, update, updateInstall, skillNames, shippedFiles, knownHashes, sha,
} from '../src/update.mjs';
import { DOCS, ORDER } from '../skills/dybs-start/scripts/dybs-validate.mjs';
import { rulesBlock, checklistsBlock, checklistOf } from '../scripts/sync-rules.mjs';

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

test('every skill carries an identical interview.md', () => {
  const base = readFileSync(join(SKILLS_SRC, 'dybs-start', 'interview.md'), 'utf8');
  for (const s of skillNames()) {
    assert.equal(readFileSync(join(SKILLS_SRC, s, 'interview.md'), 'utf8'), base, s);
  }
});

test('every doc skill points to interview.md and has core and thorough checklists', () => {
  for (const s of skillNames().filter((n) => !['dybs-start', 'dybs-check'].includes(n))) {
    const t = readFileSync(join(SKILLS_SRC, s, SKILL), 'utf8');
    assert.match(t, /interview\.md/, s);
    assert.match(t, /\*\*core\*\*\n- \[ \]/, `${s} core checklist`);
    assert.match(t, /\*\*thorough\*\*\n- \[ \]/, `${s} thorough checklist`);
  }
});

test('dybs-check doc contract table matches the validator', () => {
  const t = readFileSync(join(SKILLS_SRC, 'dybs-check', SKILL), 'utf8');
  for (const n of ORDER) {
    const row = t.split('\n').find((l) => l.startsWith(`| \`${n}\` |`));
    assert.ok(row, `no row for ${n}`);
    assert.ok(row.includes(DOCS[n].sections.join(', ')), `${n} sections`);
    assert.ok(row.includes(`| ${DOCS[n].maxWords.quick} / ${DOCS[n].maxWords.thorough} |`), `${n} cap`);
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

test('kickoff choices have a home in the project.md template', () => {
  const tpl = readFileSync(join(SKILLS_SRC, 'dybs-start/assets/project.md'), 'utf8');
  const start = readFileSync(join(SKILLS_SRC, 'dybs-start', SKILL), 'utf8');
  for (const field of ['type', 'stage', 'horizon', 'depth', 'quick', 'thorough', 'checkins', 'skip']) {
    assert.match(tpl, new RegExp(`^${field}:`, 'm'), `template lacks ${field}`);
    assert.match(start, new RegExp(`\`${field}:?\``), `dybs-start does not set ${field}`);
  }
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

test('dybs-check ships every readiness checklist, so it works installed alone', () => {
  const root = mkdtempSync(join(tmpdir(), 'dybs-check-alone-'));
  cpSync(join(SKILLS_SRC, 'dybs-check'), join(root, 'dybs-check'), { recursive: true });
  const alone = readFileSync(join(root, 'dybs-check', SKILL), 'utf8');
  assert.ok(alone.includes(checklistsBlock()), 'run node scripts/sync-rules.mjs');
  for (const s of skillNames().filter((n) => !['dybs-start', 'dybs-check'].includes(n))) {
    const items = checklistOf(s).split('\n').filter((l) => l.startsWith('- [ ]'));
    assert.ok(items.length > 0, s);
    for (const item of items) assert.ok(alone.includes(item), `${s}: ${item}`);
  }
  rmSync(root, { recursive: true });
});

test('interview.md defines how depth and check-ins combine', () => {
  const t = readFileSync(join(SKILLS_SRC, 'dybs-start', 'interview.md'), 'utf8');
  for (const setting of ['each-doc', 'end', 'none']) assert.match(t, new RegExp(`\\| \`${setting}\` \\|`));
  assert.match(t, /Thorough needs the human's answers, so it does not combine with `none`/);
  assert.match(t, /## Changing an accepted doc/);
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

test('every doc skill defers its check-in under checkins end or none', () => {
  const t = readFileSync(join(SKILLS_SRC, 'dybs-start', 'interview.md'), 'utf8');
  assert.match(t, /## 5\. Check in/);
  for (const s of ['dybs-prd', 'dybs-scope', 'dybs-domain', 'dybs-architecture', 'dybs-ux', 'dybs-ui']) {
    const check = readFileSync(join(SKILLS_SRC, s, SKILL), 'utf8').split('## Check in')[1].split('\n## ')[0];
    assert.match(check, /With `checkins: end` or `none`, do not ask now/, s);
  }
});

test('every file docs/sources.md names as adapted carries the upstream copyright', () => {
  const adapted = {
    'dybs-domain/SKILL.md': 'Matt Pocock', 'dybs-architecture/SKILL.md': 'Matt Pocock',
    'dybs-prd/SKILL.md': 'BMad Code, LLC', 'dybs-start/assets/team.md': 'BMad Code, LLC',
  };
  const sources = readFileSync(join(PKG_ROOT, 'docs/sources.md'), 'utf8');
  for (const [file, owner] of Object.entries(adapted)) {
    const skill = file.split('/')[0];
    assert.ok(sources.includes(skill) || (file.endsWith('team.md') && sources.includes('team.md')), `${file} not in sources.md`);
    const t = readFileSync(join(SKILLS_SRC, file), 'utf8').replace(/\s+/g, ' ');
    assert.match(t, new RegExp(`Copyright \\(c\\) \\d{4} ${owner}`), file);
  }
});

test('dybs-check carries dybs-ux\'s developer-experience reading word for word', () => {
  const ux = readFileSync(join(SKILLS_SRC, 'dybs-ux', SKILL), 'utf8');
  const dx = ux.slice(ux.indexOf('## API, library or CLI'), ux.indexOf('## Readiness checklist')).split('\n').slice(1).join('\n')
    .replace('this doc covers', '`ux.md` covers');
  assert.ok(readFileSync(join(SKILLS_SRC, 'dybs-check', SKILL), 'utf8').includes(dx), 'copy the section into dybs-check');
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
  assert.throws(() => applyPlan(plan), /since the update was planned/);
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

test('interview.md defines needs-you ids and their resolution; dybs-check skips resolved ones', () => {
  const t = readFileSync(join(SKILLS_SRC, 'dybs-start', 'interview.md'), 'utf8');
  assert.match(t, /needs-you NY3:/);
  assert.match(t, /resolved NY3:/);
  assert.match(t, /With `checkins: none`, ask neither/);
  assert.match(readFileSync(join(SKILLS_SRC, 'dybs-check', SKILL), 'utf8'), /no `resolved` line with the same id/);
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

test('rollback never deletes a file someone changed after the update wrote it', async () => {
  const { planInstall, applyPlan } = await import('../src/update.mjs');
  const root = project(['dybs-prd']);
  const dir = join(root, '.agents/skills/dybs-prd');
  const files = Object.keys(shippedFiles('dybs-prd'));
  const known = {};
  for (const rel of files) { writeFileSync(join(dir, rel), `old ${rel}`); known[`dybs-prd/${rel}`] = [sha(`old ${rel}`)]; }
  const [install] = findInstalls([root]);
  const plan = planInstall(install, { known });
  const first = plan.actions.find((a) => a.op === 'update').rel;
  // Fail on the last step, after the first file was placed and then edited.
  const steps = plan.actions.filter((a) => a.op === 'update').length * 2;
  assert.throws(() => applyPlan(plan, { failAt: steps - 1, beforeFail: () => writeFileSync(join(dir, first), 'edited after placement') }),
    /changed after the update wrote it/);
  assert.equal(readFileSync(join(dir, first), 'utf8'), 'edited after placement');
  rmSync(root, { recursive: true });
});

test('a folder swapped for a link after the plan stops the update before anything is written', async () => {
  const { planInstall, applyPlan } = await import('../src/update.mjs');
  const root = project(['dybs-start']);
  const dir = join(root, '.agents/skills/dybs-start');
  rmSync(join(dir, 'scripts'), { recursive: true });
  const [install] = findInstalls([root]);
  const plan = planInstall(install);
  assert.ok(plan.actions.some((a) => a.rel.startsWith('scripts/') && a.op === 'add'));
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  symlinkSync(outside, join(dir, 'scripts'));
  assert.throws(() => applyPlan(plan), /changed since the update was planned/);
  assert.deepEqual(readdirSync(outside), []);
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('every doc skill stops when project.md skips its doc', () => {
  for (const d of ['prd', 'scope', 'domain', 'architecture', 'ux', 'ui']) {
    const t = readFileSync(join(SKILLS_SRC, `dybs-${d}`, SKILL), 'utf8').replace(/\s+/g, ' ');
    assert.match(t, new RegExp(`lists \`${d}\` under \`skip:\`, say so and stop`), d);
  }
});

test('CLI help shows --accept', () => {
  const out = execFileSync('node', [join(PKG_ROOT, 'bin/dybs-skills.mjs'), '--help'], { encoding: 'utf8' });
  assert.match(out, /--accept <doc>/);
});

test('an untouched install checked out with CRLF line endings is still recognised', () => {
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version\r\nline two\r\n');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version\nline two\n')] };
  const [install] = findInstalls([root]);
  assert.equal(ops(updateInstall(install, { known }))[SKILL], 'update');
  assert.equal(readFileSync(prd(root), 'utf8'), shippedFiles('dybs-prd')[SKILL].toString());
  rmSync(root, { recursive: true });
});

test('without hard links, update and rollback still work', async () => {
  const mod = await import('../src/update.mjs');
  const real = mod.fsOps.link;
  mod.fsOps.link = () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); };
  try {
    const root = project(['dybs-prd']);
    writeFileSync(prd(root), 'old shipped version');
    const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
    const [install] = findInstalls([root]);
    const plan = mod.planInstall(install, { known });
    assert.throws(() => mod.applyPlan(plan, { failAt: 1 }), /injected failure/);
    assert.equal(readFileSync(prd(root), 'utf8'), 'old shipped version');
    const [again] = findInstalls([root]);
    mod.applyPlan(mod.planInstall(again, { known }));
    assert.equal(readFileSync(prd(root), 'utf8'), shippedFiles('dybs-prd')[SKILL].toString());
    rmSync(root, { recursive: true });
  } finally {
    mod.fsOps.link = real;
  }
});

test('a missing folder level that became a link is never followed when creating folders', async () => {
  const { planInstall, applyPlan } = await import('../src/update.mjs');
  const root = project(['dybs-start']);
  const dir = join(root, '.agents/skills/dybs-start');
  rmSync(join(dir, 'scripts'), { recursive: true });
  const [install] = findInstalls([root]);
  const plan = planInstall(install);
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  // the first recheck passes; the link appears between it and the folder creation
  let swapped = false;
  assert.throws(() => applyPlan(plan, { beforeMkdir: () => { if (!swapped) { symlinkSync(outside, join(dir, 'scripts')); swapped = true; } } }), /not a real folder/);
  assert.deepEqual(readdirSync(outside), []);
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('CLI: update --json reports an update that stopped as JSON', async () => {
  const { run } = await import('../bin/dybs-skills.mjs');
  const out = [];
  const log = console.log;
  console.log = (x) => out.push(x);
  let code;
  try {
    code = run(['update', '.', '--json'], { update: () => { throw new Error('scripts/x changed since the update was planned'); } });
  } finally { console.log = log; }
  assert.equal(code, 1);
  assert.match(JSON.parse(out.join('\n')).error, /changed since the update was planned/);
});

test('standalone doc skills stop when project.md is missing, and skipped inputs are not read', () => {
  assert.match(readFileSync(join(SKILLS_SRC, 'dybs-prd', SKILL), 'utf8'), /No `dybs\/` folder, or no `dybs\/project\.md`/);
  assert.match(readFileSync(join(SKILLS_SRC, 'dybs-start', 'interview.md'), 'utf8').replace(/\s+/g, ' '), /listed under `skip:` in `project\.md` is not read/);
});

test('a skill folder that lost every file it ships is still found and repaired', () => {
  const root = project(['dybs-check']);
  const dir = join(root, '.agents/skills/dybs-check');
  for (const rel of Object.keys(shippedFiles('dybs-check'))) rmSync(join(dir, rel));
  const { results } = update([root]);
  assert.equal(results.length, 1);
  assert.equal(readFileSync(join(dir, SKILL), 'utf8'), shippedFiles('dybs-check')[SKILL].toString());
  rmSync(root, { recursive: true });
});

test('a filesystem root contains every path under it', async () => {
  const { within } = await import('../src/update.mjs');
  const { sep } = await import('node:path');
  assert.ok(within(`${sep}home${sep}x`, sep));
  assert.ok(within(`${sep}a${sep}b`, `${sep}a`));
  assert.ok(!within(`${sep}ab`, `${sep}a`));
});

test('without hard links, placement creates the target exclusively and keeps its mode', async () => {
  const mod = await import('../src/update.mjs');
  const real = { ...mod.fsOps };
  const calls = [];
  mod.fsOps.link = () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); };
  mod.fsOps.copyFile = (from, to, flags) => { calls.push(flags); return real.copyFile(from, to, flags); };
  const dir = mkdtempSync(join(tmpdir(), 'dybs-place-'));
  try {
    writeFileSync(join(dir, 'from'), 'new'); chmodSync(join(dir, 'from'), 0o755);
    mod.placeNoClobber(join(dir, 'from'), join(dir, 'to'));
    assert.equal(readFileSync(join(dir, 'to'), 'utf8'), 'new');
    assert.equal(statSync(join(dir, 'to')).mode & 0o777, 0o755);
    // The source stays until the caller has recorded the placement.
    assert.equal(readFileSync(join(dir, 'from'), 'utf8'), 'new');
    rmSync(join(dir, 'from'));
    assert.ok(calls.every((f) => f & fsConstants.COPYFILE_EXCL));
    assert.equal(calls.length, 1);
    // Something that appears at the target is refused, never replaced.
    writeFileSync(join(dir, 'from'), 'newer');
    assert.throws(() => mod.placeNoClobber(join(dir, 'from'), join(dir, 'to')), (e) => e.code === 'EEXIST');
    assert.equal(readFileSync(join(dir, 'to'), 'utf8'), 'new');
  } finally {
    Object.assign(mod.fsOps, real);
    rmSync(dir, { recursive: true });
  }
});

test('a failure removing the staging file after placement is still undone', async () => {
  const mod = await import('../src/update.mjs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  try {
    writeFileSync(prd(root), 'old shipped version');
    const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
    const [install] = findInstalls([root]);
    const plan = mod.planInstall(install, { known });
    mod.fsOps.rm = () => { throw Object.assign(new Error('locked'), { code: 'EBUSY' }); };
    assert.throws(() => mod.applyPlan(plan), /locked/);
    assert.equal(readFileSync(prd(root), 'utf8'), 'old shipped version');
  } finally {
    Object.assign(mod.fsOps, real);
    rmSync(root, { recursive: true });
  }
});

test('a skill folder replaced by a link after the plan stops the update before anything is written', async () => {
  const { planInstall, applyPlan } = await import('../src/update.mjs');
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const [install] = findInstalls([root]);
  const plan = planInstall(install, { known });
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  const dir = join(root, '.agents/skills/dybs-prd');
  cpSync(dir, outside, { recursive: true });
  rmSync(dir, { recursive: true });
  symlinkSync(outside, dir);
  assert.throws(() => applyPlan(plan), /skill folder was moved or replaced/);
  assert.equal(readFileSync(join(outside, SKILL), 'utf8'), 'old shipped version');
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('a nested folder swapped for a link after staging stops the update; nothing outside is touched', async () => {
  const { planInstall, applyPlan } = await import('../src/update.mjs');
  const root = project(['dybs-start']);
  const dir = join(root, '.agents/skills/dybs-start');
  writeFileSync(join(dir, 'scripts/retired.mjs'), 'as shipped');
  const known = { ...knownHashes(), 'dybs-start/scripts/retired.mjs': [sha('as shipped')] };
  const [install] = findInstalls([root]);
  const plan = planInstall(install, { known });
  assert.equal(ops(plan)['scripts/retired.mjs'], 'remove');
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  writeFileSync(join(outside, 'retired.mjs'), 'as shipped');
  let swapped = false;
  const beforePin = () => {
    if (swapped) return;
    swapped = true;
    cpSync(join(dir, 'scripts'), join(root, 'scripts.moved'), { recursive: true });
    rmSync(join(dir, 'scripts'), { recursive: true });
    symlinkSync(outside, join(dir, 'scripts'));
  };
  assert.throws(() => applyPlan(plan, { beforePin }), /changed during the update/);
  assert.equal(readFileSync(join(outside, 'retired.mjs'), 'utf8'), 'as shipped');
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('one folder claimed by two skill names is skipped, never updated as either', () => {
  const root = project(['dybs-scope']);
  symlinkSync('../../.agents/skills/dybs-scope', join(root, '.agents/skills/dybs-prd'));
  const { installs, skipped } = discover([root]);
  assert.ok(!installs.some((i) => i.dir.endsWith('dybs-scope')));
  assert.ok(skipped.some((s) => s.skill === 'dybs-prd'));
  assert.ok(skipped.some((s) => s.skill === 'dybs-scope'));
  rmSync(root, { recursive: true });
});

test('--global from the home folder lists each install once', async () => {
  const { rootsFor } = await import('../src/update.mjs');
  const { homedir } = await import('node:os');
  assert.deepEqual(rootsFor(homedir(), { global: true }), [homedir()]);
  assert.equal(rootsFor('/tmp', { global: true }).length, 2);
});

test('a staging file that is not where it was written stops the update; rollback removes only its own files', async () => {
  const { planInstall, applyPlan } = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const [install] = findInstalls([root]);
  const plan = planInstall(install, { known });
  let tmpPath;
  // Act like a write that went through a swapped folder: our file is not at
  // its name, and someone else's file is.
  const beforeStageCheck = (entry) => {
    tmpPath = entry.tmp;
    // Written beside it first, then renamed over: two files that coexist
    // never share an inode, so this is a different file at the same name.
    writeFileSync(`${entry.tmp}.other`, 'someone else');
    renameSync(`${entry.tmp}.other`, entry.tmp);
  };
  assert.throws(() => applyPlan(plan, { beforeStageCheck }), /changed while the update was writing/);
  assert.equal(readFileSync(tmpPath, 'utf8'), 'someone else');
  assert.equal(readFileSync(prd(root), 'utf8'), 'old shipped version');
  rmSync(root, { recursive: true });
});

// The updater refuses (blocks) a path that changes between file and folder:
// a known old file `foo` in the way of a new `foo/bar`, or the reverse. No
// release has done that. This fails the day one does, so the transition is
// implemented (remove and add in one transaction) before it ships.
test('no release turns a shipped file into a folder or back', () => {
  const known = knownHashes();
  for (const skill of skillNames()) {
    const paths = new Set([
      ...Object.keys(shippedFiles(skill)),
      ...Object.keys(known).filter((k) => k.startsWith(`${skill}/`)).map((k) => k.slice(skill.length + 1)),
    ]);
    for (const p of paths) {
      for (const q of paths) assert.ok(!q.startsWith(`${p}/`), `${skill}: ${p} is a file in one release and a folder (${q}) in another`);
    }
  }
});

test('a moved-aside original that changes before cleanup is kept, never deleted', async () => {
  const { planInstall, applyPlan } = await import('../src/update.mjs');
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const [install] = findInstalls([root]);
  const plan = planInstall(install, { known });
  const result = applyPlan(plan, { beforeCleanup: (s) => writeFileSync(s.old, 'an edit saved late') });
  const a = result.actions.find((x) => x.rel === SKILL);
  assert.ok(a.kept);
  assert.equal(readFileSync(a.kept, 'utf8'), 'an edit saved late');
  assert.equal(readFileSync(prd(root), 'utf8'), shippedFiles('dybs-prd')[SKILL].toString());
  rmSync(root, { recursive: true });
});

test('list refuses options and folders', async () => {
  const { run } = await import('../bin/dybs-skills.mjs');
  const e = console.error; const l = console.log;
  console.error = () => {}; console.log = () => {};
  try {
    assert.equal(run(['list', '--jsoon']), 2);
    assert.equal(run(['list', '.']), 2);
    assert.equal(run(['list']), 0);
  } finally { console.error = e; console.log = l; }
});

test('a write that fails after the staging file exists leaves nothing behind', async () => {
  const mod = await import('../src/update.mjs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-start']);
  const dir = join(root, '.agents/skills/dybs-start');
  rmSync(join(dir, 'scripts'), { recursive: true });
  try {
    const [install] = findInstalls([root]);
    const plan = mod.planInstall(install);
    mod.fsOps.write = () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); };
    assert.throws(() => mod.applyPlan(plan), /disk full/);
    assert.equal(existsSync(join(dir, 'scripts')), false);
    assert.deepEqual(readdirSync(dir).filter((n) => n.includes('.new')), []);
  } finally {
    Object.assign(mod.fsOps, real);
    rmSync(root, { recursive: true });
  }
});

test('status prints the real reason a folder was left alone', async () => {
  const { run } = await import('../bin/dybs-skills.mjs');
  const root = project(['dybs-scope']);
  symlinkSync('../../.agents/skills/dybs-scope', join(root, '.agents/skills/dybs-prd'));
  const out = [];
  const l = console.log; console.log = (m) => out.push(m);
  try { run(['status', root]); } finally { console.log = l; }
  assert.match(out.join('\n'), /resolves to a folder named dybs-scope, not dybs-prd/);
  assert.doesNotMatch(out.join('\n'), /resolves outside the requested folder/);
  rmSync(root, { recursive: true });
});

test('a staged file edited before it is installed stops the update', async () => {
  const { planInstall, applyPlan } = await import('../src/update.mjs');
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const [install] = findInstalls([root]);
  const plan = planInstall(install, { known });
  const beforePin = (s) => { if (s.tmp && existsSync(s.tmp)) writeFileSync(s.tmp, 'tampered'); };
  assert.throws(() => applyPlan(plan, { beforePin }), /staged copy of SKILL\.md changed/);
  assert.equal(readFileSync(prd(root), 'utf8'), 'old shipped version');
  rmSync(root, { recursive: true });
});

test('rollback never deletes an outside file with our bytes reached through a swapped folder', async () => {
  const { planInstall, applyPlan } = await import('../src/update.mjs');
  const root = project(['dybs-start']);
  const dir = join(root, '.agents/skills/dybs-start');
  rmSync(join(dir, 'scripts'), { recursive: true });
  const [install] = findInstalls([root]);
  const plan = planInstall(install);
  const rel = plan.actions.find((a) => a.op === 'add' && a.rel.startsWith('scripts/')).rel;
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  writeFileSync(join(outside, rel.slice('scripts/'.length)), shippedFiles('dybs-start')[rel]);
  const calls = {};
  const beforePin = (s) => {
    if (s.a.rel !== rel) return;
    calls[rel] = (calls[rel] || 0) + 1;
    // After placement: move the real folder away and put a link in its place.
    if (calls[rel] === 2) {
      cpSync(join(dir, 'scripts'), join(root, 'scripts.moved'), { recursive: true });
      rmSync(join(dir, 'scripts'), { recursive: true });
      symlinkSync(outside, join(dir, 'scripts'));
    }
  };
  assert.throws(() => applyPlan(plan, { beforePin }), /changed during the update/);
  assert.equal(readFileSync(join(outside, rel.slice('scripts/'.length))).toString(), shippedFiles('dybs-start')[rel].toString());
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('status --json reports a discovery failure as JSON', async () => {
  const { run } = await import('../bin/dybs-skills.mjs');
  const out = [];
  const l = console.log; console.log = (m) => out.push(m);
  let code;
  try {
    code = run(['status', '--json'], { discover: () => { throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }); } });
  } finally { console.log = l; }
  assert.equal(code, 1);
  assert.match(JSON.parse(out.join('\n')).error, /EACCES/);
});

test('cleanup never deletes through a skill folder swapped for a link', async () => {
  const { planInstall, applyPlan } = await import('../src/update.mjs');
  const { renameSync, readdirSync: ls } = await import('node:fs');
  const root = project(['dybs-prd']);
  const dir = join(root, '.agents/skills/dybs-prd');
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const [install] = findInstalls([root]);
  const plan = planInstall(install, { known });
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  let decoy;
  const beforeCleanup = (s) => {
    decoy = join(outside, s.old.slice(dir.length + 1));
    writeFileSync(decoy, 'old shipped version');
    renameSync(dir, `${dir}.moved`);
    symlinkSync(outside, dir);
  };
  const result = applyPlan(plan, { beforeCleanup });
  assert.equal(readFileSync(decoy, 'utf8'), 'old shipped version');
  assert.ok(result.actions.find((a) => a.rel === SKILL).kept);
  assert.ok(ls(outside).length >= 1);
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('rollback keeps a --force backup that was edited in place', async () => {
  const { planInstall, applyPlan } = await import('../src/update.mjs');
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'my own edit');
  const [install] = findInstalls([root]);
  const plan = planInstall(install, { force: true });
  assert.equal(ops(plan)[SKILL], 'replace');
  let backup;
  const steps = plan.actions.filter((a) => ['update', 'replace', 'remove'].includes(a.op)).length;
  assert.throws(() => applyPlan(plan, {
    failAt: steps,
    beforeFail: () => { backup = plan.actions.find((a) => a.rel === SKILL).backup; writeFileSync(backup, 'edited the backup'); },
  }), /injected failure/);
  assert.equal(readFileSync(backup, 'utf8'), 'edited the backup');
  rmSync(root, { recursive: true });
});

test('a cleanup failure after a finished update is reported, not thrown', async () => {
  const mod = await import('../src/update.mjs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const [install] = findInstalls([root]);
  const plan = mod.planInstall(install, { known });
  let calls = 0;
  // The first removal is the staging file; fail the cleanup of the original.
  mod.fsOps.rm = (p, o) => { if (/\.old(\.[^.]+\.rm)?$/.test(String(p))) { calls++; throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); } return real.rm(p, o); };
  let result;
  try { result = mod.applyPlan(plan); } finally { Object.assign(mod.fsOps, real); }
  assert.equal(calls, 1);
  assert.equal(result.applied, true);
  assert.ok(result.actions.find((a) => a.rel === SKILL).kept);
  assert.equal(readFileSync(prd(root), 'utf8'), shippedFiles('dybs-prd')[SKILL].toString());
  rmSync(root, { recursive: true });
});

test('removing the staging file never follows a folder swapped for a link', async () => {
  const { planInstall, applyPlan } = await import('../src/update.mjs');
  const { renameSync: mv } = await import('node:fs');
  const root = project(['dybs-start']);
  const dir = join(root, '.agents/skills/dybs-start');
  rmSync(join(dir, 'scripts'), { recursive: true });
  const [install] = findInstalls([root]);
  const plan = planInstall(install);
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  let decoy;
  const beforeStageRm = (s) => {
    if (decoy || !s.a.rel.startsWith('scripts/')) return;
    decoy = join(outside, s.tmp.slice(join(dir, 'scripts').length + 1));
    writeFileSync(decoy, 'someone else');
    mv(join(dir, 'scripts'), join(root, 'scripts.moved'));
    symlinkSync(outside, join(dir, 'scripts'));
  };
  assert.throws(() => applyPlan(plan, { beforeStageRm }), /changed during the update/);
  assert.equal(readFileSync(decoy, 'utf8'), 'someone else');
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('an original that cannot be read at cleanup is reported as kept', async () => {
  const mod = await import('../src/update.mjs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const [install] = findInstalls([root]);
  const plan = mod.planInstall(install, { known });
  mod.fsOps.read = (p, o) => { if (/\.old(\.[^.]+\.rm)?$/.test(String(p))) throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); return real.read(p, o); };
  let result;
  try { result = mod.applyPlan(plan); } finally { Object.assign(mod.fsOps, real); }
  assert.equal(result.applied, true);
  const kept = result.actions.find((a) => a.rel === SKILL).kept;
  assert.ok(kept && existsSync(kept));
  rmSync(root, { recursive: true });
});

test('rollback never moves an outside file reached through a swapped folder', async () => {
  const { planInstall, applyPlan } = await import('../src/update.mjs');
  const { renameSync, readdirSync: ls } = await import('node:fs');
  const root = project(['dybs-prd']);
  const dir = join(root, '.agents/skills/dybs-prd');
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const [install] = findInstalls([root]);
  const plan = planInstall(install, { known });
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  const steps = plan.actions.filter((a) => ['update', 'replace', 'remove'].includes(a.op)).length;
  let decoy;
  assert.throws(() => applyPlan(plan, {
    failAt: steps,
    beforeFail: () => {
      const old = ls(dir).find((n) => n.endsWith('.old'));
      decoy = join(outside, old);
      writeFileSync(decoy, 'old shipped version');
      renameSync(dir, `${dir}.moved`);
      symlinkSync(outside, dir);
    },
  }), /original was not put back/);
  assert.equal(readFileSync(decoy, 'utf8'), 'old shipped version');
  assert.deepEqual(ls(outside), [decoy.slice(outside.length + 1)]);
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('a rollback that restores by copy keeps the original file itself', async () => {
  const mod = await import('../src/update.mjs');
  const { readdirSync: ls } = await import('node:fs');
  const real = { ...mod.fsOps };
  mod.fsOps.link = () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); };
  const root = project(['dybs-prd']);
  const dir = join(root, '.agents/skills/dybs-prd');
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const [install] = findInstalls([root]);
  const plan = mod.planInstall(install, { known });
  const steps = plan.actions.filter((a) => ['update', 'replace', 'remove'].includes(a.op)).length;
  try {
    assert.throws(() => mod.applyPlan(plan, { failAt: steps }), /put back as a copy; the file itself is kept at/);
  } finally { Object.assign(mod.fsOps, real); }
  assert.equal(readFileSync(prd(root), 'utf8'), 'old shipped version');
  const old = ls(dir).find((n) => n.endsWith('.old'));
  assert.equal(readFileSync(join(dir, old), 'utf8'), 'old shipped version');
  rmSync(root, { recursive: true });
});

test('a write through the staging name after a link placement is caught', async () => {
  const { planInstall, applyPlan } = await import('../src/update.mjs');
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const [install] = findInstalls([root]);
  const plan = planInstall(install, { known });
  let hit = false;
  const beforeStageRm = (s) => { if (s.a.rel === SKILL) { writeFileSync(s.tmp, 'a watcher wrote this'); hit = true; } };
  assert.throws(() => applyPlan(plan, { beforeStageRm }), /changed while it was being placed/);
  assert.ok(hit);
  // The changed file is someone's now: kept, never deleted.
  assert.equal(readFileSync(prd(root), 'utf8'), 'a watcher wrote this');
  rmSync(root, { recursive: true });
});

test('frontmatter needs a closing line that is exactly ---', async () => {
  const { parseFrontmatter } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  assert.equal(parseFrontmatter('---\ndoc: prd\n---oops\n# T\n\n---\n').data, null);
  assert.equal(parseFrontmatter('---\ndoc: prd\n---\n# T\n').data.doc, 'prd');
  assert.equal(parseFrontmatter('---\ndoc: prd\n---  \n# T\n').data.doc, 'prd');
  assert.equal(parseFrontmatter('---\ndoc: prd\n---').data.doc, 'prd');
});

test('staging refuses a folder that became a link before it was pinned', async () => {
  const { planInstall, applyPlan } = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const root = project(['dybs-start']);
  const scripts = join(root, '.agents/skills/dybs-start/scripts');
  const [install] = findInstalls([root]);
  writeFileSync(join(scripts, 'dybs-validate.mjs'), 'old version');
  const plan = planInstall(install, { force: true });
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  let swapped = false;
  const beforeStage = (a) => {
    if (!swapped && a.rel.startsWith('scripts/')) { renameSync(scripts, `${scripts}.moved`); symlinkSync(outside, scripts); swapped = true; }
  };
  assert.throws(() => applyPlan(plan, { beforeStage }), /not a real folder/);
  assert.ok(swapped);
  assert.deepEqual(readdirSync(outside), []);
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('a skills folder that cannot be entered is a discovery error, not an empty install', async (t) => {
  const root = project(['dybs-prd']);
  chmodSync(root, 0o755);
  chmodSync(join(root, '.agents'), 0o000);
  // Root enters anything, so the CLI runs as an unprivileged user there.
  const cli = join(PKG_ROOT, 'bin/dybs-skills.mjs');
  const cmd = unprivileged([cli, 'status', root, '--json']);
  if (!cmd) return t.skip(UNPRIVILEGED_SKIP);
  let out; let code = 0;
  try { out = execFileSync(cmd[0], cmd[1], { encoding: 'utf8', stdio: 'pipe' }); } catch (e) { out = e.stdout; code = e.status; }
  chmodSync(join(root, '.agents'), 0o755);
  assert.equal(code, 1);
  assert.match(JSON.parse(out).error, /EACCES/);
  rmSync(root, { recursive: true });
});

test('moving an original aside never replaces a file that appeared at the .old name', async () => {
  const { planInstall, applyPlan } = await import('../src/update.mjs');
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const [install] = findInstalls([root]);
  const plan = planInstall(install, { known });
  let foreign;
  const beforePin = (s) => {
    if (!foreign && s.a.rel === SKILL && s.tmp) { foreign = s.tmp.replace(/\.new$/, '.old'); writeFileSync(foreign, 'someone else'); }
  };
  assert.throws(() => applyPlan(plan, { beforePin }), /something appeared at/);
  assert.equal(readFileSync(foreign, 'utf8'), 'someone else');
  assert.equal(readFileSync(prd(root), 'utf8'), 'old shipped version');
  rmSync(root, { recursive: true });
});

test('an update that stops partway names the installs it already committed', async () => {
  const mod = await import('../src/update.mjs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd', 'dybs-check']);
  const known = {};
  for (const s of ['dybs-prd', 'dybs-check']) {
    writeFileSync(join(root, `.agents/skills/${s}/SKILL.md`), `old ${s}`);
    known[`${s}/SKILL.md`] = [sha(`old ${s}`)];
  }
  const order = mod.discover([root]).installs.map((i) => i.skill);
  const [first, second] = order;
  mod.fsOps.link = (from, to) => { if (String(to).includes(`/${second}/`)) throw Object.assign(new Error('EIO: disk gone'), { code: 'EIO' }); return real.link(from, to); };
  let err;
  try { mod.update([root], { known }); } catch (e) { err = e; } finally { Object.assign(mod.fsOps, real); }
  assert.ok(err);
  assert.match(err.message, new RegExp(`already updated before it stopped: ${first}`));
  assert.equal(err.completed.length, 1);
  assert.equal(err.completed[0].skill, first);
  rmSync(root, { recursive: true });
});

test('without hard links, moving aside never replaces anything and never loses an edit', async () => {
  const mod = await import('../src/update.mjs');
  const real = { ...mod.fsOps };
  const setup = () => {
    const root = project(['dybs-prd']);
    writeFileSync(prd(root), 'old shipped version');
    const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
    return { root, plan: mod.planInstall(findInstalls([root])[0], { known }) };
  };
  mod.fsOps.link = () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); };
  try {
    // A file already at the .old name is refused, never replaced.
    let r = setup();
    let foreign;
    const beforePin = (st) => { if (!foreign && st.a.rel === SKILL && st.tmp) { foreign = st.tmp.replace(/\.new$/, '.old'); writeFileSync(foreign, 'someone else'); } };
    assert.throws(() => mod.applyPlan(r.plan, { beforePin }), /something appeared at/);
    assert.equal(readFileSync(foreign, 'utf8'), 'someone else');
    assert.equal(readFileSync(prd(r.root), 'utf8'), 'old shipped version');
    rmSync(r.root, { recursive: true });
    // An edit made after the copy is never lost: the update stops and says where it is.
    r = setup();
    let err;
    try { mod.applyPlan(r.plan, { beforeAside: (st) => { if (st.a.rel === SKILL) writeFileSync(st.p, 'edited after the copy'); } }); } catch (e) { err = e; }
    assert.match(err.message, /your version is kept at (\S+)/);
    const kept = err.message.match(/your version is kept at (\S+?)(;|$)/)[1];
    assert.equal(readFileSync(kept, 'utf8'), 'edited after the copy');
    rmSync(r.root, { recursive: true });
  } finally { Object.assign(mod.fsOps, real); }
});

test('two runs in the same millisecond never share a run name', async () => {
  const mod = await import('../src/update.mjs');
  const { readdirSync: ls } = await import('node:fs');
  const real = { ...mod.fsOps };
  const now = Date.now;
  Date.now = () => 1700000000000;
  mod.fsOps.link = () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); };
  const root = project(['dybs-prd']);
  const dir = join(root, '.agents/skills/dybs-prd');
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  try {
    const plan = mod.planInstall(findInstalls([root])[0], { known });
    const steps = plan.actions.filter((a) => ['update', 'replace', 'remove'].includes(a.op)).length;
    // The first run fails and keeps its original under its own run name.
    assert.throws(() => mod.applyPlan(plan, { failAt: steps }), /kept at/);
    const kept = ls(dir).find((n) => n.endsWith('.old'));
    // The second run, same pid and millisecond, must not collide with it.
    mod.applyPlan(mod.planInstall(findInstalls([root])[0], { known }));
    assert.equal(readFileSync(join(dir, kept), 'utf8'), 'old shipped version');
  } finally { Date.now = now; Object.assign(mod.fsOps, real); }
  rmSync(root, { recursive: true });
});

test('cleanup deletes only the file it verified, never one that appears at the name meanwhile', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  let oldName;
  // While the original is being read for verification, a new file takes its name.
  mod.fsOps.read = (p, o) => {
    const bytes = real.read(p, o);
    const m = String(p).match(/^(.*\.old)(\.[^.]+\.rm)?$/);
    if (m && !oldName) { oldName = m[1]; writeFileSync(`${oldName}.x`, 'someone else'); renameSync(`${oldName}.x`, oldName); }
    return bytes;
  };
  let result;
  try { result = mod.applyPlan(plan); } finally { Object.assign(mod.fsOps, real); }
  assert.equal(result.applied, true);
  assert.ok(oldName);
  assert.equal(readFileSync(oldName, 'utf8'), 'someone else');
  rmSync(root, { recursive: true });
});

test('a skills folder that can be listed but not searched is a discovery error', async (t) => {
  const root = project(['dybs-prd']);
  chmodSync(root, 0o755);
  chmodSync(join(root, '.agents'), 0o755);
  chmodSync(join(root, '.agents/skills'), 0o444);
  const cli = join(PKG_ROOT, 'bin/dybs-skills.mjs');
  const cmd = unprivileged([cli, 'status', root, '--json']);
  if (!cmd) return t.skip(UNPRIVILEGED_SKIP);
  let out; let code = 0;
  try { out = execFileSync(cmd[0], cmd[1], { encoding: 'utf8', stdio: 'pipe' }); } catch (e) { out = e.stdout; code = e.status; }
  chmodSync(join(root, '.agents/skills'), 0o755);
  assert.equal(code, 1);
  assert.match(JSON.parse(out).error, /EACCES/);
  rmSync(root, { recursive: true });
});

test('a --force backup edited before commit stops the update and is kept', async () => {
  const { planInstall, applyPlan } = await import('../src/update.mjs');
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'my own edit');
  const plan = planInstall(findInstalls([root])[0], { force: true });
  let backup;
  assert.throws(() => applyPlan(plan, {
    beforeCommit: () => { backup = plan.actions.find((a) => a.rel === SKILL).backup; writeFileSync(backup, 'edited the backup'); },
  }), /backup .* changed during the update/);
  assert.equal(readFileSync(backup, 'utf8'), 'edited the backup');
  assert.equal(readFileSync(prd(root), 'utf8'), 'my own edit');
  rmSync(root, { recursive: true });
});

test('the post-placement read refuses a skill folder swapped for a link', async () => {
  const { planInstall, applyPlan } = await import('../src/update.mjs');
  const { renameSync, cpSync: cp } = await import('node:fs');
  const root = project(['dybs-prd']);
  const dir = join(root, '.agents/skills/dybs-prd');
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = planInstall(findInstalls([root])[0], { known });
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  let swapped = false;
  const beforePlacedCheck = (s) => {
    if (swapped || s.a.rel !== SKILL) return;
    // An outside copy with the same shipped bytes, behind a link.
    cp(dir, join(outside, 'copy'), { recursive: true });
    renameSync(dir, `${dir}.moved`);
    symlinkSync(join(outside, 'copy'), dir);
    swapped = true;
  };
  assert.throws(() => applyPlan(plan, { beforePlacedCheck }), /changed/);
  assert.ok(swapped);
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('an untouched v0.1 install is recognised and updated, not called an edit', async () => {
  const { planInstall } = await import('../src/update.mjs');
  // The published v0.1 files, byte for byte (tests/fixtures/v0.1).
  const v01 = join(PKG_ROOT, 'tests/fixtures/v0.1');
  const root = project(['dybs-check', 'dybs-start']);
  for (const rel of ['dybs-check/SKILL.md', 'dybs-start/SKILL.md', 'dybs-start/assets/README.md']) {
    writeFileSync(join(root, '.agents/skills', rel), readFileSync(join(v01, rel)));
  }
  for (const install of findInstalls([root])) {
    const plan = planInstall(install);
    assert.equal(plan.blocked, false, install.skill);
    for (const a of plan.actions.filter((x) => ['SKILL.md', 'assets/README.md'].includes(x.rel))) {
      assert.equal(a.op, 'update', `${install.skill}/${a.rel}`);
    }
  }
  rmSync(root, { recursive: true });
});

test('removing "our" file never deletes a replacement that appears after the look', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  let hit = false;
  // An editor saves (write a temp, rename over) right after the updater looked.
  mod.testHooks.afterLook = (p) => {
    if (hit || p !== prd(root)) return;
    hit = true;
    writeFileSync(`${p}.save`, 'an editor saved this');
    renameSync(`${p}.save`, p);
  };
  try { assert.throws(() => mod.applyPlan(plan), /not the file the update wrote/); } finally { mod.testHooks.afterLook = null; }
  assert.ok(hit);
  assert.equal(readFileSync(prd(root), 'utf8'), 'an editor saved this');
  rmSync(root, { recursive: true });
});

test('a project root below an unsearchable folder is a discovery error', (t) => {
  const outer = mkdtempSync(join(tmpdir(), 'dybs-locked-'));
  const root = join(outer, 'proj');
  mkdirSync(root);
  chmodSync(outer, 0o000);
  const cli = join(PKG_ROOT, 'bin/dybs-skills.mjs');
  const cmd = unprivileged([cli, 'status', root, '--json']);
  if (!cmd) return t.skip(UNPRIVILEGED_SKIP);
  let out; let code = 0;
  try { out = execFileSync(cmd[0], cmd[1], { encoding: 'utf8', stdio: 'pipe', cwd: tmpdir() }); } catch (e) { out = e.stdout; code = e.status; }
  chmodSync(outer, 0o755);
  assert.equal(code, 1);
  assert.match(JSON.parse(out).error, /EACCES/);
  rmSync(outer, { recursive: true });
});

test('installs outside the folder are left alone, never reported as "no skills installed"', () => {
  const shared = project(['dybs-prd']);
  const root = mkdtempSync(join(tmpdir(), 'dybs-linked-'));
  mkdirSync(join(root, '.agents'));
  symlinkSync(join(shared, '.agents/skills'), join(root, '.agents/skills'));
  const cli = (...a) => execFileSync('node', [join(PKG_ROOT, 'bin/dybs-skills.mjs'), ...a], { encoding: 'utf8', stdio: 'pipe' });
  for (const cmd of ['status', 'update']) {
    const out = cli(cmd, root);
    assert.doesNotMatch(out, /Install with/, cmd);
    assert.match(out, /left alone/, cmd);
  }
  rmSync(root, { recursive: true });
  rmSync(shared, { recursive: true });
});

test('pruning empty folders never follows an ancestor swapped for a link', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const root = project(['dybs-prd']);
  const dir = join(root, '.agents/skills/dybs-prd');
  mkdirSync(join(dir, 'old/deep'), { recursive: true });
  writeFileSync(join(dir, 'old/deep/retired.md'), 'as shipped');
  const known = { ...knownHashes(), 'dybs-prd/old/deep/retired.md': [sha('as shipped')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  assert.equal(ops(plan)['old/deep/retired.md'], 'remove');
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  mkdirSync(join(outside, 'deep'));
  let swapped = false;
  mod.testHooks.beforeRmdir = (d) => {
    if (swapped || d !== join(dir, 'old/deep')) return;
    swapped = true;
    renameSync(join(dir, 'old'), join(dir, 'old.moved'));
    symlinkSync(outside, join(dir, 'old'));
  };
  try { mod.applyPlan(plan); } finally { mod.testHooks.beforeRmdir = null; }
  assert.ok(swapped);
  assert.ok(existsSync(join(outside, 'deep')), 'the outside folder must survive');
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('rollback never deletes a file that replaced the placed one after the check', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  let hit = false;
  mod.testHooks.beforeUndoRm = (s) => {
    if (hit || s.a.rel !== SKILL) return;
    hit = true;
    renameSync(s.p, `${s.p}.away`);
    writeFileSync(s.p, 'a new user file');
  };
  // Everything is placed; then the update fails and rolls back.
  const beforeCommit = () => { throw new Error('injected failure'); };
  try { assert.throws(() => mod.applyPlan(plan, { beforeCommit }), /injected failure/); } finally { mod.testHooks.beforeUndoRm = null; }
  assert.ok(hit);
  assert.equal(readFileSync(prd(root), 'utf8'), 'a new user file');
  rmSync(root, { recursive: true });
});

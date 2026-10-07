import { test } from 'node:test';
import { unprivileged, UNPRIVILEGED_SKIP } from './unprivileged.mjs';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, cpSync, symlinkSync,
  readdirSync, lstatSync, chmodSync, statSync, constants as fsConstants,
} from 'node:fs';
import { join, dirname, sep, basename } from 'node:path';
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
  // An edited file no longer shipped needs the user: nothing in the skill
  // changes until --force, which keeps it and updates the rest.
  const blocked = updateInstall(findInstalls([root])[0], { known });
  assert.equal(ops(blocked)['notes.md'], 'conflict');
  assert.equal(blocked.applied, false);
  assert.equal(existsSync(join(dir, 'retired.md')), true, 'nothing changed while blocked');
  const r = ops(updateInstall(findInstalls([root])[0], { known, force: true }));
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

test('every skill recovers a lost log instead of starting an empty one', () => {
  // A doc skill installed alone has only its own interview.md to go by.
  const t = readFileSync(join(SKILLS_SRC, 'dybs-prd', 'interview.md'), 'utf8');
  assert.doesNotMatch(t, /Create it if missing/);
  assert.match(t, /Create it fresh only when `dybs\/project.md` does not exist yet/);
  assert.match(t, /\*\(recovered\)\*/);
  assert.match(t, /Never re-ask or draft on without it/);
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
  mod.fsOps.link = () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); };
  const dir = mkdtempSync(join(tmpdir(), 'dybs-place-'));
  try {
    writeFileSync(join(dir, 'from'), 'new'); chmodSync(join(dir, 'from'), 0o755);
    mod.placeNoClobber(join(dir, 'from'), join(dir, 'to'));
    assert.equal(readFileSync(join(dir, 'to'), 'utf8'), 'new');
    assert.equal(statSync(join(dir, 'to')).mode & 0o777, 0o755);
    // The source stays until the caller has recorded the placement.
    assert.equal(readFileSync(join(dir, 'from'), 'utf8'), 'new');
    rmSync(join(dir, 'from'));
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
  mod.fsOps.rm = (p, o) => { if (/\.old(\.[^/]+\.rm)?$/.test(String(p))) { calls++; throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); } return real.rm(p, o); };
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
  // Only at cleanup, where the original is read under its trash name.
  mod.fsOps.open = (p) => { if (/\.old\.[^.]+\.rm$/.test(String(p))) throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); return real.open(p); };
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
  // The original is followed by its inode: an editor holding it open writes
  // there, so that very file must survive the rollback.
  const { statSync: st } = await import('node:fs');
  const ino = st(prd(root)).ino;
  let err = null;
  try { mod.applyPlan(plan, { failAt: steps }); } catch (e) { err = e; } finally { Object.assign(mod.fsOps, real); }
  assert.match(err?.message ?? '', /put back as a copy; the file itself is kept at (\S+)$/);
  const keptAt = err.message.match(/kept at (\S+)$/)[1];
  assert.equal(st(keptAt).ino, ino, 'the file named in the error is the original itself');
  assert.equal(readFileSync(keptAt, 'utf8'), 'old shipped version');
  assert.equal(readFileSync(prd(root), 'utf8'), 'old shipped version');
  assert.ok(!ls(dir).some((n) => n.endsWith('.old')), 'the snapshot copy is not left behind');
  rmSync(root, { recursive: true });
});

test('a write through the staging name after placement never reaches the installed file', async () => {
  const { planInstall, applyPlan } = await import('../src/update.mjs');
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const [install] = findInstalls([root]);
  const plan = planInstall(install, { known });
  let hit = false;
  const beforeStageRm = (s) => { if (s.a.rel === SKILL) { writeFileSync(s.tmp, 'a watcher wrote this'); hit = true; } };
  applyPlan(plan, { beforeStageRm });
  assert.ok(hit);
  // The placement is a copy, a file of its own: the staging name never
  // leads to it.
  assert.equal(readFileSync(prd(root), 'utf8'), String(plan.want[SKILL]));
  rmSync(root, { recursive: true });
});

test('frontmatter needs a closing line that is exactly ---', async () => {
  const { parseFrontmatter } = await import('../skills/dybs-start/scripts/dybs-validate.mjs');
  assert.equal(parseFrontmatter('---\ndoc: prd\n---oops\n# T\n\n---\n').data, null);
  assert.equal(parseFrontmatter('---\ndoc: prd\n---\n# T\n').data.doc, 'prd');
  assert.equal(parseFrontmatter('---\ndoc: prd\n---  \n# T\n').data.doc, 'prd');
  assert.equal(parseFrontmatter('---\ndoc: prd\n---').data.doc, 'prd');
  // One rule for both delimiters: invisible trailing blanks are allowed on
  // the opener too, anything visible is not.
  assert.equal(parseFrontmatter('---  \ndoc: prd\n---\t\n# T\n').data.doc, 'prd');
  assert.equal(parseFrontmatter('--- x\ndoc: prd\n---\n# T\n').data, null);
  assert.equal(parseFrontmatter('---\ndoc: prd\n--- x\n# T\n').data, null);
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
    // Back at its own name when that is still free, else kept where the
    // error says: either way the edit is where the user can find it.
    const kept = /back at its own name/.test(err.message) ? prd(r.root) : err.message.match(/your version is kept at (\S+?)(;|$)/)?.[1];
    assert.ok(kept, err.message);
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
    let err = null;
    try { mod.applyPlan(plan, { failAt: steps }); } catch (e) { err = e; }
    assert.match(err?.message ?? '', /kept at (\S+)$/);
    const kept = err.message.match(/kept at (\S+)$/)[1];
    // The second run, same pid and millisecond, must not collide with it.
    mod.applyPlan(mod.planInstall(findInstalls([root])[0], { known }));
    assert.equal(readFileSync(kept, 'utf8'), 'old shipped version');
    assert.ok(ls(dir).length > 0);
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
  // While the original is being read for verification at cleanup (under its
  // trash name), a new file takes its moved-aside name.
  mod.fsOps.open = (p) => {
    const fd = real.open(p);
    const m = String(p).match(/^(.*\.old)(\.[^.]+\.rm)$/);
    if (m && !oldName) { oldName = m[1]; writeFileSync(`${oldName}.x`, 'someone else'); renameSync(`${oldName}.x`, oldName); }
    return fd;
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
  mod.testHooks.beforeMove = (p) => {
    if (hit || p !== prd(root)) return;
    hit = true;
    writeFileSync(`${p}.save`, 'an editor saved this');
    renameSync(`${p}.save`, p);
  };
  try { assert.throws(() => mod.applyPlan(plan), /not the file the update wrote/); } finally { mod.testHooks.beforeMove = null; }
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

test('dropping the original name re-checks the pinned folders right before the move', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync, linkSync } = await import('node:fs');
  const root = project(['dybs-prd']);
  const dir = join(root, '.agents/skills/dybs-prd');
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  let swapped = false;
  // The skill folder becomes a link to an outside folder holding another
  // name for the very same file, after the look and before the move.
  mod.testHooks.afterLook = (p) => {
    if (swapped || p !== prd(root)) return;
    swapped = true;
    linkSync(p, join(outside, SKILL));
    renameSync(dir, `${dir}.moved`);
    symlinkSync(outside, dir);
  };
  try { assert.throws(() => mod.applyPlan(plan), /changed/); } finally { mod.testHooks.afterLook = null; }
  assert.ok(swapped);
  assert.ok(existsSync(join(outside, SKILL)), 'the outside name must survive');
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('without hard links, the fallback move re-checks the pinned folders first', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  const dir = join(root, '.agents/skills/dybs-prd');
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  writeFileSync(join(outside, SKILL), 'someone else');
  let swapped = false;
  mod.fsOps.link = () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); };
  try {
    // After the exclusive copy, the skill folder becomes a link to an
    // outside folder with its own SKILL.md.
    const beforeAside = (st) => {
      if (swapped || st.a.rel !== SKILL) return;
      swapped = true;
      renameSync(dir, `${dir}.moved`);
      symlinkSync(outside, dir);
    };
    assert.throws(() => mod.applyPlan(plan, { beforeAside }), /changed/);
  } finally { Object.assign(mod.fsOps, real); }
  assert.ok(swapped);
  assert.equal(readFileSync(join(outside, SKILL), 'utf8'), 'someone else', 'the outside file keeps its name');
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('a file swapped for a link before it is moved aside is refused, never replaced', async () => {
  const mod = await import('../src/update.mjs');
  const real = { ...mod.fsOps };
  for (const noLinks of [false, true]) {
    const root = project(['dybs-prd']);
    writeFileSync(prd(root), 'old shipped version');
    const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
    const plan = mod.planInstall(findInstalls([root])[0], { known });
    // The user points SKILL.md at a file of their own that happens to hold
    // the planned old bytes; reads through the link would match.
    const theirs = join(root, 'their-skill.md');
    writeFileSync(theirs, 'old shipped version');
    let swapped = false;
    const beforePin = (st) => {
      if (swapped || st.a.rel !== SKILL || !st.tmp) return;
      swapped = true;
      rmSync(st.p);
      symlinkSync(theirs, st.p);
    };
    if (noLinks) mod.fsOps.link = () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); };
    try {
      assert.throws(() => mod.applyPlan(plan, { beforePin }), /no longer a regular file/);
    } finally { Object.assign(mod.fsOps, real); }
    assert.ok(swapped);
    assert.ok(lstatSync(prd(root)).isSymbolicLink(), `the user's link stays (noLinks=${noLinks})`);
    assert.equal(readFileSync(theirs, 'utf8'), 'old shipped version');
    rmSync(root, { recursive: true });
  }
});

test('without hard links, a placement copy that fails halfway leaves nothing behind', async () => {
  const mod = await import('../src/update.mjs');
  const real = { ...mod.fsOps };
  mod.fsOps.link = () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); };
  // The target is created, then the write fails (disk full).
  mod.fsOps.write = () => { throw Object.assign(new Error('no space left'), { code: 'ENOSPC' }); };
  const dir = mkdtempSync(join(tmpdir(), 'dybs-place-'));
  try {
    writeFileSync(join(dir, 'from'), 'new');
    assert.throws(() => mod.placeNoClobber(join(dir, 'from'), join(dir, 'to')), (e) => e.code === 'ENOSPC');
    assert.ok(!existsSync(join(dir, 'to')), 'the partial copy is removed');
  } finally { Object.assign(mod.fsOps, real); rmSync(dir, { recursive: true }); }
});

test('a folder is never made through a parent swapped for a link after its look', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const root = project(['dybs-start']);
  const dir = join(root, '.agents/skills/dybs-start');
  rmSync(join(dir, 'scripts'), { recursive: true });
  const plan = mod.planInstall(findInstalls([root])[0]);
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  let swapped = false;
  // `scripts` was seen missing; then the skill folder itself becomes a link.
  mod.testHooks.afterLook = (p) => {
    if (swapped || p !== join(dir, 'scripts')) return;
    swapped = true;
    renameSync(dir, `${dir}.moved`);
    symlinkSync(outside, dir);
  };
  // Refused before mkdir, not cleaned up after it: a folder made outside
  // could gain content before any rollback reached it.
  let err;
  try { mod.applyPlan(plan); } catch (e) { err = e; } finally { mod.testHooks.afterLook = null; }
  assert.ok(swapped);
  assert.match(err?.message ?? '', /a folder on the way to scripts changed/);
  assert.deepEqual(readdirSync(outside), [], 'nothing is created outside');
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('without hard links, the verified original is deleted by identity, never a replacement', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  let replaced = null;
  // After the moved-aside original is verified, a watcher replaces it.
  mod.testHooks.afterLook = (p) => {
    if (replaced || !/SKILL\.md\.[0-9a-f-]{36}\.rm$/.test(p)) return;
    replaced = p;
    writeFileSync(`${p}.x`, 'someone else');
    renameSync(`${p}.x`, p);
  };
  mod.fsOps.link = () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); };
  let err;
  try { mod.applyPlan(plan); } catch (e) { err = e; } finally { Object.assign(mod.fsOps, real); mod.testHooks.afterLook = null; }
  assert.ok(replaced, 'the hook ran on the moved-aside name');
  // Never deleted: back at its name, or (with no hard links to put it back)
  // kept where the error says.
  const kept = existsSync(replaced) ? replaced : err?.message.match(/kept at (\S+?)(;|$)/)?.[1];
  assert.ok(kept, err?.message);
  assert.equal(readFileSync(kept, 'utf8'), 'someone else');
  rmSync(root, { recursive: true });
});

test('a skill left alone is never also reported as not installed', () => {
  const root = project(['dybs-scope']);
  // dybs-prd is present, but resolves to another skill's folder: left alone.
  symlinkSync('../../.agents/skills/dybs-scope', join(root, '.agents/skills/dybs-prd'));
  const { skipped, notInstalled } = update([root]);
  assert.ok(skipped.some((s) => s.skill === 'dybs-prd'));
  assert.ok(!notInstalled.includes('dybs-prd'));
  rmSync(root, { recursive: true });
});

test('a file the plan found current is checked again before the update commits', async () => {
  const mod = await import('../src/update.mjs');
  for (const change of ['edit', 'remove']) {
    const root = project(['dybs-prd']);
    const template = join(root, '.agents/skills/dybs-prd/template.md');
    writeFileSync(prd(root), 'old shipped version');
    const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
    const plan = mod.planInstall(findInstalls([root])[0], { known });
    assert.ok(plan.actions.some((a) => a.rel === 'template.md' && a.op === 'same'));
    const beforeCommit = () => { if (change === 'edit') writeFileSync(template, 'my edit'); else rmSync(template); };
    assert.throws(() => mod.applyPlan(plan, { beforeCommit }), /template\.md/);
    // Nothing is committed: SKILL.md is back to what it was.
    assert.equal(readFileSync(prd(root), 'utf8'), 'old shipped version', change);
    if (change === 'edit') assert.equal(readFileSync(template, 'utf8'), 'my edit');
    rmSync(root, { recursive: true });
  }
});

test('the staging name is removed by identity, never a file that replaced it', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  let replaced = null;
  mod.testHooks.beforeMove = (p) => {
    if (replaced || !p.endsWith('.new')) return;
    replaced = p;
    writeFileSync(`${p}.x`, 'someone else');
    renameSync(`${p}.x`, p);
  };
  let err;
  try { mod.applyPlan(plan); } catch (e) { err = e; } finally { mod.testHooks.beforeMove = null; }
  assert.ok(replaced, 'the hook ran on the staging name');
  const kept = existsSync(replaced) ? replaced : err?.message.match(/kept at (\S+?)(;|$)/)?.[1];
  assert.ok(kept, err?.message);
  assert.equal(readFileSync(kept, 'utf8'), 'someone else');
  rmSync(root, { recursive: true });
});

test('rollback re-checks the folders right before removing the placed file', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync, linkSync } = await import('node:fs');
  const root = project(['dybs-prd']);
  const dir = join(root, '.agents/skills/dybs-prd');
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  let hit = false;
  // After rollback's own check, the skill folder becomes a link to an
  // outside folder holding another name for the very placed file.
  mod.testHooks.beforeUndoRm = (s) => {
    if (hit || s.a.rel !== SKILL) return;
    hit = true;
    linkSync(s.p, join(outside, SKILL));
    renameSync(dir, `${dir}.moved`);
    symlinkSync(outside, dir);
  };
  const beforeCommit = () => { throw new Error('injected failure'); };
  try { assert.throws(() => mod.applyPlan(plan, { beforeCommit }), /injected failure/); } finally { mod.testHooks.beforeUndoRm = null; }
  assert.ok(hit);
  assert.ok(existsSync(join(outside, SKILL)), 'the outside name must survive');
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('a removal that fails after the private move says where the file is', async () => {
  const mod = await import('../src/update.mjs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  mod.fsOps.rm = () => { throw Object.assign(new Error('locked'), { code: 'EPERM' }); };
  let err;
  try { mod.applyPlan(plan); } catch (e) { err = e; } finally { Object.assign(mod.fsOps, real); }
  assert.ok(err);
  const kept = [...err.message.matchAll(/is kept at (\S+?\.rm)\b/g)].map((m) => m[1]);
  assert.ok(kept.length, err.message);
  for (const k of kept) assert.ok(existsSync(k), `${k} exists`);
  rmSync(root, { recursive: true });
});

test('without hard links, a save that replaced the original after the copy is never moved', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  mod.fsOps.link = () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); };
  // An editor saves atomically (temp file + rename) after the copy.
  const beforeAside = (st) => {
    if (st.a.rel !== SKILL) return;
    writeFileSync(`${st.p}.x`, 'saved by the editor');
    renameSync(`${st.p}.x`, st.p);
  };
  try { assert.throws(() => mod.applyPlan(plan, { beforeAside }), /changed while it was being moved aside/); } finally { Object.assign(mod.fsOps, real); }
  assert.equal(readFileSync(prd(root), 'utf8'), 'saved by the editor');
  rmSync(root, { recursive: true });
});

test('the moved-aside original is checked against the identity it was created with', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  let replaced = null;
  // After the original name is dropped (its private name removed), a
  // watcher replaces the .old entry with its own file holding the same bytes.
  const real = { ...mod.fsOps };
  mod.fsOps.rm = (p, ...rest) => {
    const r = real.rm(p, ...rest);
    if (!replaced && basename(p).startsWith(`${SKILL}.`) && p.endsWith('.rm')) {
      const old = readdirSync(dirname(p)).find((n) => n.endsWith('.old'));
      if (old) {
        replaced = join(dirname(p), old);
        writeFileSync(`${replaced}.x`, 'old shipped version');
        renameSync(`${replaced}.x`, replaced);
      }
    }
    return r;
  };
  try { assert.throws(() => mod.applyPlan(plan), /not where it was moved aside/); } finally { Object.assign(mod.fsOps, real); }
  assert.ok(replaced);
  assert.ok(existsSync(replaced), 'the watcher\'s file is never deleted');
  rmSync(root, { recursive: true });
});

test('rollback never removes a staging file through a folder swapped for a link', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync, linkSync } = await import('node:fs');
  const root = project(['dybs-start']);
  const dir = join(root, '.agents/skills/dybs-start');
  const rel = 'scripts/dybs-validate.mjs';
  writeFileSync(join(dir, rel), 'old shipped version');
  const known = { [`dybs-start/${rel}`]: [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  let kept = null;
  // After staging, scripts/ becomes a link to an outside folder holding
  // another name for the very staged file.
  const beforeStageCheck = (entry) => {
    if (kept || entry.a.rel !== rel) return;
    kept = join(outside, entry.tmp.split('/').at(-1));
    linkSync(entry.tmp, kept);
    renameSync(join(dir, 'scripts'), join(dir, 'scripts.moved'));
    symlinkSync(outside, join(dir, 'scripts'));
  };
  assert.throws(() => mod.applyPlan(plan, { beforeStageCheck }), /changed/);
  assert.ok(kept);
  assert.ok(existsSync(kept), 'the outside name must survive');
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('without hard links, a move-aside copy that fails halfway leaves nothing behind', async () => {
  const mod = await import('../src/update.mjs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  const dir = join(root, '.agents/skills/dybs-prd');
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  mod.fsOps.link = () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); };
  // The copy of the original to its .old name writes part, then fails.
  mod.fsOps.write = (fd, data) => {
    if (String(data) === 'old shipped version') { real.write(fd, 'partial'); throw Object.assign(new Error('no space left'), { code: 'ENOSPC' }); }
    return real.write(fd, data);
  };
  try { assert.throws(() => mod.applyPlan(plan), /no space left/); } finally { Object.assign(mod.fsOps, real); }
  assert.equal(readFileSync(prd(root), 'utf8'), 'old shipped version');
  assert.deepEqual(readdirSync(dir).filter((n) => n.includes('.old')), []);
  rmSync(root, { recursive: true });
});

test('planning never reads through a file swapped for a link after its inspection', async () => {
  const mod = await import('../src/update.mjs');
  const root = project(['dybs-prd']);
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  writeFileSync(join(outside, 'secret'), 'old shipped version');
  let swapped = false;
  mod.testHooks.beforePlanRead = (p) => {
    if (swapped || !p.endsWith(SKILL)) return;
    swapped = true;
    rmSync(p);
    symlinkSync(join(outside, 'secret'), p);
  };
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  let plan;
  try { plan = mod.planInstall(findInstalls([root])[0], { known }); } finally { mod.testHooks.beforePlanRead = null; }
  assert.ok(swapped);
  const a = plan.actions.find((x) => x.rel === SKILL);
  assert.equal(a.op, 'unsafe');
  assert.ok(plan.blocked);
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('a staged file replaced by one with the same bytes is never placed', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  let pins = 0;
  // On the pin right before placement, a watcher swaps the staged file for
  // its own copy of the same shipped bytes.
  const beforePin = (st) => {
    if (st.a.rel !== SKILL || ++pins !== 2) return;
    writeFileSync(`${st.tmp}.x`, readFileSync(st.tmp));
    renameSync(`${st.tmp}.x`, st.tmp);
  };
  assert.throws(() => mod.applyPlan(plan, { beforePin }), /staged copy .* changed/);
  assert.equal(readFileSync(prd(root), 'utf8'), 'old shipped version');
  rmSync(root, { recursive: true });
});

test('a removed file that reappears before commit stops the update', async () => {
  const mod = await import('../src/update.mjs');
  const root = project(['dybs-prd']);
  const dir = join(root, '.agents/skills/dybs-prd');
  writeFileSync(join(dir, 'retired.md'), 'as shipped');
  const known = { ...knownHashes(), 'dybs-prd/retired.md': [sha('as shipped')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  const beforeCommit = () => writeFileSync(join(dir, 'retired.md'), 'written again by a tool');
  assert.throws(() => mod.applyPlan(plan, { beforeCommit }), /appeared again/);
  assert.equal(readFileSync(join(dir, 'retired.md'), 'utf8'), 'written again by a tool');
  rmSync(root, { recursive: true });
});

test('without hard links, the fallback copy checks the folders before it writes anything', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  const dir = join(root, '.agents/skills/dybs-prd');
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  let swapped = false;
  // The copy opens the staging file: the folder is swapped for a link to
  // an outside folder right then.
  mod.fsOps.link = () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); };
  mod.fsOps.open = (from) => {
    if (!swapped && from.endsWith('.new')) {
      swapped = true;
      // The staging name is visible, so the outside folder can offer one.
      writeFileSync(join(outside, from.split('/').at(-1)), 'staged elsewhere');
      renameSync(dir, `${dir}.moved`);
      symlinkSync(outside, dir);
    }
    return real.open(from);
  };
  try { assert.throws(() => mod.applyPlan(plan), /changed/); } finally { Object.assign(mod.fsOps, real); }
  assert.ok(swapped);
  assert.ok(!existsSync(join(outside, SKILL)), 'nothing is written outside');
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('committed cleanup re-checks the folders right before moving the old version', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync, linkSync } = await import('node:fs');
  const root = project(['dybs-prd']);
  const dir = join(root, '.agents/skills/dybs-prd');
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  let kept = null;
  mod.testHooks.beforeTrash = (s) => {
    if (kept || s.a.rel !== SKILL) return;
    kept = join(outside, s.old.split('/').at(-1));
    linkSync(s.old, kept);
    renameSync(dir, `${dir}.moved`);
    symlinkSync(outside, dir);
  };
  try { mod.applyPlan(plan); } finally { mod.testHooks.beforeTrash = null; }
  assert.ok(kept);
  assert.ok(existsSync(kept), 'the outside name must survive');
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('committed cleanup deletes the old version by identity, never a file that replaced it', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  let replaced = null;
  mod.testHooks.afterLook = (p) => {
    if (replaced || !/\.old\.[0-9a-f-]{36}\.rm$/.test(p)) return;
    replaced = p;
    writeFileSync(`${p}.x`, 'someone else');
    renameSync(`${p}.x`, p);
  };
  let r;
  try { r = mod.applyPlan(plan); } finally { mod.testHooks.afterLook = null; }
  assert.ok(replaced, 'the hook ran on the trash name');
  const kept = r.actions.find((a) => a.rel === SKILL).kept;
  const where = existsSync(replaced) ? replaced : kept;
  assert.equal(readFileSync(where, 'utf8'), 'someone else');
  rmSync(root, { recursive: true });
});

test('a staging file swapped in the instant before it is placed is never placed', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  let swapped = null;
  // Right as the placing copy opens it, a watcher has replaced the staging
  // file with its own copy of the shipped bytes.
  mod.fsOps.open = (from) => {
    if (!swapped && from.endsWith('.new')) {
      swapped = from;
      writeFileSync(`${from}.x`, readFileSync(from));
      renameSync(`${from}.x`, from);
    }
    return real.open(from);
  };
  try { assert.throws(() => mod.applyPlan(plan), /changed/); } finally { Object.assign(mod.fsOps, real); }
  assert.ok(swapped);
  // The original is back; the watcher's file was never ours to keep in place.
  assert.equal(readFileSync(prd(root), 'utf8'), 'old shipped version');
  rmSync(root, { recursive: true });
});

test('a folder swapped during the move-aside link leaves no name outside the install', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  const dir = join(root, '.agents/skills/dybs-prd');
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  writeFileSync(join(outside, SKILL), 'theirs');
  let swapped = false;
  mod.fsOps.link = (from, to) => {
    if (!swapped && to.endsWith('.old')) {
      swapped = true;
      renameSync(dir, `${dir}.moved`);
      symlinkSync(outside, dir);
    }
    return real.link(from, to);
  };
  try { assert.throws(() => mod.applyPlan(plan), /changed/); } finally { Object.assign(mod.fsOps, real); }
  assert.ok(swapped);
  assert.deepEqual(readdirSync(outside).filter((n) => n.endsWith('.old')), [], 'no .old name is left outside');
  assert.equal(readFileSync(join(outside, SKILL), 'utf8'), 'theirs');
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('without hard links, a staged file swapped for a link is never copied into place', async () => {
  const mod = await import('../src/update.mjs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  writeFileSync(join(outside, 'secret'), 'outside bytes');
  let swapped = false;
  mod.fsOps.link = () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); };
  mod.fsOps.open = (from) => {
    if (!swapped && from.endsWith('.new')) {
      swapped = true;
      rmSync(from);
      symlinkSync(join(outside, 'secret'), from);
    }
    return real.open(from);
  };
  try { assert.throws(() => mod.applyPlan(plan), /no longer a regular file|changed/); } finally { Object.assign(mod.fsOps, real); }
  assert.ok(swapped);
  assert.notEqual(readFileSync(prd(root), 'utf8'), 'outside bytes');
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('cleanup recovery removes its trash name by identity, never a replacement', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  let replaced = null;
  // The moved-aside original is edited in place before cleanup, so cleanup
  // puts it back; right after that link, a watcher replaces the trash name.
  const beforeCleanup = (s) => { if (s.a.rel === SKILL) writeFileSync(s.old, 'edited in place'); };
  mod.fsOps.link = (from, to) => {
    const r = real.link(from, to);
    if (!replaced && /\.old\.[0-9a-f-]{36}\.rm$/.test(from)) {
      replaced = from;
      writeFileSync(`${from}.x`, 'someone else');
      renameSync(`${from}.x`, from);
    }
    return r;
  };
  try { mod.applyPlan(plan, { beforeCleanup }); } finally { Object.assign(mod.fsOps, real); }
  assert.ok(replaced, 'the recovery link ran');
  assert.equal(readFileSync(replaced, 'utf8'), 'someone else');
  rmSync(root, { recursive: true });
});

test('a folder swapped during the placement leaves no new name outside the install', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  const dir = join(root, '.agents/skills/dybs-prd');
  rmSync(join(dir, 'template.md'));
  const plan = mod.planInstall(findInstalls([root])[0]);
  assert.ok(plan.actions.some((a) => a.rel === 'template.md' && a.op === 'add'));
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  let swapped = null;
  mod.fsOps.open = (from) => {
    if (!swapped && from.endsWith('.new') && from.includes('template.md')) {
      swapped = from.split('/').at(-1);
      // The outside folder offers a file at the visible staging name.
      writeFileSync(join(outside, swapped), 'theirs');
      renameSync(dir, `${dir}.moved`);
      symlinkSync(outside, dir);
    }
    return real.open(from);
  };
  try { assert.throws(() => mod.applyPlan(plan), /changed/); } finally { Object.assign(mod.fsOps, real); }
  assert.ok(swapped);
  assert.ok(!existsSync(join(outside, 'template.md')), 'the placed name is removed again');
  assert.equal(readFileSync(join(outside, swapped), 'utf8'), 'theirs', 'their file is untouched');
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('a file that replaces the placed name right after placement is never removed as ours', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  let replaced = false;
  mod.testHooks.afterPlace = (s) => {
    if (replaced || s.p !== prd(root)) return;
    replaced = true;
    // Another writer renames its own file over the name just created.
    writeFileSync(`${s.p}.x`, 'theirs');
    renameSync(`${s.p}.x`, s.p);
  };
  let err;
  try { mod.applyPlan(plan); } catch (e) { err = e; } finally { Object.assign(mod.fsOps, real); mod.testHooks.afterPlace = null; }
  assert.ok(replaced);
  assert.match(String(err?.message), /changed while it was being installed.*left in place/);
  assert.equal(readFileSync(prd(root), 'utf8'), 'theirs', 'their file is kept');
  rmSync(root, { recursive: true });
});

test('a file that replaces a placed copy before it is checked is never adopted or removed', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync, statSync } = await import('node:fs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  const shipped = String(plan.want[SKILL]);
  let replaced = false;
  mod.fsOps.link = () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); };
  mod.fsOps.write = (fd, data) => {
    // The placing copy: the target was just created empty and gets the
    // shipped bytes. Right after, another writer renames over it.
    const placing = !replaced && String(data) === shipped && existsSync(prd(root)) && statSync(prd(root)).size === 0;
    const r = real.write(fd, data);
    if (placing) {
      replaced = true;
      writeFileSync(`${prd(root)}.x`, 'theirs');
      renameSync(`${prd(root)}.x`, prd(root));
    }
    return r;
  };
  let err;
  try { mod.applyPlan(plan); } catch (e) { err = e; } finally { Object.assign(mod.fsOps, real); }
  assert.ok(replaced);
  assert.match(String(err?.message), /changed while it was being installed.*left in place/);
  assert.equal(readFileSync(prd(root), 'utf8'), 'theirs', 'their file is kept');
  rmSync(root, { recursive: true });
});

test('a folder swapped after placement never costs the other folder its file', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  const dir = join(root, '.agents/skills/dybs-prd');
  rmSync(join(dir, 'template.md'));
  const plan = mod.planInstall(findInstalls([root])[0]);
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  writeFileSync(join(outside, 'template.md'), 'theirs');
  let swapped = false;
  mod.testHooks.afterPlace = (s) => {
    if (swapped || !s.p.endsWith('template.md')) return;
    swapped = true;
    renameSync(dir, `${dir}.moved`);
    symlinkSync(outside, dir);
  };
  let err;
  try { mod.applyPlan(plan); } catch (e) { err = e; } finally { Object.assign(mod.fsOps, real); mod.testHooks.afterPlace = null; }
  assert.ok(swapped);
  assert.match(String(err?.message), /changed while it was being installed.*left in place/);
  assert.equal(readFileSync(join(outside, 'template.md'), 'utf8'), 'theirs', 'their file is kept');
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('a --force backup is never read through a link that replaced the file', async () => {
  const mod = await import('../src/update.mjs');
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'my own version');
  const plan = mod.planInstall(findInstalls([root])[0], { force: true });
  assert.equal(ops(plan)[SKILL], 'replace');
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  writeFileSync(join(outside, 'secret'), 'private bytes');
  let swapped = false;
  const beforeStageCheck = (entry) => {
    if (swapped || entry.a.rel !== SKILL) return;
    swapped = true;
    rmSync(prd(root));
    symlinkSync(join(outside, 'secret'), prd(root));
  };
  const dir = join(root, '.agents/skills/dybs-prd');
  // Looked for while the update runs: a rollback deleting the backup
  // afterwards does not undo having copied those bytes.
  const leaked = [];
  const scan = () => {
    for (const f of readdirSync(dir)) {
      if (lstatSync(join(dir, f)).isFile() && readFileSync(join(dir, f), 'utf8').includes('private bytes')) leaked.push(f);
    }
  };
  mod.testHooks.afterLook = scan;
  try {
    assert.throws(() => mod.applyPlan(plan, { beforeStageCheck, beforeAside: scan, beforeCleanup: scan }), /no longer a regular file/);
  } finally { mod.testHooks.afterLook = null; }
  assert.ok(swapped);
  scan();
  assert.deepEqual(leaked, []);
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

for (const stage of ['read', 'write']) {
  test(`a --force backup never lands outside the install when a folder is swapped before its ${stage}`, async () => {
    const mod = await import('../src/update.mjs');
    const { renameSync } = await import('node:fs');
    const root = project(['dybs-prd']);
    const dir = join(root, '.agents/skills/dybs-prd');
    writeFileSync(prd(root), 'my own version');
    const plan = mod.planInstall(findInstalls([root])[0], { force: true });
    assert.equal(ops(plan)[SKILL], 'replace');
    const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
    writeFileSync(join(outside, SKILL), 'outside content');
    let swapped = false;
    const beforeBackup = (at, entry) => {
      if (swapped || at !== stage || entry.a.rel !== SKILL) return;
      swapped = true;
      renameSync(dir, `${dir}.moved`);
      symlinkSync(outside, dir);
    };
    // Watched while the update runs too: a backup written outside and
    // removed again still copied bytes where they do not belong.
    const seen = new Set();
    mod.testHooks.afterLook = () => { for (const f of readdirSync(outside)) if (f.includes('.bak')) seen.add(f); };
    try {
      assert.throws(() => mod.applyPlan(plan, { beforeBackup }), /changed/);
    } finally { mod.testHooks.afterLook = null; }
    assert.ok(swapped);
    assert.deepEqual(readdirSync(outside).filter((f) => f.endsWith('.bak')), [], 'no backup outside');
    if (stage === 'read') assert.deepEqual([...seen], [], 'nothing was ever written outside');
    assert.equal(readFileSync(join(outside, SKILL), 'utf8'), 'outside content');
    rmSync(root, { recursive: true });
    rmSync(outside, { recursive: true });
  });
}

test('the placed file is read as itself, never through a link that replaced it', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  writeFileSync(join(outside, 'shipped'), plan.want[SKILL]);
  let placed = false;
  let swapped = false;
  mod.testHooks.afterPlace = (s) => { if (s.p === prd(root)) placed = true; };
  // Between the identity check of the placed file and its read, a link to
  // a file holding the shipped bytes (which can change later) takes its name.
  const swap = (p) => {
    if (!placed || swapped || String(p) !== prd(root)) return;
    swapped = true;
    symlinkSync(join(outside, 'shipped'), `${prd(root)}.lnk`);
    renameSync(`${prd(root)}.lnk`, prd(root));
  };
  mod.fsOps.open = (p) => { swap(p); return real.open(p); };
  mod.fsOps.read = (p, o) => { swap(p); return readFileSync(p, o); };
  let err;
  try { mod.applyPlan(plan); } catch (e) { err = e; } finally { Object.assign(mod.fsOps, real); delete mod.fsOps.read; mod.testHooks.afterPlace = null; }
  assert.ok(swapped);
  assert.match(String(err?.message), /changed while it was being placed/);
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('a folder swapped while the rollback puts the original back leaves no name outside the install', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync, linkSync } = await import('node:fs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  const dir = join(root, '.agents/skills/dybs-prd');
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  let rollingBack = false;
  let swapped = false;
  mod.fsOps.link = (from, to) => {
    if (rollingBack && !swapped && from.endsWith('.old') && to === prd(root)) {
      swapped = true;
      // The replacement folder shows the original under its moved-aside name.
      linkSync(from, join(outside, from.split('/').at(-1)));
      renameSync(dir, `${dir}.moved`);
      symlinkSync(outside, dir);
    }
    return real.link(from, to);
  };
  const beforeCommit = () => { rollingBack = true; throw new Error('injected failure'); };
  let err;
  try { mod.applyPlan(plan, { beforeCommit }); } catch (e) { err = e; } finally { Object.assign(mod.fsOps, real); }
  assert.ok(swapped);
  assert.ok(err);
  assert.ok(!existsSync(join(outside, SKILL)), 'no name left outside the install');
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('without hard links, a file that replaced one being removed is put back at its own name', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  mod.fsOps.link = () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); };
  let replaced = null;
  // Right after the first look at the staging name, a user's file takes it.
  mod.testHooks.beforeMove = (p) => {
    if (replaced || !String(p).endsWith('.new')) return;
    replaced = String(p);
    writeFileSync(`${p}.x`, 'theirs');
    renameSync(`${p}.x`, p);
  };
  try { try { mod.applyPlan(plan); } catch { /* reported */ } } finally { mod.testHooks.beforeMove = null; Object.assign(mod.fsOps, real); }
  assert.ok(replaced);
  assert.equal(readFileSync(replaced, 'utf8'), 'theirs', 'their file is back at its own name');
  rmSync(root, { recursive: true });
});

test('pruning never removes an empty folder that replaced the one the update emptied', async () => {
  const mod = await import('../src/update.mjs');
  const root = project(['dybs-prd']);
  const dir = join(root, '.agents/skills/dybs-prd');
  mkdirSync(join(dir, 'old/deep'), { recursive: true });
  writeFileSync(join(dir, 'old/deep/retired.md'), 'as shipped');
  const known = { ...knownHashes(), 'dybs-prd/old/deep/retired.md': [sha('as shipped')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  let swapped = false;
  mod.testHooks.beforeRmdir = (d) => {
    if (swapped || d !== join(dir, 'old/deep')) return;
    swapped = true;
    // Someone removes the emptied folder and makes their own in its place.
    rmSync(d, { recursive: true });
    mkdirSync(d);
  };
  try { mod.applyPlan(plan); } finally { mod.testHooks.beforeRmdir = null; }
  assert.ok(swapped);
  assert.ok(existsSync(join(dir, 'old/deep')), 'their folder survives');
  rmSync(root, { recursive: true });
});

test('a --force backup is checked at rollback without opening what replaced it', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const { spawn } = await import('node:child_process');
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'my own version');
  const plan = mod.planInstall(findInstalls([root])[0], { force: true });
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  const fifo = join(outside, 'fifo');
  execFileSync('mkfifo', [fifo]);
  // A writer that finishes only if someone opens the FIFO for reading.
  const writer = spawn('sh', ['-c', `printf 'my own version' > '${fifo}'`]);
  const beforeCommit = () => {
    const bak = `${prd(root)}.bak`;
    symlinkSync(fifo, `${bak}.lnk`);
    renameSync(`${bak}.lnk`, bak);
    throw new Error('injected failure');
  };
  assert.throws(() => mod.applyPlan(plan, { beforeCommit }), /injected failure/);
  await new Promise((r) => setTimeout(r, 300));
  const opened = writer.exitCode !== null;
  writer.kill();
  assert.equal(opened, false, 'the FIFO behind the link was never opened');
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('a skill folder deleted and recreated since the plan is refused, even with the same inode', async () => {
  const mod = await import('../src/update.mjs');
  const { lstatSync } = await import('node:fs');
  const root = project(['dybs-prd']);
  const dir = join(root, '.agents/skills/dybs-prd');
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  const before = lstatSync(dir).ino;
  rmSync(dir, { recursive: true });
  mkdirSync(dir);
  assert.throws(() => mod.applyPlan(plan), /changed since the update was planned|not a real folder|changed/);
  assert.deepEqual(readdirSync(dir), [], `nothing was written into the new folder (inode reused: ${lstatSync(dir).ino === before})`);
  rmSync(root, { recursive: true });
});

test('a lookup that fails during rollback is reported, never taken for "already removed"', async () => {
  const mod = await import('../src/update.mjs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  let rollingBack = false;
  mod.fsOps.lstat = (p, o) => {
    if (rollingBack && String(p).endsWith('.new')) throw Object.assign(new Error('EIO: i/o error'), { code: 'EIO' });
    return real.lstat(p, o);
  };
  let err;
  try { mod.applyPlan(plan, { beforeCommit: () => { rollingBack = true; throw new Error('injected failure'); } }); } catch (e) { err = e; } finally { Object.assign(mod.fsOps, real); }
  assert.match(String(err?.message), /could not undo everything.*EIO/);
  rmSync(root, { recursive: true });
});

test('a skill folder swapped at the commit point stops the update, even with no unchanged file to recheck', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const root = project(['dybs-prd']);
  const dir = join(root, '.agents/skills/dybs-prd');
  // Every file differs from the release: no `same` action is left.
  const known = {};
  for (const f of readdirSync(dir, { recursive: true })) {
    if (!lstatSync(join(dir, f)).isFile()) continue;
    writeFileSync(join(dir, f), `old ${f}`);
    known[`dybs-prd/${f.split(sep).join('/')}`] = [sha(`old ${f}`)];
  }
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  assert.ok(!plan.actions.some((a) => a.op === 'same'));
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  const beforeCommit = () => { renameSync(dir, `${dir}.moved`); symlinkSync(outside, dir); };
  assert.throws(() => mod.applyPlan(plan, { beforeCommit }), /changed/);
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('cleanup recovery never links the kept original outside the install through a swapped folder', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync, linkSync } = await import('node:fs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  const dir = join(root, '.agents/skills/dybs-prd');
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  let swapped = false;
  const beforeCleanup = (s) => { if (s.a.rel === SKILL) writeFileSync(s.old, 'edited in place'); };
  mod.fsOps.link = (from, to) => {
    if (!swapped && /\.old\.[0-9a-f-]{36}\.rm$/.test(from)) {
      swapped = true;
      // The replacement folder shows the trash file under its own name.
      linkSync(from, join(outside, from.split('/').at(-1)));
      renameSync(dir, `${dir}.moved`);
      symlinkSync(outside, dir);
    }
    return real.link(from, to);
  };
  try { mod.applyPlan(plan, { beforeCleanup }); } finally { Object.assign(mod.fsOps, real); }
  assert.ok(swapped);
  assert.deepEqual(readdirSync(outside).filter((f) => f.endsWith('.old')), [], 'no kept original linked outside');
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('putting back a file that was not the update\'s never lands it outside the install through a swapped folder', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync, linkSync } = await import('node:fs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  const dir = join(root, '.agents/skills/dybs-prd');
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  let replaced = null;
  let swapped = false;
  // A user's file takes the staging name right after the first look...
  // Replaced after the in-folder identity check, right before the rename:
  // earlier, the update refuses before moving anything.
  mod.testHooks.inFolder = (p) => {
    if (replaced || !String(p).endsWith('.new')) return;
    replaced = String(p);
    writeFileSync(`${p}.x`, 'theirs');
    renameSync(`${p}.x`, p);
  };
  // ...and while it is being put back, the folder is swapped for one that
  // shows the same file under the private name.
  mod.fsOps.link = (from, to) => {
    if (replaced && !swapped && String(from).startsWith(`${replaced}.`) && String(from).endsWith('.rm') && to === replaced) {
      swapped = true;
      linkSync(from, join(outside, String(from).split('/').at(-1)));
      renameSync(dir, `${dir}.moved`);
      symlinkSync(outside, dir);
    }
    return real.link(from, to);
  };
  try { try { mod.applyPlan(plan); } catch { /* reported */ } } finally { mod.testHooks.inFolder = null; Object.assign(mod.fsOps, real); }
  assert.ok(swapped);
  assert.deepEqual(readdirSync(outside).filter((f) => f.endsWith('.new')), [], 'nothing put back outside the install');
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('a file that replaces the moved-aside name right after the link is never removed', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  const dir = join(root, '.agents/skills/dybs-prd');
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  writeFileSync(join(outside, SKILL), 'theirs');
  let theirs = null;
  mod.fsOps.link = (from, to) => {
    if (theirs || !to.endsWith('.old')) return real.link(from, to);
    // The folder is swapped during the link, and right after it a watcher
    // renames its own file over the new name.
    renameSync(dir, `${dir}.moved`);
    symlinkSync(outside, dir);
    const r = real.link(from, to);
    theirs = join(outside, to.split('/').at(-1));
    writeFileSync(`${theirs}.x`, 'theirs too');
    renameSync(`${theirs}.x`, theirs);
    return r;
  };
  try { assert.throws(() => mod.applyPlan(plan), /changed/); } finally { Object.assign(mod.fsOps, real); }
  assert.ok(theirs);
  assert.equal(readFileSync(theirs, 'utf8'), 'theirs too', 'their file is kept');
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('update and status refuse a project folder that does not exist', () => {
  const cli = join(PKG_ROOT, 'bin/dybs-skills.mjs');
  for (const cmd of ['update', 'status']) {
    let code = 0;
    try { execFileSync('node', [cli, cmd, '/definitely/not/here', '--json'], { stdio: 'pipe' }); } catch (e) { code = e.status; }
    assert.equal(code, 2, cmd);
  }
});

test('a filesystem that answers link() with EISDIR (Windows exFAT) falls back to copies', async () => {
  const mod = await import('../src/update.mjs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  mod.fsOps.link = () => { throw Object.assign(new Error('EISDIR: illegal operation on a directory, link'), { code: 'EISDIR' }); };
  let r;
  try { r = mod.applyPlan(plan); } finally { Object.assign(mod.fsOps, real); }
  assert.equal(r.applied, true);
  assert.equal(readFileSync(prd(root), 'utf8'), String(plan.want[SKILL]));
  rmSync(root, { recursive: true });
});

test('where open() follows links (no O_NOFOLLOW), a file swapped for a link is still never read as itself', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync, openSync } = await import('node:fs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { ...knownHashes(), 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  const same = plan.actions.find((a) => a.op === 'same');
  assert.ok(same, 'an unchanged file to recheck at the commit point');
  const target = join(root, '.agents/skills/dybs-prd', same.rel);
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  writeFileSync(join(outside, 'copy'), readFileSync(target));
  // Windows: open() has no O_NOFOLLOW. After the commit point's recheck of
  // the unchanged file, and just as it is opened, a link takes its name.
  let committing = false;
  let swapped = false;
  mod.fsOps.open = (p) => {
    if (committing && !swapped && p === target) {
      swapped = true;
      symlinkSync(join(outside, 'copy'), `${target}.lnk`);
      renameSync(`${target}.lnk`, target);
    }
    return openSync(p, 'r');
  };
  try { assert.throws(() => mod.applyPlan(plan, { beforeCommit: () => { committing = true; } }), /changed/); } finally { Object.assign(mod.fsOps, real); }
  assert.ok(swapped);
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('a lookup failure on the moved-aside original at cleanup is reported as kept, never as gone', async () => {
  const mod = await import('../src/update.mjs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  let cleaning = false;
  mod.fsOps.lstat = (p, o) => {
    if (cleaning && /\.old$/.test(String(p))) throw Object.assign(new Error('ESTALE: stale file handle'), { code: 'ESTALE' });
    return real.lstat(p, o);
  };
  let r;
  try { r = mod.applyPlan(plan, { beforeCleanup: () => { cleaning = true; } }); } finally { Object.assign(mod.fsOps, real); }
  assert.equal(r.applied, true);
  const kept = r.actions.find((a) => a.rel === SKILL).kept;
  assert.ok(kept && existsSync(kept), 'the original is reported where it is kept');
  rmSync(root, { recursive: true });
});

test('dybs-check declares the writes its check-in makes on the human\'s word', () => {
  const t = readFileSync(join(SKILLS_SRC, 'dybs-check', 'SKILL.md'), 'utf8');
  const decl = t.match(/^\*\*Reads:\*\*[\s\S]*?(?=\n\n)/m)?.[0].replace(/\s+/g, ' ') ?? '';
  assert.match(decl, /resolved/, 'resolved lines in dybs/log.md');
  assert.match(decl, /acceptance/, 'accepting the docs the human names');
});

test('rollback never links a file that replaced the moved-aside original into place', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  let rollingBack = false;
  let replaced = false;
  mod.fsOps.link = (from, to) => {
    if (rollingBack && !replaced && String(from).endsWith('.old') && to === prd(root)) {
      // After rollback's identity check, a watcher replaces the .old name.
      replaced = true;
      writeFileSync(`${from}.x`, 'watcher');
      renameSync(`${from}.x`, from);
    }
    return real.link(from, to);
  };
  let err;
  try { mod.applyPlan(plan, { beforeCommit: () => { rollingBack = true; throw new Error('injected failure'); } }); } catch (e) { err = e; } finally { Object.assign(mod.fsOps, real); }
  assert.ok(replaced);
  assert.ok(err);
  assert.notEqual(existsSync(prd(root)) ? readFileSync(prd(root), 'utf8') : '', 'watcher', 'the watcher\'s file is not installed');
  rmSync(root, { recursive: true });
});

test('a folder that replaces a file before it is moved aside stays at its name', async () => {
  const mod = await import('../src/update.mjs');
  const { mkdirSync } = await import('node:fs');
  for (const hook of ['afterLook', 'beforeMove']) {
    const root = project(['dybs-prd']);
    writeFileSync(prd(root), 'old shipped version');
    const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
    const plan = mod.planInstall(findInstalls([root])[0], { known });
    let hit = false;
    mod.testHooks[hook] = (p) => {
      if (hit || p !== prd(root)) return;
      hit = true;
      rmSync(p);
      mkdirSync(p);
      writeFileSync(join(p, 'notes.md'), 'the user\'s folder');
    };
    try { assert.throws(() => mod.applyPlan(plan), /not the file the update wrote/); } finally { mod.testHooks[hook] = null; }
    assert.ok(hit, hook);
    assert.equal(readFileSync(join(prd(root), 'notes.md'), 'utf8'), 'the user\'s folder', `${hook}: the folder is at its own name`);
    const dir = dirname(prd(root));
    assert.deepEqual(readdirSync(dir).filter((n) => n.endsWith('.rm')), [], `${hook}: nothing stranded aside`);
    rmSync(root, { recursive: true });
  }
});

test('a file the plan found current is read again only through the pinned folders', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const root = project(['dybs-start']);
  const dir = join(root, '.agents/skills/dybs-start');
  writeFileSync(join(dir, SKILL), 'old shipped version');
  const known = { ...knownHashes(), 'dybs-start/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  const rel = 'scripts/dybs-validate.mjs';
  assert.equal(plan.actions.find((a) => a.rel === rel).op, 'same');
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  const real = { ...mod.fsOps };
  let swapped = false;
  // While the unchanged file is read for the last time, scripts/ becomes a
  // link to a folder outside the install holding the very same file.
  mod.fsOps.open = (p) => {
    if (!swapped && p === join(dir, rel) && plan.actions.some((a) => a.rel === SKILL)) {
      const placed = (() => { try { return readFileSync(join(dir, SKILL), 'utf8') !== 'old shipped version'; } catch { return false; } })();
      if (placed) {
        swapped = true;
        renameSync(join(dir, 'scripts'), join(outside, 'scripts'));
        symlinkSync(join(outside, 'scripts'), join(dir, 'scripts'));
      }
    }
    return real.open(p);
  };
  try { assert.throws(() => mod.applyPlan(plan), /changed/); } finally { Object.assign(mod.fsOps, real); }
  assert.ok(swapped);
  assert.equal(readFileSync(join(dir, SKILL), 'utf8'), 'old shipped version');
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('a staging file written through a swapped folder is removed, not left outside', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const root = project(['dybs-start']);
  const dir = join(root, '.agents/skills/dybs-start');
  const rel = 'scripts/dybs-validate.mjs';
  writeFileSync(join(dir, rel), 'old shipped version');
  const known = { [`dybs-start/${rel}`]: [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  let moved = false;
  // As if scripts/ had been swapped before the open: the staging file now
  // sits in a folder outside the install, under its only name.
  const beforeStageCheck = (entry) => {
    if (moved || entry.a.rel !== rel) return;
    moved = true;
    renameSync(join(dir, 'scripts'), join(outside, 'scripts'));
    symlinkSync(join(outside, 'scripts'), join(dir, 'scripts'));
  };
  assert.throws(() => mod.applyPlan(plan, { beforeStageCheck }), /changed while the update was writing/);
  assert.ok(moved);
  assert.deepEqual(readdirSync(join(outside, 'scripts')).filter((n) => n.endsWith('.new')), [], 'no staging file left outside');
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('a file that replaced ours before the move is never moved, so it keeps its identity without hard links', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  // The update stops after staging; its rollback removes the staging file,
  // which someone replaced right after the rollback's first look at it.
  let theirs = null;
  let stagedAt = null;
  mod.testHooks.afterLook = (p) => {
    if (theirs || p !== stagedAt) return;
    writeFileSync(`${p}.save`, 'theirs');
    renameSync(`${p}.save`, p);
    theirs = lstatSync(p).ino;
  };
  const beforeStageCheck = (entry) => { stagedAt = entry.tmp; throw new Error('stop after staging'); };
  mod.fsOps.link = () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); };
  try { assert.throws(() => mod.applyPlan(plan, { beforeStageCheck }), /stop after staging/); } finally { mod.testHooks.afterLook = null; Object.assign(mod.fsOps, real); }
  assert.ok(theirs);
  assert.equal(readFileSync(stagedAt, 'utf8'), 'theirs');
  assert.equal(lstatSync(stagedAt).ino, theirs, 'the very file, not a copy');
  rmSync(root, { recursive: true });
});

test('folders made before a deeper mkdir fails are removed by the rollback', async () => {
  const mod = await import('../src/update.mjs');
  const root = project(['dybs-prd']);
  const dir = join(root, '.agents/skills/dybs-prd');
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  // A file two missing folders deep; the second mkdir fails (quota, I/O).
  plan.actions.push({ op: 'add', rel: 'deep/er/file.md' });
  plan.want['deep/er/file.md'] = 'new';
  mod.testHooks.afterLook = (p) => {
    if (p === join(dir, 'deep/er')) throw Object.assign(new Error('no space left'), { code: 'ENOSPC' });
  };
  try { assert.throws(() => mod.applyPlan(plan), /no space left/); } finally { mod.testHooks.afterLook = null; }
  assert.equal(existsSync(join(dir, 'deep')), false, 'the folder the update made is gone');
  assert.equal(readFileSync(prd(root), 'utf8'), 'old shipped version');
  rmSync(root, { recursive: true });
});

test('without hard links, an edit written through an open original after its check is never deleted', async () => {
  const mod = await import('../src/update.mjs');
  const { openSync, writeSync, closeSync } = await import('node:fs');
  const real = { ...mod.fsOps };
  for (const outcome of ['commit', 'rollback']) {
    const root = project(['dybs-prd']);
    const dir = dirname(prd(root));
    writeFileSync(prd(root), 'old shipped version');
    const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
    const plan = mod.planInstall(findInstalls([root])[0], { known });
    // An editor holds the original open and saves through that handle late.
    const fd = openSync(prd(root), 'r+');
    const beforeCommit = () => {
      writeSync(fd, 'EDITED', 0);
      if (outcome === 'rollback') throw new Error('stop before commit');
    };
    mod.fsOps.link = () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); };
    let err = null;
    let r = null;
    try { r = mod.applyPlan(plan, { beforeCommit }); } catch (e) { err = e; } finally { Object.assign(mod.fsOps, real); closeSync(fd); }
    const holding = readdirSync(dir).filter((n) => { try { return readFileSync(join(dir, n), 'utf8').startsWith('EDITED'); } catch { return false; } });
    assert.equal(holding.length, 1, `${outcome}: the edit survives (${err?.message ?? 'committed'})`);
    if (outcome === 'commit') assert.equal(err, null);
    else assert.match(err.message, /kept at/);
    rmSync(root, { recursive: true });
  }
});

test('an edit written in place just before a removal is put back, never deleted', async () => {
  const mod = await import('../src/update.mjs');
  const root = project(['dybs-prd']);
  const dir = dirname(prd(root));
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  // The committed cleanup has checked the moved-aside original; an editor
  // still holding it open writes once more before the unlink.
  let hit = false;
  mod.testHooks.afterLook = (p) => {
    if (hit || !/\.old\.[0-9a-f-]{36}\.rm$/.test(p)) return;
    hit = true;
    writeFileSync(p, 'EDITED in place', { flag: 'r+' });
  };
  let r;
  try { r = mod.applyPlan(plan); } finally { mod.testHooks.afterLook = null; }
  assert.ok(hit);
  assert.ok(r);
  const holding = readdirSync(dir).filter((n) => { try { return readFileSync(join(dir, n), 'utf8').startsWith('EDITED'); } catch { return false; } });
  assert.equal(holding.length, 1, 'the edit survives');
  rmSync(root, { recursive: true });
});

test('the private name of a file put back is removed only while it is that file', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  let stagedAt = null;
  let replaced = false;
  // The rollback meets a user's file at the staging name; it is moved aside,
  // linked back, and then a watcher puts another file at the private name.
  // Replaced after the in-folder identity check, right before the rename:
  // earlier, the update refuses before moving anything.
  mod.testHooks.inFolder = (p) => {
    if (p !== stagedAt || replaced) return;
    writeFileSync(`${p}.x`, 'first user file');
    renameSync(`${p}.x`, p);
  };
  mod.fsOps.link = (from, to) => {
    const r = real.link(from, to);
    if (!replaced && to === stagedAt && /\.rm$/.test(from)) {
      replaced = true;
      writeFileSync(`${from}.y`, 'second user file');
      renameSync(`${from}.y`, from);
    }
    return r;
  };
  const beforeStageCheck = (entry) => { stagedAt = entry.tmp; throw new Error('stop after staging'); };
  try { assert.throws(() => mod.applyPlan(plan, { beforeStageCheck }), /stop after staging/); } finally { mod.testHooks.inFolder = null; Object.assign(mod.fsOps, real); }
  assert.ok(replaced);
  const dir = dirname(prd(root));
  const texts = readdirSync(dir).map((n) => { try { return readFileSync(join(dir, n), 'utf8'); } catch { return ''; } });
  assert.ok(texts.includes('first user file'));
  assert.ok(texts.includes('second user file'), 'the file at the private name survives');
  rmSync(root, { recursive: true });
});

test('without hard links, a changed original is put back without replacing a new save', async () => {
  const mod = await import('../src/update.mjs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  // Edited in place right before it is moved aside, then a new save lands at
  // the name in the instant before the put-back.
  const beforeAside = (s) => writeFileSync(s.p, 'edited in place', { flag: 'r+' });
  mod.testHooks.beforePutBack = (p) => writeFileSync(p, 'a new save');
  mod.fsOps.link = () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); };
  let err = null;
  try { mod.applyPlan(plan, { beforeAside }); } catch (e) { err = e; } finally { mod.testHooks.beforePutBack = null; Object.assign(mod.fsOps, real); }
  assert.match(err?.message ?? '', /changed while it was being moved aside/);
  assert.equal(readFileSync(prd(root), 'utf8'), 'a new save');
  const dir = dirname(prd(root));
  assert.ok(readdirSync(dir).some((n) => { try { return readFileSync(join(dir, n), 'utf8').startsWith('edited in place'); } catch { return false; } }), 'the edited original is kept');
  rmSync(root, { recursive: true });
});

test('a put-back that landed outside through a folder swapped and restored keeps the private name', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync, linkSync } = await import('node:fs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  const dir = dirname(prd(root));
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  let stagedAt = null;
  let swapped = false;
  // Replaced after the in-folder identity check, right before the rename:
  // earlier, the update refuses before moving anything.
  mod.testHooks.inFolder = (p) => {
    if (p !== stagedAt || swapped) return;
    writeFileSync(`${p}.x`, 'a user file');
    renameSync(`${p}.x`, p);
  };
  // The put-back link goes through the skill folder swapped for a link, and
  // the folder is back before the link call returns.
  mod.fsOps.link = (from, to) => {
    if (swapped || to !== stagedAt || !/\.rm$/.test(from)) return real.link(from, to);
    swapped = true;
    linkSync(from, join(outside, basename(from)));
    renameSync(dir, `${dir}.moved`);
    symlinkSync(outside, dir);
    try { return real.link(from, to); } finally { rmSync(dir); renameSync(`${dir}.moved`, dir); }
  };
  const beforeStageCheck = (entry) => { stagedAt = entry.tmp; throw new Error('stop after staging'); };
  try { assert.throws(() => mod.applyPlan(plan, { beforeStageCheck }), /stop after staging/); } finally { mod.testHooks.inFolder = null; Object.assign(mod.fsOps, real); }
  assert.ok(swapped);
  assert.ok(readdirSync(dir).some((n) => { try { return readFileSync(join(dir, n), 'utf8') === 'a user file'; } catch { return false; } }), 'the user file is still inside the install');
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('a staging file that went outside through a folder swapped and restored is named in the error', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  // As if the folder had been a link at the open and was restored since:
  // the folders are the pinned ones again, the file is out of reach by name.
  const beforeStageCheck = (entry) => renameSync(entry.tmp, join(outside, basename(entry.tmp)));
  assert.throws(() => mod.applyPlan(plan, { beforeStageCheck }), /may have been written outside the install/);
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('dybs-check asks nothing under checkins: none, the agent-ready test offer included', () => {
  const t = readFileSync(join(SKILLS_SRC, 'dybs-check', 'SKILL.md'), 'utf8');
  const section = t.slice(t.indexOf('## 3. Agent-ready test'));
  assert.match(section.slice(0, 400), /offer it at quick depth, unless\s+`project.md` has `checkins: none`: then ask nothing/);
});

test('without hard links, an original that cannot be looked up at cleanup is reported as kept', async () => {
  const mod = await import('../src/update.mjs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  // At cleanup, the kept original's private name fails with EIO: never
  // taken for gone.
  let cleanup = false;
  const eio = () => { throw Object.assign(new Error('I/O error'), { code: 'EIO' }); };
  const isOrig = (p) => cleanup && /SKILL\.md\.[0-9a-f-]{36}\.rm$/.test(String(p));
  mod.fsOps.link = () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); };
  mod.fsOps.lstat = (p, o) => (isOrig(p) ? eio() : real.lstat(p, o));
  mod.fsOps.open = (p) => (isOrig(p) ? eio() : real.open(p));
  let r;
  try { r = mod.applyPlan(plan, { beforeCleanup: () => { cleanup = true; } }); } finally { Object.assign(mod.fsOps, real); }
  const a = r.actions.find((x) => x.rel === SKILL);
  assert.match(String(a.kept ?? ''), /\.rm$/);
  rmSync(root, { recursive: true });
});

test('empty folders are never pruned through a skill folder swapped for a link', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const root = project(['dybs-start']);
  const dir = join(root, '.agents/skills/dybs-start');
  mkdirSync(join(dir, 'old'));
  writeFileSync(join(dir, 'old/retired.mjs'), 'as shipped');
  const known = { ...knownHashes(), 'dybs-start/old/retired.mjs': [sha('as shipped')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  assert.equal(plan.actions.find((a) => a.rel === 'old/retired.mjs').op, 'remove');
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  mkdirSync(join(outside, 'old'));
  let swapped = false;
  // Right before pruning, the skill folder becomes a link to a tree that
  // holds an empty folder of the same name.
  mod.testHooks.beforePrune = (d) => {
    if (swapped || d !== join(dir, 'old')) return;
    swapped = true;
    renameSync(dir, `${dir}.moved`);
    symlinkSync(outside, dir);
  };
  try { mod.applyPlan(plan); } catch { /* reported */ } finally { mod.testHooks.beforePrune = null; }
  assert.ok(swapped);
  assert.ok(existsSync(join(outside, 'old')), 'the outside folder is never removed');
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('a --force backup that went outside through a folder swapped and restored is named in the error', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'my own version');
  const plan = mod.planInstall(findInstalls([root])[0], { force: true });
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  let writing = false;
  // As if the folder had been a link while the backup was created, and was
  // restored since: the backup is out of reach by name.
  const beforeBackup = (phase) => { if (phase === 'write') writing = true; };
  mod.fsOps.write = (fd, data) => {
    const r = real.write(fd, data);
    if (writing) { writing = false; renameSync(`${prd(root)}.bak`, join(outside, 'SKILL.md.bak')); }
    return r;
  };
  try { assert.throws(() => mod.applyPlan(plan, { beforeBackup }), /written outside the install/); } finally { Object.assign(mod.fsOps, real); }
  assert.equal(readFileSync(join(outside, 'SKILL.md.bak'), 'utf8'), 'my own version');
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('a removed file whose name cannot be checked at the commit point stops the update', async () => {
  const mod = await import('../src/update.mjs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-start']);
  const dir = join(root, '.agents/skills/dybs-start');
  writeFileSync(join(dir, 'scripts/retired.mjs'), 'as shipped');
  const known = { ...knownHashes(), 'dybs-start/scripts/retired.mjs': [sha('as shipped')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  assert.equal(plan.actions.find((a) => a.rel === 'scripts/retired.mjs').op, 'remove');
  let committing = false;
  mod.fsOps.lstat = (p, o) => {
    if (committing && p === join(dir, 'scripts/retired.mjs')) throw Object.assign(new Error('I/O error'), { code: 'EIO' });
    return real.lstat(p, o);
  };
  try { assert.throws(() => mod.applyPlan(plan, { beforeCommit: () => { committing = true; } }), /could not be checked/); } finally { Object.assign(mod.fsOps, real); }
  rmSync(root, { recursive: true });
});

test('a permission change made during an update is never undone', async () => {
  const mod = await import('../src/update.mjs');
  for (const links of [true, false]) {
    const real = { ...mod.fsOps };
    const root = project(['dybs-prd']);
    writeFileSync(prd(root), 'old shipped version');
    chmodSync(prd(root), 0o644);
    const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
    const plan = mod.planInstall(findInstalls([root])[0], { known });
    // The owner tightens the file after the update captured its mode.
    const beforeStageCheck = () => chmodSync(prd(root), 0o600);
    if (!links) mod.fsOps.link = () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); };
    try { assert.throws(() => mod.applyPlan(plan, { beforeStageCheck }), /permissions changed/, `links: ${links}`); } finally { Object.assign(mod.fsOps, real); }
    assert.equal(statSync(prd(root)).mode & 0o777, 0o600, `links: ${links}`);
    assert.equal(readFileSync(prd(root), 'utf8'), 'old shipped version');
    rmSync(root, { recursive: true });
  }
});

test('a permission change made after placement, before the commit point, stops the update', async () => {
  const mod = await import('../src/update.mjs');
  const root = project(['dybs-prd']);
  const dir = dirname(prd(root));
  writeFileSync(prd(root), 'old shipped version');
  chmodSync(prd(root), 0o644);
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  // Through an open file: the original (now under its .old name) is tightened.
  const beforeCommit = () => chmodSync(join(dir, readdirSync(dir).find((n) => n.endsWith('.old'))), 0o600);
  assert.throws(() => mod.applyPlan(plan, { beforeCommit }), /permissions changed/);
  assert.equal(statSync(prd(root)).mode & 0o777, 0o600);
  assert.equal(readFileSync(prd(root), 'utf8'), 'old shipped version');
  rmSync(root, { recursive: true });
});

test('a moved-aside link that cannot be checked is reported, never silently left', async () => {
  const mod = await import('../src/update.mjs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  let linked = null;
  mod.fsOps.link = (from, to) => { const r = real.link(from, to); if (!linked && /\.old$/.test(to)) linked = to; return r; };
  mod.fsOps.lstat = (p, o) => {
    if (linked && p === linked) throw Object.assign(new Error('I/O error'), { code: 'EIO' });
    return real.lstat(p, o);
  };
  try { assert.throws(() => mod.applyPlan(plan), /could not be checked/); } finally { Object.assign(mod.fsOps, real); }
  rmSync(root, { recursive: true });
});

test('an edited original put back at cleanup through a folder swapped and restored keeps its private name', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync, linkSync } = await import('node:fs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  const dir = dirname(prd(root));
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  let oldAt = null;
  let swapped = false;
  // Edited through an open file before cleanup: the cleanup puts it back.
  const beforeCleanup = (s) => { oldAt = s.old; writeFileSync(s.old, 'EDITED in place', { flag: 'r+' }); };
  mod.fsOps.link = (from, to) => {
    if (swapped || to !== oldAt || !/\.rm$/.test(from)) return real.link(from, to);
    swapped = true;
    linkSync(from, join(outside, basename(from)));
    renameSync(dir, `${dir}.moved`);
    symlinkSync(outside, dir);
    try { return real.link(from, to); } finally { rmSync(dir); renameSync(`${dir}.moved`, dir); }
  };
  let result;
  try { result = mod.applyPlan(plan, { beforeCleanup }); } finally { Object.assign(mod.fsOps, real); }
  assert.ok(swapped);
  assert.ok(readdirSync(dir).some((n) => { try { return readFileSync(join(dir, n), 'utf8').startsWith('EDITED'); } catch { return false; } }), 'the edit is still inside the install');
  // The name made outside cannot be reached; it is reported, never silent.
  assert.match(String(result.actions.find((x) => x.rel === SKILL).stray), /may have been created in a folder swapped in/);
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('a --force backup holds exactly the planned bytes, never an outside file read through a swapped folder', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  const dir = dirname(prd(root));
  writeFileSync(prd(root), 'my own version');
  const plan = mod.planInstall(findInstalls([root])[0], { force: true });
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  writeFileSync(join(outside, SKILL), 'someone else');
  let reading = false;
  let swapped = false;
  // The skill folder is a link for the open and the name check, and is back
  // before the folder pins are asked again.
  const beforeBackup = (phase) => { reading = phase === 'read'; };
  mod.fsOps.open = (p) => {
    if (reading && !swapped && p === prd(root)) { swapped = true; renameSync(dir, `${dir}.moved`); symlinkSync(outside, dir); }
    return real.open(p);
  };
  mod.fsOps.lstat = (p, o) => {
    const st = real.lstat(p, o);
    if (swapped && reading && p === prd(root)) { reading = false; rmSync(dir); renameSync(`${dir}.moved`, dir); }
    return st;
  };
  try { assert.throws(() => mod.applyPlan(plan, { beforeBackup }), /changed since the update was planned/); } finally { Object.assign(mod.fsOps, real); }
  assert.ok(swapped);
  assert.equal(readFileSync(prd(root), 'utf8'), 'my own version');
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('a skill folder that is no longer real is not planned on', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const root = project(['dybs-prd']);
  const dir = dirname(prd(root));
  const [install] = findInstalls([root]);
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  renameSync(dir, join(outside, 'dybs-prd'));
  symlinkSync(join(outside, 'dybs-prd'), dir);
  const plan = mod.planInstall(install);
  assert.equal(plan.blocked, true);
  assert.equal(plan.actions[0].op, 'unsafe');
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('an installed file swapped for a FIFO is never waited on', () => {
  const root = project(['dybs-start']);
  const script = `
    import * as mod from ${JSON.stringify(join(PKG_ROOT, 'src/update.mjs'))};
    import { rmSync, writeFileSync } from 'node:fs';
    import { execFileSync } from 'node:child_process';
    const [install] = mod.findInstalls([${JSON.stringify(root)}]);
    writeFileSync(install.dir + '/SKILL.md', 'old shipped version');
    const plan = mod.planInstall(install, { known: { ...mod.knownHashes(), 'dybs-start/SKILL.md': [mod.sha('old shipped version')] } });
    const target = install.dir + '/scripts/dybs-validate.mjs';
    const real = mod.fsOps.open;
    let done = false;
    mod.fsOps.open = (p) => { if (!done && p === target) { done = true; rmSync(p); execFileSync('mkfifo', [p]); } return real(p); };
    try { mod.applyPlan(plan); console.log('applied'); } catch (e) { console.log('refused: ' + e.message); }
  `;
  let out = '';
  let signal = null;
  try { out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10000 }); } catch (e) { out = `${e.stdout}`; signal = e.signal; }
  assert.equal(signal, null, 'never hangs');
  assert.match(out, /refused/);
  rmSync(root, { recursive: true });
});

test('an edited original put back at cleanup never loses its private name, even when the put-back name goes', async () => {
  const mod = await import('../src/update.mjs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  const dir = dirname(prd(root));
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  let oldAt = null;
  let raced = false;
  const beforeCleanup = (s) => { oldAt = s.old; writeFileSync(s.old, 'EDITED in place', { flag: 'r+' }); };
  // Any removal of a name derived from the private one: the put-back name
  // goes first, as another process could do in that instant.
  mod.fsOps.rm = (p, o) => {
    if (!raced && oldAt && p.startsWith(`${oldAt}.`) && /\.rm/.test(p)) { raced = true; real.rm(oldAt); }
    return real.rm(p, o);
  };
  let plan2;
  try { plan2 = mod.applyPlan(plan, { beforeCleanup }); } catch { /* reported */ } finally { Object.assign(mod.fsOps, real); }
  assert.ok(readdirSync(dir).some((n) => { try { return readFileSync(join(dir, n), 'utf8').startsWith('EDITED'); } catch { return false; } }), 'the edit still has a name');
  if (plan2) assert.ok(plan2.actions.find((a) => a.rel === SKILL).alsoAt);
  rmSync(root, { recursive: true });
});

test('a staging file swapped only while it is placed never ends up installed', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  let swapped = false;
  // For the length of a link from the staging name to the skill file, the
  // staging name holds someone else's file; it is back when link returns.
  mod.fsOps.link = (from, to) => {
    if (swapped || to !== prd(root) || !from.endsWith('.new')) return real.link(from, to);
    swapped = true;
    renameSync(from, `${from}.mine`);
    writeFileSync(from, 'evil');
    try { return real.link(from, to); } finally { rmSync(from); renameSync(`${from}.mine`, from); }
  };
  try { mod.applyPlan(plan); } catch { /* refused is fine */ } finally { Object.assign(mod.fsOps, real); }
  assert.notEqual(readFileSync(prd(root), 'utf8'), 'evil');
  rmSync(root, { recursive: true });
});

const noLinks = (mod) => { mod.fsOps.link = () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); }; };

test('a permission check that fails at the commit point stops the update', async () => {
  const mod = await import('../src/update.mjs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  let s0 = null;
  let failing = false;
  const beforePlacedCheck = (s) => { if (s.a.rel === SKILL) s0 = s; };
  const beforeCommit = () => { failing = true; };
  mod.fsOps.lstat = (p, o) => {
    if (failing && s0 && (p === s0.orig || p === s0.old)) { failing = false; throw Object.assign(new Error('I/O error'), { code: 'EIO' }); }
    return real.lstat(p, o);
  };
  try { assert.throws(() => mod.applyPlan(plan, { beforePlacedCheck, beforeCommit }), /could not be checked/); } finally { Object.assign(mod.fsOps, real); }
  assert.equal(readFileSync(prd(root), 'utf8'), 'old shipped version');
  rmSync(root, { recursive: true });
});

test('without hard links, a rollback that keeps an edited install names the real original', async () => {
  const mod = await import('../src/update.mjs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  let s0 = null;
  const beforePlacedCheck = (s) => { if (s.a.rel === SKILL) s0 = s; };
  // The installed file is edited, then the update fails: the edit is kept.
  const beforeCommit = () => { writeFileSync(prd(root), 'edited after install', { flag: 'r+' }); throw new Error('stop here'); };
  noLinks(mod);
  let err;
  try { mod.applyPlan(plan, { beforePlacedCheck, beforeCommit }); } catch (e) { err = e; } finally { Object.assign(mod.fsOps, real); }
  assert.ok(s0?.orig, 'the no-hard-links path moved the original itself aside');
  assert.ok(String(err?.message).includes(`the original is at ${s0.orig}`), String(err?.message));
  rmSync(root, { recursive: true });
});

test('without hard links, the original is kept when its snapshot cannot be put back', async () => {
  const mod = await import('../src/update.mjs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  const dir = dirname(prd(root));
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  let s0 = null;
  const beforePlacedCheck = (s) => { if (s.a.rel === SKILL) s0 = s; };
  // The snapshot vanishes, then the update fails and rolls back.
  const beforeCommit = () => { rmSync(s0.old); throw new Error('stop here'); };
  noLinks(mod);
  try { mod.applyPlan(plan, { beforePlacedCheck, beforeCommit }); } catch { /* reported */ } finally { Object.assign(mod.fsOps, real); }
  assert.ok(s0?.orig);
  assert.ok(readdirSync(dir).some((n) => { try { return readFileSync(join(dir, n), 'utf8') === 'old shipped version'; } catch { return false; } }), 'the original survives');
  rmSync(root, { recursive: true });
});

test('an empty skill folder in an unrelated dot folder is never written into', () => {
  const root = mkdtempSync(join(tmpdir(), 'dybs-update-'));
  const stray = join(root, '.cache/skills/dybs-prd');
  mkdirSync(stray, { recursive: true });
  const { results, skipped } = update([root]);
  assert.equal(results.length, 0);
  assert.deepEqual(readdirSync(stray), []);
  assert.ok(skipped.some((s) => s.dir === stray && /not treated as an install/.test(s.why)));
  // Beside a real install in the same folder, a damaged one is repaired.
  mkdirSync(join(root, '.cache/skills/dybs-scope'), { recursive: true });
  writeFileSync(join(root, '.cache/skills/dybs-scope', SKILL), shippedFiles('dybs-scope')[SKILL]);
  assert.equal(update([root]).results.length, 2);
  rmSync(root, { recursive: true });
});

test('an original whose permissions change before cleanup is kept, never deleted', async () => {
  const mod = await import('../src/update.mjs');
  const { chmodSync, statSync } = await import('node:fs');
  for (const noHardLinks of [false, true]) {
    const real = { ...mod.fsOps };
    const root = project(['dybs-prd']);
    writeFileSync(prd(root), 'old shipped version');
    chmodSync(prd(root), 0o644);
    const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
    const plan = mod.planInstall(findInstalls([root])[0], { known });
    let tightened = null;
    // After the commit point: the owner tightens the original's mode.
    const beforeCleanup = (s) => { tightened = s.orig ?? s.old; chmodSync(tightened, 0o600); };
    if (noHardLinks) noLinks(mod);
    let result;
    try { result = mod.applyPlan(plan, { beforeCleanup }); } finally { Object.assign(mod.fsOps, real); }
    const kept = result.actions.find((a) => a.rel === SKILL).kept;
    assert.ok(kept, `kept is reported (noHardLinks=${noHardLinks})`);
    assert.ok(readdirSync(dirname(prd(root))).some((n) => { const p = join(dirname(prd(root)), n); try { return readFileSync(p, 'utf8') === 'old shipped version' && (statSync(p).mode & 0o777) === 0o600; } catch { return false; } }), 'the tightened original survives');
    rmSync(root, { recursive: true });
  }
});

test('status refuses the update-only options instead of ignoring them', async () => {
  const { run } = await import('../bin/dybs-skills.mjs');
  const root = project(['dybs-prd']);
  const err = console.error; const log = console.log;
  console.error = () => {}; console.log = () => {};
  try {
    assert.equal(run(['status', root, '--force']), 2);
    assert.equal(run(['status', root, '--dry-run']), 2);
    assert.equal(run(['status', root, '--json']), 0);
  } finally { console.error = err; console.log = log; }
  rmSync(root, { recursive: true });
});

test('a mode changed inside the cleanup removal keeps the original', async () => {
  const mod = await import('../src/update.mjs');
  const { chmodSync, statSync } = await import('node:fs');
  for (const noHardLinks of [false, true]) {
    const real = { ...mod.fsOps };
    const root = project(['dybs-prd']);
    writeFileSync(prd(root), 'old shipped version');
    chmodSync(prd(root), 0o644);
    const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
    const plan = mod.planInstall(findInstalls([root])[0], { known });
    let s0 = null;
    let changed = false;
    const beforeCleanup = (s) => { s0 = s; };
    // After the cleanup's own checks, right before the guarded move.
    mod.testHooks.beforeMove = (p) => {
      if (changed || !s0 || !(p === s0.orig || (!s0.orig && p.startsWith(`${s0.old}.`)))) return;
      changed = true;
      chmodSync(p, 0o600);
    };
    if (noHardLinks) noLinks(mod);
    try { mod.applyPlan(plan, { beforeCleanup }); } catch { /* reported */ } finally { Object.assign(mod.fsOps, real); mod.testHooks.beforeMove = null; }
    assert.ok(changed, `the hook fired (noHardLinks=${noHardLinks})`);
    assert.ok(readdirSync(dirname(prd(root))).some((n) => { const p = join(dirname(prd(root)), n); try { return readFileSync(p, 'utf8') === 'old shipped version' && (statSync(p).mode & 0o777) === 0o600; } catch { return false; } }), `the original survives (noHardLinks=${noHardLinks})`);
    rmSync(root, { recursive: true });
  }
});

test('a SKILL.md that is a link or a folder is no evidence of an install', async () => {
  for (const fake of ['link', 'folder']) {
    const root = mkdtempSync(join(tmpdir(), 'dybs-update-'));
    const stray = join(root, '.cache/skills/dybs-prd');
    mkdirSync(stray, { recursive: true });
    const decoy = join(root, '.cache/skills/dybs-scope');
    mkdirSync(decoy, { recursive: true });
    if (fake === 'link') { writeFileSync(join(root, 'elsewhere.md'), 'x'); symlinkSync(join(root, 'elsewhere.md'), join(decoy, SKILL)); }
    else mkdirSync(join(decoy, SKILL));
    update([root]);
    assert.deepEqual(readdirSync(stray), [], `${fake}: nothing written`);
    rmSync(root, { recursive: true });
  }
});

test('a move-aside link made through a folder swapped and restored is reported', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const real = { ...mod.fsOps };
  const root = project(['dybs-prd']);
  const dir = dirname(prd(root));
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  writeFileSync(join(outside, SKILL), 'theirs');
  let swapped = false;
  mod.fsOps.link = (from, to) => {
    if (swapped || from !== prd(root) || !/\.old$/.test(to)) return real.link(from, to);
    swapped = true;
    renameSync(dir, `${dir}.moved`);
    symlinkSync(outside, dir);
    try { return real.link(join(outside, SKILL), to); } finally { rmSync(dir); renameSync(`${dir}.moved`, dir); }
  };
  let err;
  try { mod.applyPlan(plan); } catch (e) { err = e; } finally { Object.assign(mod.fsOps, real); }
  assert.ok(swapped);
  assert.match(String(err?.message), /may have been created in a folder swapped in/);
  assert.equal(readFileSync(prd(root), 'utf8'), 'old shipped version');
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('rollback keeps the moved-aside original when its restored name is removed first', async () => {
  const mod = await import('../src/update.mjs');
  const root = project(['dybs-prd']);
  const dir = dirname(prd(root));
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  let s0 = null;
  let removed = false;
  const beforePlacedCheck = (s) => { if (s.a.rel === SKILL) s0 = s; };
  const beforeCommit = () => { throw new Error('stop here'); };
  // Right before the private name goes, the restored name is removed.
  mod.testHooks.beforeMove = (p) => {
    if (removed || !s0 || p !== s0.old) return;
    removed = true;
    rmSync(s0.p);
  };
  try { mod.applyPlan(plan, { beforePlacedCheck, beforeCommit }); } catch { /* reported */ } finally { mod.testHooks.beforeMove = null; }
  assert.ok(removed);
  assert.ok(readdirSync(dir).some((n) => { try { return readFileSync(join(dir, n), 'utf8') === 'old shipped version'; } catch { return false; } }), 'the original still has a name');
  rmSync(root, { recursive: true });
});

test('rollback keeps a placed file whose permissions were changed', async () => {
  const mod = await import('../src/update.mjs');
  const { chmodSync, statSync } = await import('node:fs');
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  let s0 = null;
  const beforePlacedCheck = (s) => { if (s.a.rel === SKILL) s0 = s; };
  // The new file is tightened, then the update fails.
  const beforeCommit = () => { chmodSync(s0.p, 0o600); throw new Error('stop here'); };
  let err;
  try { mod.applyPlan(plan, { beforePlacedCheck, beforeCommit }); } catch (e) { err = e; }
  assert.match(String(err?.message), /changed after the update wrote it/);
  assert.equal(statSync(prd(root)).mode & 0o777, 0o600);
  assert.equal(readFileSync(prd(root), 'utf8'), String(plan.want[SKILL]));
  rmSync(root, { recursive: true });
});

test('rollback keeps a --force backup whose permissions were changed', async () => {
  const { planInstall, applyPlan } = await import('../src/update.mjs');
  const { chmodSync, statSync } = await import('node:fs');
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'my own edit');
  chmodSync(prd(root), 0o644);
  const plan = planInstall(findInstalls([root])[0], { force: true });
  let backup;
  const steps = plan.actions.filter((a) => ['update', 'replace', 'remove'].includes(a.op)).length;
  assert.throws(() => applyPlan(plan, {
    failAt: steps,
    beforeFail: () => { backup = plan.actions.find((a) => a.rel === SKILL).backup; chmodSync(backup, 0o600); },
  }), /injected failure/);
  assert.ok(existsSync(backup), 'the backup is kept');
  assert.equal(statSync(backup).mode & 0o777, 0o600);
  rmSync(root, { recursive: true });
});

test('install evidence that cannot be looked up is an error, never "not installed"', async () => {
  const mod = await import('../src/update.mjs');
  const real = { ...mod.fsOps };
  const root = mkdtempSync(join(tmpdir(), 'dybs-update-'));
  mkdirSync(join(root, '.cache/skills/dybs-prd'), { recursive: true });
  mod.fsOps.lstat = (p, o) => {
    if (String(p).endsWith(join('dybs-prd', SKILL))) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
    return real.lstat(p, o);
  };
  try { assert.throws(() => mod.discover([root]), /permission denied/); } finally { Object.assign(mod.fsOps, real); }
  rmSync(root, { recursive: true });
});

test('a file to remove whose permissions change before cleanup is kept', async () => {
  const mod = await import('../src/update.mjs');
  const { chmodSync, statSync } = await import('node:fs');
  const root = project(['dybs-prd']);
  const dir = dirname(prd(root));
  writeFileSync(join(dir, 'gone.md'), 'old gone');
  chmodSync(join(dir, 'gone.md'), 0o644);
  const known = { ...knownHashes(), 'dybs-prd/gone.md': [sha('old gone')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  assert.equal(ops(plan)['gone.md'], 'remove');
  let tightened = null;
  const beforeCleanup = (s) => { if (s.a.rel === 'gone.md') { tightened = s.orig ?? s.old; chmodSync(tightened, 0o600); } };
  mod.applyPlan(plan, { beforeCleanup });
  assert.ok(tightened);
  assert.ok(readdirSync(dir).some((n) => { const p = join(dir, n); try { return readFileSync(p, 'utf8') === 'old gone' && (statSync(p).mode & 0o777) === 0o600; } catch { return false; } }), 'the tightened file is kept');
  rmSync(root, { recursive: true });
});

test('a folder not treated as an install leaves its skill in the missing list', () => {
  const root = project(['dybs-scope']);
  mkdirSync(join(root, '.cache/skills/dybs-prd'), { recursive: true });
  const { notInstalled, skipped } = update([root]);
  assert.ok(skipped.some((s) => s.skill === 'dybs-prd'));
  assert.ok(notInstalled.includes('dybs-prd'));
  rmSync(root, { recursive: true });
});

// --- Codex review on PR #3 (7e28efa): a removed file's mode must be on record ---
test('a file to remove whose permissions cannot be read stops the update', async () => {
  const mod = await import('../src/update.mjs');
  const { chmodSync, statSync } = await import('node:fs');
  const root = project(['dybs-prd']);
  const dir = dirname(prd(root));
  const gone = join(dir, 'gone.md');
  writeFileSync(gone, 'old gone');
  chmodSync(gone, 0o644);
  const known = { ...knownHashes(), 'dybs-prd/gone.md': [sha('old gone')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  assert.equal(ops(plan)['gone.md'], 'remove');
  const real = { ...mod.fsOps };
  let failed = 0;
  const calls = [];
  mod.fsOps.lstat = (p, o) => {
    calls.push(p);
    if (p === gone && !failed && calls.filter((c) => c === gone).length === 1) { failed++; throw Object.assign(new Error('i/o error'), { code: 'EIO' }); }
    return real.lstat(p, o);
  };
  const beforeCommit = () => { try { chmodSync(gone, 0o600); } catch { /* moved */ } };
  let err = null;
  try { mod.applyPlan(plan, { beforeCommit }); } catch (e) { err = e; } finally { Object.assign(mod.fsOps, real); }
  assert.equal(failed, 1, 'the mode lookup failed once');
  assert.ok(err, 'the update stops');
  assert.match(err.message, /permissions of gone\.md could not be checked \(EIO\)/);
  assert.equal(readFileSync(gone, 'utf8'), 'old gone', 'the file stays at its name');
  rmSync(root, { recursive: true });
});

// --- Codex review on PR #3 (d370ce5): the recorded mode belongs to the planned file ---
test('a folder swapped during the removed file mode lookup stops the update', async () => {
  const mod = await import('../src/update.mjs');
  const { chmodSync, renameSync, symlinkSync, readdirSync: rd } = await import('node:fs');
  const root = project(['dybs-prd']);
  const skill = dirname(prd(root));
  mkdirSync(join(skill, 'sub'));
  const gone = join(skill, 'sub/gone.md');
  writeFileSync(gone, 'old gone');
  chmodSync(gone, 0o644);
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  writeFileSync(join(outside, 'gone.md'), 'theirs');
  chmodSync(join(outside, 'gone.md'), 0o600);
  const known = { ...knownHashes(), 'dybs-prd/sub/gone.md': [sha('old gone')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  assert.equal(ops(plan)['sub/gone.md'], 'remove');
  // Without the mode the plan recorded, so only the identity tie can tell
  // the outside file from the planned one.
  for (const a of plan.actions) if (a.rel === 'sub/gone.md') delete a.mode;
  const real = { ...mod.fsOps };
  let swapped = 0;
  mod.fsOps.lstat = (p, o) => {
    if (p === gone && !swapped) {
      swapped++;
      renameSync(join(skill, 'sub'), join(skill, 'sub.moved'));
      symlinkSync(outside, join(skill, 'sub'));
      try { return real.lstat(p, o); } finally { rmSync(join(skill, 'sub')); renameSync(join(skill, 'sub.moved'), join(skill, 'sub')); }
    }
    return real.lstat(p, o);
  };
  // The owner then tightens the real file to the mode recorded from outside.
  const beforeCleanup = (s) => { if (s.a.rel === 'sub/gone.md') chmodSync(s.orig ?? s.old, 0o600); };
  let err = null;
  try { mod.applyPlan(plan, { beforeCleanup }); } catch (e) { err = e; } finally { Object.assign(mod.fsOps, real); }
  assert.equal(swapped, 1, 'the folder was swapped during the mode lookup');
  assert.ok(err, 'the update stops');
  assert.match(err.message, /changed since its permissions were recorded|folder on the way/);
  assert.ok(rd(join(skill, 'sub')).some((n) => { try { return readFileSync(join(skill, 'sub', n), 'utf8') === 'old gone'; } catch { return false; } }), 'the file is kept');
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

// --- Codex review on PR #1 (74f1095) and #2 (b5d477f) ---
test('the original name is dropped only while the moved-aside link still holds the file', async () => {
  const mod = await import('../src/update.mjs');
  const { unlinkSync } = await import('node:fs');
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  let removed = null;
  // Right after link(), someone removes the new .old name again.
  mod.testHooks.afterLook = (p) => {
    if (removed || !p.endsWith(SKILL)) return;
    const old = readdirSync(dirname(p)).find((n) => n.endsWith('.old'));
    if (!old) return;
    removed = join(dirname(p), old);
    unlinkSync(removed);
  };
  try { assert.throws(() => mod.applyPlan(plan)); } finally { mod.testHooks.afterLook = null; }
  assert.ok(removed);
  assert.equal(readFileSync(prd(root), 'utf8'), 'old shipped version', 'the original keeps its name');
  rmSync(root, { recursive: true });
});

test('without hard links, rollback keeps an original whose mode changed', async () => {
  const mod = await import('../src/update.mjs');
  const { chmodSync, statSync } = await import('node:fs');
  const root = project(['dybs-prd']);
  const dir = dirname(prd(root));
  writeFileSync(join(dir, 'gone.md'), 'old gone');
  chmodSync(join(dir, 'gone.md'), 0o644);
  const known = { ...knownHashes(), 'dybs-prd/gone.md': [sha('old gone')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  const real = { ...mod.fsOps };
  mod.fsOps.link = () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); };
  let tightened = null;
  // The original, moved to its private name, is tightened through an open
  // file; then the update fails and rolls back.
  const beforeCommit = () => {
    tightened = readdirSync(dir).find((n) => n.startsWith('gone.md.') && n.endsWith('.rm'));
    chmodSync(join(dir, tightened), 0o600);
    throw new Error('failed before commit');
  };
  try { assert.throws(() => mod.applyPlan(plan, { beforeCommit })); } finally { Object.assign(mod.fsOps, real); }
  assert.ok(tightened);
  const kept = readdirSync(dir).filter((n) => { try { return readFileSync(join(dir, n), 'utf8') === 'old gone' && (statSync(join(dir, n)).mode & 0o777) === 0o600; } catch { return false; } });
  assert.ok(kept.length, `the tightened original is kept: ${readdirSync(dir).join(', ')}`);
  rmSync(root, { recursive: true });
});

test('a moved-aside original replaced by another file stops the update', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  const dir = dirname(prd(root));
  let replaced = null;
  const beforeCommit = () => {
    const old = readdirSync(dir).find((n) => n.endsWith('.old'));
    replaced = join(dir, old);
    writeFileSync(`${replaced}.x`, 'old shipped version');
    renameSync(`${replaced}.x`, replaced);
  };
  assert.throws(() => mod.applyPlan(plan, { beforeCommit }), /was replaced during the update/);
  assert.ok(replaced);
  rmSync(root, { recursive: true });
});

// --- Codex review on PR #1 (7daae18) ---
test('a removed file whose mode changed after the plan stops the update', async () => {
  const mod = await import('../src/update.mjs');
  const { chmodSync } = await import('node:fs');
  const root = project(['dybs-prd']);
  const dir = dirname(prd(root));
  const gone = join(dir, 'gone.md');
  writeFileSync(gone, 'old gone');
  chmodSync(gone, 0o644);
  const known = { ...knownHashes(), 'dybs-prd/gone.md': [sha('old gone')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  assert.equal(ops(plan)['gone.md'], 'remove');
  chmodSync(gone, 0o600);
  assert.throws(() => mod.applyPlan(plan), /permissions changed since the update was planned/);
  assert.equal(readFileSync(gone, 'utf8'), 'old gone');
  rmSync(root, { recursive: true });
});

test('a skill folder linked out of the project is no evidence of an install', () => {
  const root = mkdtempSync(join(tmpdir(), 'dybs-update-'));
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  cpSync(join(SKILLS_SRC, 'dybs-start'), join(outside, 'dybs-start'), { recursive: true });
  mkdirSync(join(root, '.cache/skills/dybs-prd'), { recursive: true });
  symlinkSync(join(outside, 'dybs-start'), join(root, '.cache/skills/dybs-start'));
  const { notInstalled, skipped } = update([root]);
  assert.ok(skipped.some((s) => s.skill === 'dybs-prd' && s.notInstall), JSON.stringify(skipped));
  assert.ok(notInstalled.includes('dybs-prd'));
  assert.deepEqual(readdirSync(join(root, '.cache/skills/dybs-prd')), [], 'the empty folder is not written into');
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('the placed file mode is read only from the very file placed', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync, chmodSync } = await import('node:fs');
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  const dir = dirname(prd(root));
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  writeFileSync(join(outside, SKILL), 'theirs');
  chmodSync(join(outside, SKILL), 0o600);
  const real = { ...mod.fsOps };
  let armed = false;
  let swapped = false;
  // The mode lookup itself goes through the skill folder swapped for a
  // link to an outside folder, put back right after.
  mod.testHooks.beforePlacedMode = () => { armed = true; };
  mod.fsOps.lstat = (p, o) => {
    if (armed && p === prd(root)) {
      armed = false;
      swapped = true;
      renameSync(dir, `${dir}.moved`);
      symlinkSync(outside, dir);
      try { return real.lstat(p, o); } finally { rmSync(dir); renameSync(`${dir}.moved`, dir); }
    }
    return real.lstat(p, o);
  };
  let err = null;
  try { mod.applyPlan(plan); } catch (e) { err = e; } finally { Object.assign(mod.fsOps, real); mod.testHooks.beforePlacedMode = null; }
  assert.ok(swapped, 'the folder was swapped during the placed mode lookup');
  assert.ok(err, 'the update stops');
  assert.match(err.message, /changed while it was being installed/);
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

// --- Codex review on PR #1 (c6654e8): a replacement keeps its owner ---
test('a replaced file keeps its owner when update runs as another user', async (t) => {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return t.skip('needs root to give files another owner');
  const mod = await import('../src/update.mjs');
  const { chownSync, statSync } = await import('node:fs');
  for (const noLinks of [false, true]) {
    const root = project(['dybs-prd']);
    writeFileSync(prd(root), 'old shipped version');
    chownSync(prd(root), 65534, 65534);
    const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
    const plan = mod.planInstall(findInstalls([root])[0], { known });
    const real = { ...mod.fsOps };
    if (noLinks) mod.fsOps.link = () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); };
    try { mod.applyPlan(plan); } finally { Object.assign(mod.fsOps, real); }
    assert.notEqual(readFileSync(prd(root), 'utf8'), 'old shipped version', 'it was updated');
    const st = statSync(prd(root));
    assert.deepEqual([st.uid, st.gid], [65534, 65534], `owner kept (noLinks=${noLinks})`);
    rmSync(root, { recursive: true });
  }
});

test('a replacement that cannot be given its owner stops the update', async () => {
  const mod = await import('../src/update.mjs');
  const { chownSync, statSync } = await import('node:fs');
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  // Seen as someone else's file, and the change of owner refused.
  const own = statSync(prd(root));
  const real = { ...mod.fsOps };
  mod.fsOps.lstat = (p, o) => {
    const st = real.lstat(p, o);
    if (p === prd(root)) { st.uid = typeof st.uid === 'bigint' ? BigInt(own.uid + 1) : own.uid + 1; }
    return st;
  };
  mod.fsOps.fchown = () => { throw Object.assign(new Error('not permitted'), { code: 'EPERM' }); };
  try { assert.throws(() => mod.applyPlan(plan), /could not be given its owner/); } finally { Object.assign(mod.fsOps, real); }
  assert.equal(readFileSync(prd(root), 'utf8'), 'old shipped version');
  rmSync(root, { recursive: true });
});

// --- Codex review on PR #2 (63a6284): the removal's rename happens inside the checked folder ---
test('a folder swapped for a link right before a removal moves no outside file', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const root = project(['dybs-prd']);
  const dir = dirname(prd(root));
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  writeFileSync(join(outside, SKILL), 'an unrelated outside file');
  let swapped = false;
  // Right before the original's name is moved aside, after every check, the
  // skill folder becomes a link to the outside folder.
  mod.testHooks.beforeMove = (p) => {
    if (swapped || p !== prd(root)) return;
    swapped = true;
    renameSync(dir, `${dir}.moved`);
    symlinkSync(outside, dir);
  };
  try { assert.throws(() => mod.applyPlan(plan)); } finally {
    mod.testHooks.beforeMove = null;
    if (swapped) { rmSync(dir); renameSync(`${dir}.moved`, dir); }
  }
  assert.ok(swapped);
  assert.equal(readFileSync(join(outside, SKILL), 'utf8'), 'an unrelated outside file', 'the outside file keeps its name');
  assert.deepEqual(readdirSync(outside), [SKILL], 'nothing was moved or left in the outside folder');
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

// --- Codex review on PR #2 (4a3c211): a new file belongs to the skill folder's owner ---
test('a file the update adds belongs to the owner of the skill folder', async (t) => {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return t.skip('needs root to give files another owner');
  const { chownSync, statSync } = await import('node:fs');
  const root = project(['dybs-prd']);
  const dir = dirname(prd(root));
  const name = Object.keys(shippedFiles('dybs-prd')).find((r) => r !== SKILL && !r.includes('/'));
  assert.ok(name, 'dybs-prd ships a second top-level file');
  rmSync(join(dir, name));
  chownSync(dir, 65534, 65534);
  const { results } = update([root]);
  assert.equal(ops(results[0])[name], 'add');
  const st = statSync(join(dir, name));
  assert.deepEqual([st.uid, st.gid], [65534, 65534]);
  rmSync(root, { recursive: true });
});

// --- Codex review on PR #2 (4a3c211): the other moves happen inside the checked folder too ---
const swapBeforeMove = async (mod, dir, match, run) => {
  const { renameSync } = await import('node:fs');
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  let swapped = null;
  mod.testHooks.beforeMove = (p) => {
    if (swapped || !match(p)) return;
    swapped = basename(p);
    writeFileSync(join(outside, swapped), 'an unrelated outside file');
    renameSync(dir, `${dir}.moved`);
    symlinkSync(outside, dir);
  };
  try { run(); } catch { /* refused is fine */ } finally {
    mod.testHooks.beforeMove = null;
    if (swapped) { rmSync(dir); renameSync(`${dir}.moved`, dir); }
  }
  return { swapped, outside };
};

test('without hard links, a folder swapped right before the move aside moves no outside file', async () => {
  const mod = await import('../src/update.mjs');
  const root = project(['dybs-prd']);
  const dir = dirname(prd(root));
  writeFileSync(prd(root), 'old shipped version');
  const plan = mod.planInstall(findInstalls([root])[0], { known: { 'dybs-prd/SKILL.md': [sha('old shipped version')] } });
  const real = { ...mod.fsOps };
  mod.fsOps.link = () => { throw Object.assign(new Error('no hard links'), { code: 'EPERM' }); };
  let r;
  try { r = await swapBeforeMove(mod, dir, (p) => p === prd(root), () => mod.applyPlan(plan)); } finally { Object.assign(mod.fsOps, real); }
  assert.equal(r.swapped, SKILL);
  assert.equal(readFileSync(join(r.outside, SKILL), 'utf8'), 'an unrelated outside file');
  assert.deepEqual(readdirSync(r.outside), [SKILL]);
  rmSync(root, { recursive: true });
  rmSync(r.outside, { recursive: true });
});

test('a folder swapped right before the committed cleanup moves no outside file', async () => {
  const mod = await import('../src/update.mjs');
  const root = project(['dybs-prd']);
  const dir = dirname(prd(root));
  writeFileSync(prd(root), 'old shipped version');
  const plan = mod.planInstall(findInstalls([root])[0], { known: { 'dybs-prd/SKILL.md': [sha('old shipped version')] } });
  const r = await swapBeforeMove(mod, dir, (p) => p.endsWith('.old'), () => mod.applyPlan(plan));
  assert.ok(r.swapped && r.swapped.endsWith('.old'), String(r.swapped));
  assert.equal(readFileSync(join(r.outside, r.swapped), 'utf8'), 'an unrelated outside file');
  assert.deepEqual(readdirSync(r.outside), [r.swapped]);
  rmSync(root, { recursive: true });
  rmSync(r.outside, { recursive: true });
});

// --- Codex review on PR #1 (fa47cac) and #3 (a4ba4f5): owners are kept like modes ---
test('an owner change on the original during the update stops it', async (t) => {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return t.skip('needs root to change owners');
  const mod = await import('../src/update.mjs');
  const { chownSync } = await import('node:fs');
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const plan = mod.planInstall(findInstalls([root])[0], { known: { 'dybs-prd/SKILL.md': [sha('old shipped version')] } });
  const dir = dirname(prd(root));
  // The moved-aside original (the same file as its .old name) changes owner.
  const beforeCommit = () => chownSync(join(dir, readdirSync(dir).find((n) => n.endsWith('.old'))), 65534, 65534);
  assert.throws(() => mod.applyPlan(plan, { beforeCommit }), /owner changed during the update/);
  assert.equal(readFileSync(prd(root), 'utf8'), 'old shipped version');
  rmSync(root, { recursive: true });
});

test('a file to remove whose owner changes before cleanup is kept', async (t) => {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return t.skip('needs root to change owners');
  const mod = await import('../src/update.mjs');
  const { chownSync, statSync } = await import('node:fs');
  const root = project(['dybs-prd']);
  const dir = dirname(prd(root));
  writeFileSync(join(dir, 'gone.md'), 'old gone');
  const plan = mod.planInstall(findInstalls([root])[0], { known: { ...knownHashes(), 'dybs-prd/gone.md': [sha('old gone')] } });
  const beforeCleanup = (s) => { if (s.a.rel === 'gone.md') chownSync(s.orig ?? s.old, 65534, 65534); };
  mod.applyPlan(plan, { beforeCleanup });
  assert.ok(readdirSync(dir).some((n) => { try { return readFileSync(join(dir, n), 'utf8') === 'old gone' && statSync(join(dir, n)).uid === 65534; } catch { return false; } }), 'the re-owned file is kept');
  rmSync(root, { recursive: true });
});

test('a --force backup belongs to the edited file\'s owner', async (t) => {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return t.skip('needs root to change owners');
  const { chownSync, chmodSync, statSync } = await import('node:fs');
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'my own version');
  chownSync(prd(root), 65534, 65534);
  chmodSync(prd(root), 0o600);
  update([root], { force: true });
  const st = statSync(`${prd(root)}.bak`);
  assert.deepEqual([st.uid, st.gid, st.mode & 0o777], [65534, 65534, 0o600]);
  rmSync(root, { recursive: true });
});

test('a skill folder linked to a folder of another name is no evidence of an install', () => {
  const root = mkdtempSync(join(tmpdir(), 'dybs-update-'));
  cpSync(join(SKILLS_SRC, 'dybs-start'), join(root, 'foo'), { recursive: true });
  mkdirSync(join(root, '.cache/skills/dybs-prd'), { recursive: true });
  symlinkSync('../../foo', join(root, '.cache/skills/dybs-start'));
  const { notInstalled } = update([root]);
  assert.ok(notInstalled.includes('dybs-prd'));
  assert.deepEqual(readdirSync(join(root, '.cache/skills/dybs-prd')), [], 'the empty folder is not written into');
  rmSync(root, { recursive: true });
});

// --- Codex review on PR #1 (363dcdf): owners everywhere modes are kept ---
test('a removed file whose owner changed after the plan stops the update', async (t) => {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return t.skip('needs root to change owners');
  const mod = await import('../src/update.mjs');
  const { chownSync } = await import('node:fs');
  const root = project(['dybs-prd']);
  const gone = join(dirname(prd(root)), 'gone.md');
  writeFileSync(gone, 'old gone');
  const plan = mod.planInstall(findInstalls([root])[0], { known: { ...knownHashes(), 'dybs-prd/gone.md': [sha('old gone')] } });
  chownSync(gone, 65534, 65534);
  assert.throws(() => mod.applyPlan(plan), /owner changed since the update was planned/);
  assert.equal(readFileSync(gone, 'utf8'), 'old gone');
  rmSync(root, { recursive: true });
});

test('rollback keeps a placed file whose owner changed', async (t) => {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return t.skip('needs root to change owners');
  const mod = await import('../src/update.mjs');
  const { chownSync, statSync } = await import('node:fs');
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const plan = mod.planInstall(findInstalls([root])[0], { known: { 'dybs-prd/SKILL.md': [sha('old shipped version')] } });
  // The new file is placed, then re-owned, then the update fails.
  const beforeCommit = () => { chownSync(prd(root), 65534, 65534); throw new Error('failed before commit'); };
  assert.throws(() => mod.applyPlan(plan, { beforeCommit }));
  const dir = dirname(prd(root));
  assert.ok(readdirSync(dir).some((n) => { try { return statSync(join(dir, n)).uid === 65534 && readFileSync(join(dir, n), 'utf8') === shippedFiles('dybs-prd')[SKILL].toString(); } catch { return false; } }), 'the re-owned placed file is kept');
  rmSync(root, { recursive: true });
});

test('rollback keeps a --force backup whose owner changed', async (t) => {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return t.skip('needs root to change owners');
  const mod = await import('../src/update.mjs');
  const { chownSync, statSync } = await import('node:fs');
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'my own version');
  const plan = mod.planInstall(findInstalls([root])[0], { force: true });
  const beforeCommit = () => { chownSync(`${prd(root)}.bak`, 65534, 65534); throw new Error('failed before commit'); };
  assert.throws(() => mod.applyPlan(plan, { beforeCommit }));
  assert.equal(statSync(`${prd(root)}.bak`).uid, 65534, 'the re-owned backup is kept');
  rmSync(root, { recursive: true });
});

// --- Codex review on PR #1 (a74b7c6): a folder the update creates gets the skill folder's owner ---
test('a folder the update creates belongs to the owner of the skill folder', async (t) => {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return t.skip('needs root to change owners');
  const { chownSync, statSync } = await import('node:fs');
  const root = project(['dybs-start']);
  const dir = join(root, '.agents/skills/dybs-start');
  const nested = Object.keys(shippedFiles('dybs-start')).find((r) => r.includes('/'));
  assert.ok(nested, 'dybs-start ships a file in a subfolder');
  const sub = nested.slice(0, nested.indexOf('/'));
  rmSync(join(dir, sub), { recursive: true });
  chownSync(dir, 65534, 65534);
  update([root]);
  const st = statSync(join(dir, sub));
  assert.deepEqual([st.uid, st.gid], [65534, 65534]);
  rmSync(root, { recursive: true });
});

// --- Codex review on PR #1 (e718cd5): evidence inside the project, new folders owned in place ---
test('an install outside the project is no evidence for a folder linked back into it', () => {
  const root = mkdtempSync(join(tmpdir(), 'dybs-update-'));
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  cpSync(join(SKILLS_SRC, 'dybs-start'), join(outside, 'dybs-start'), { recursive: true });
  const target = join(root, 'elsewhere/dybs-prd');
  mkdirSync(target, { recursive: true });
  symlinkSync(target, join(outside, 'dybs-prd'));
  for (const agent of ['.claude', '.agents']) {
    mkdirSync(join(root, agent), { recursive: true });
    symlinkSync(outside, join(root, agent, 'skills'));
    update([root]);
    assert.deepEqual(readdirSync(target), [], agent);
    rmSync(join(root, agent), { recursive: true });
  }
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('a folder on the way swapped for a link after a new folder is made gives no outside folder an owner', async (t) => {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return t.skip('needs root to change owners');
  const mod = await import('../src/update.mjs');
  const { chownSync, renameSync } = await import('node:fs');
  const root = project(['dybs-start']);
  const dir = join(root, '.agents/skills/dybs-start');
  const nested = Object.keys(shippedFiles('dybs-start')).find((r) => r.includes('/'));
  const sub = nested.slice(0, nested.indexOf('/'));
  rmSync(join(dir, sub), { recursive: true });
  chownSync(dir, 65534, 65534);
  // Outside, a folder of the same name the update has no business with.
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  mkdirSync(join(outside, sub));
  chownSync(join(outside, sub), 12345, 12345);
  const aside = mkdtempSync(join(tmpdir(), 'dybs-aside-'));
  mod.testHooks.afterMkdir = (p) => {
    if (p !== join(dir, sub)) return;
    mod.testHooks.afterMkdir = null;
    renameSync(dir, join(aside, 'dybs-start'));
    symlinkSync(outside, dir);
  };
  try { update([root]); } catch { /* the update may stop; what matters is the outside folder */ } finally { mod.testHooks.afterMkdir = null; }
  const st = statSync(join(outside, sub));
  assert.deepEqual([st.uid, st.gid], [12345, 12345]);
  for (const d of [root, outside, aside]) rmSync(d, { recursive: true });
});

// --- Codex review on PR #1/#2 (12a94c1, a44a495): put-backs keep a last name, folders go back in place ---
test('a file put back whose restored name is removed keeps its private name', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync, unlinkSync } = await import('node:fs');
  const root = project(['dybs-prd']);
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  let replaced = null;
  let removed = false;
  // A user's file takes the staging name after the in-folder check...
  mod.testHooks.inFolder = (p) => {
    if (replaced || !String(p).endsWith('.new')) return;
    replaced = String(p);
    writeFileSync(`${p}.x`, 'theirs');
    renameSync(`${p}.x`, p);
  };
  // ...it is put back, and the name it is back at goes away right before
  // its private name is removed.
  mod.testHooks.beforeMove = (p) => {
    if (!replaced || removed || !String(p).startsWith(`${replaced}.`) || !String(p).endsWith('.rm')) return;
    removed = true;
    unlinkSync(replaced);
  };
  try { try { mod.applyPlan(plan); } catch { /* reported */ } } finally { mod.testHooks.inFolder = null; mod.testHooks.beforeMove = null; }
  assert.ok(removed, 'the restored name was removed');
  const dir = dirname(prd(root));
  assert.ok(readdirSync(dir).some((n) => { try { return readFileSync(join(dir, n), 'utf8') === 'theirs'; } catch { return false; } }), 'their file still has a name');
  rmSync(root, { recursive: true });
});

test('a folder that took the staging name goes back inside the pinned folder, never through a swapped one', async () => {
  const mod = await import('../src/update.mjs');
  const { renameSync } = await import('node:fs');
  const root = project(['dybs-prd']);
  const dir = join(root, '.agents/skills/dybs-prd');
  writeFileSync(prd(root), 'old shipped version');
  const known = { 'dybs-prd/SKILL.md': [sha('old shipped version')] };
  const plan = mod.planInstall(findInstalls([root])[0], { known });
  const outside = mkdtempSync(join(tmpdir(), 'dybs-outside-'));
  let replaced = null;
  let swapped = null;
  mod.testHooks.inFolder = (p) => {
    if (replaced || !String(p).endsWith('.new')) return;
    replaced = String(p);
    rmSync(replaced);
    mkdirSync(replaced);
  };
  // Right before the folder is moved back, the skill folder is swapped for
  // a link to an outside folder holding an entry of the same private name.
  mod.testHooks.beforeDirBack = (aside) => {
    swapped = basename(aside);
    mkdirSync(join(outside, swapped));
    renameSync(dir, `${dir}.moved`);
    symlinkSync(outside, dir);
  };
  try { try { mod.applyPlan(plan); } catch { /* reported */ } } finally { mod.testHooks.inFolder = null; mod.testHooks.beforeDirBack = null; }
  assert.ok(swapped, 'the folder reached the move back');
  assert.deepEqual(readdirSync(outside).sort(), [swapped], 'nothing outside was renamed');
  rmSync(root, { recursive: true });
  rmSync(outside, { recursive: true });
});

test('the README says what a replaced file keeps, and what it does not', () => {
  const t = readFileSync(join(PKG_ROOT, 'README.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(t, /A replaced file keeps its permissions and owner\. Extended attributes and ACLs on it are not carried over/);
});


// --- Codex review on PR #2 (e2ff4c7): the current release with CRLF endings is up to date ---
test('the current release checked out with CRLF line endings is left as it is', () => {
  const root = project(['dybs-prd']);
  const crlf = shippedFiles('dybs-prd')[SKILL].toString().replace(/\n/g, '\r\n');
  writeFileSync(prd(root), crlf);
  const [install] = findInstalls([root]);
  assert.equal(ops(updateInstall(install))[SKILL], 'same');
  assert.equal(readFileSync(prd(root), 'utf8'), crlf, 'not rewritten to LF');
  rmSync(root, { recursive: true });
});

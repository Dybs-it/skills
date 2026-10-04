import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, cpSync, symlinkSync,
  readdirSync, lstatSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  PKG_ROOT, SKILLS_SRC, GETTING_STARTED, QUALITY, findInstalls, update, updateInstall, skillNames, shippedFiles, knownHashes, sha,
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
  const others = GETTING_STARTED.filter((s) => s !== 'dybs-start');
  for (const s of others) assert.equal(block(s), block(others[0]), s);
});

test('every skill carries an identical interview.md', () => {
  const base = readFileSync(join(SKILLS_SRC, 'dybs-start', 'interview.md'), 'utf8');
  for (const s of GETTING_STARTED) {
    assert.equal(readFileSync(join(SKILLS_SRC, s, 'interview.md'), 'utf8'), base, s);
  }
});

test('every doc skill points to interview.md and has core and thorough checklists', () => {
  for (const s of GETTING_STARTED.filter((n) => !['dybs-start', 'dybs-check'].includes(n))) {
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
  for (const s of GETTING_STARTED.filter((n) => n !== 'dybs-start')) {
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
  for (const s of GETTING_STARTED.filter((n) => !['dybs-start', 'dybs-check'].includes(n))) {
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

// --- quality skills ---

test('every skill belongs to exactly one group', () => {
  assert.deepEqual([...GETTING_STARTED, ...QUALITY].sort(), skillNames());
});

test('every quality skill carries an identical quality.md', () => {
  const base = readFileSync(join(SKILLS_SRC, 'dybs-test-plan', 'quality.md'), 'utf8');
  for (const s of QUALITY) assert.equal(readFileSync(join(SKILLS_SRC, s, 'quality.md'), 'utf8'), base, s);
});

test('quality skills point to quality.md and to dybs/work/<task>/', () => {
  for (const s of QUALITY) {
    const t = readFileSync(join(SKILLS_SRC, s, SKILL), 'utf8');
    assert.match(t, /quality\.md/, s);
    assert.match(t, /dybs\/work\/<task>\//, s);
  }
});

test('quality.md carries the attribution for adapted text', () => {
  const t = readFileSync(join(SKILLS_SRC, 'dybs-test-plan', 'quality.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(t, /Copyright \(c\) 2025 BMad Code, LLC/);
  assert.match(t, /Copyright \(c\) 2026 Matt Pocock/);
});

test('the gate template parses and computes', () => {
  const r = execFileSync('node', [join(PKG_ROOT, 'skills/dybs-gate/scripts/dybs-gate.mjs'), join(PKG_ROOT, 'tests/fixtures/gate-pass.md'), '--json'], { encoding: 'utf8' });
  assert.equal(JSON.parse(r).decision, 'PASS');
});

test('docs/sources.md describes every skill', () => {
  const t = readFileSync(join(PKG_ROOT, 'docs/sources.md'), 'utf8');
  for (const s of skillNames()) {
    const section = t.split(new RegExp(`^### \`${s}\`$`, 'm'))[1];
    assert.ok(section, `docs/sources.md has no "### \`${s}\`" section`);
    const body = section.split(/^##/m)[0];
    assert.match(body, /\*\*Our own:\*\*/, `${s}: say what is our own`);
  }
});

test('every quality skill carries the same standalone section', () => {
  const block = (s) => {
    const t = readFileSync(join(SKILLS_SRC, s, SKILL), 'utf8');
    const i = t.indexOf('## If something is not installed');
    assert.ok(i >= 0, `${s} lacks the standalone section`);
    return t.slice(i);
  };
  for (const s of QUALITY) assert.equal(block(s), block(QUALITY[0]), s);
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

test('every quality skill points to the MIT notices it ships in quality.md', () => {
  for (const s of QUALITY) {
    const t = readFileSync(join(SKILLS_SRC, s, SKILL), 'utf8').replace(/\s+/g, ' ');
    assert.match(t, /copyright notices are in the header of `quality\.md` in this folder/, s);
    const q = readFileSync(join(SKILLS_SRC, s, 'quality.md'), 'utf8').replace(/\s+/g, ' ');
    assert.match(q, /Copyright \(c\) 2025 BMad Code, LLC/, s);
    assert.match(q, /Copyright \(c\) 2026 Matt Pocock/, s);
  }
});

test('dybs-check carries dybs-ux\'s developer-experience reading word for word', () => {
  const ux = readFileSync(join(SKILLS_SRC, 'dybs-ux', SKILL), 'utf8');
  const dx = ux.slice(ux.indexOf('## API, library or CLI'), ux.indexOf('## Readiness checklist')).split('\n').slice(1).join('\n')
    .replace('this doc covers', '`ux.md` covers');
  assert.ok(readFileSync(join(SKILLS_SRC, 'dybs-check', SKILL), 'utf8').includes(dx), 'copy the section into dybs-check');
});

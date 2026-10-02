// Installs the packaged skills into a project's agent folders.
//
// Safety rule: we only ever overwrite or delete a file we installed AND that
// still has the exact bytes we installed (recorded in a per-target manifest).
// A file the user edited, or one we never installed, is reported and left
// alone unless --force is given, in which case it is backed up first.

import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync,
  rmSync, rmdirSync, copyFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SKILLS_SRC = join(PKG_ROOT, 'skills');
export const MANIFEST = '.dybs-skills.json';

export const TARGETS = {
  claude: { dir: '.claude/skills', kind: 'skills', label: 'Claude Code' },
  agents: { dir: '.agents/skills', kind: 'skills', label: 'Codex, Gemini CLI, Kimi and other .agents/skills readers' },
  opencode: { dir: '.opencode/commands', kind: 'commands', label: 'OpenCode (commands that load .agents/skills)' },
};

export function packageVersion() {
  return JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')).version;
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const posix = (p) => p.split(sep).join('/');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

export function skillNames() {
  return readdirSync(SKILLS_SRC).filter((n) => existsSync(join(SKILLS_SRC, n, 'SKILL.md'))).sort();
}

function description(skill) {
  const text = readFileSync(join(SKILLS_SRC, skill, 'SKILL.md'), 'utf8');
  const m = text.match(/^description:\s*(.+)$/m);
  return m ? m[1].trim() : skill;
}

// The files a target should contain: { relPath: Buffer }.
export function desiredFiles(target) {
  const files = {};
  if (TARGETS[target].kind === 'skills') {
    for (const p of walk(SKILLS_SRC)) files[posix(relative(SKILLS_SRC, p))] = readFileSync(p);
  } else {
    // OpenCode reads commands, not skills: each command points at the shared skill.
    for (const skill of skillNames()) {
      const body = `---\ndescription: ${JSON.stringify(description(skill))}\n---\n\n`
        + `Read \`.agents/skills/${skill}/SKILL.md\` and follow it exactly. `
        + `Files it mentions are relative to that folder.\n\n$ARGUMENTS\n`;
      files[`${skill}.md`] = Buffer.from(body);
    }
  }
  return files;
}

export function detectTargets(root) {
  const found = [];
  if (existsSync(join(root, '.claude')) || existsSync(join(root, 'CLAUDE.md'))) found.push('claude');
  if (existsSync(join(root, '.agents')) || existsSync(join(root, 'AGENTS.md')) || existsSync(join(root, '.codex'))
    || existsSync(join(root, '.gemini'))) found.push('agents');
  if (existsSync(join(root, '.opencode'))) found.push('opencode');
  if (found.includes('opencode') && !found.includes('agents')) found.push('agents');
  return found.length ? found : ['claude', 'agents'];
}

function readManifest(dir) {
  const p = join(dir, MANIFEST);
  if (!existsSync(p)) return { version: null, files: {} };
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    throw new Error(`${p} is not valid JSON. Fix or delete it, then run again.`);
  }
}

function backupPath(p) {
  let b = `${p}.bak`;
  for (let i = 1; existsSync(b); i++) b = `${p}.bak${i}`;
  return b;
}

function removeEmptyDirs(dir, stopAt) {
  let d = dir;
  while (d.startsWith(stopAt) && d !== stopAt && existsSync(d) && readdirSync(d).length === 0) {
    rmdirSync(d);
    d = dirname(d);
  }
}

// Plans and (unless dryRun) applies an install or update for one target.
export function installTarget(root, target, { force = false, dryRun = false } = {}) {
  const dir = join(root, TARGETS[target].dir);
  const manifest = readManifest(dir);
  const want = desiredFiles(target);
  const actions = [];

  for (const [rel, buf] of Object.entries(want)) {
    const p = join(dir, rel);
    const newHash = sha(buf);
    if (!existsSync(p)) { actions.push({ op: 'add', rel }); continue; }
    const cur = readFileSync(p);
    const curHash = sha(cur);
    if (curHash === newHash) { actions.push({ op: 'same', rel }); continue; }
    if (manifest.files[rel] === curHash) { actions.push({ op: 'update', rel }); continue; }
    const why = manifest.files[rel] ? 'edited since install' : 'not installed by dybs-skills';
    actions.push({ op: force ? 'replace' : 'conflict', rel, why });
  }

  // Files we installed before that the new version no longer ships.
  for (const [rel, hash] of Object.entries(manifest.files)) {
    if (rel in want) continue;
    const p = join(dir, rel);
    if (!existsSync(p)) continue;
    const curHash = sha(readFileSync(p));
    actions.push(curHash === hash ? { op: 'remove', rel } : { op: 'keep', rel, why: 'edited since install, no longer shipped' });
  }

  if (!dryRun) {
    const files = {};
    for (const a of actions) {
      const p = join(dir, a.rel);
      if (a.op === 'add' || a.op === 'update' || a.op === 'replace') {
        mkdirSync(dirname(p), { recursive: true });
        if (a.op === 'replace') { a.backup = posix(relative(root, backupPath(p))); copyFileSync(p, join(root, a.backup)); }
        writeFileSync(p, want[a.rel]);
      }
      if (a.op === 'remove') { rmSync(p); removeEmptyDirs(dirname(p), dir); }
      if (['add', 'update', 'replace', 'same'].includes(a.op)) files[a.rel] = sha(want[a.rel]);
      // A conflict keeps its previous manifest entry, if any, so a later run still knows it was ours.
      if (a.op === 'conflict' && manifest.files[a.rel]) files[a.rel] = manifest.files[a.rel];
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, MANIFEST), JSON.stringify({ version: packageVersion(), files }, null, 2) + '\n');
  }
  return { target, dir: TARGETS[target].dir, actions };
}

export function uninstallTarget(root, target, { dryRun = false } = {}) {
  const dir = join(root, TARGETS[target].dir);
  const manifest = readManifest(dir);
  const actions = [];
  for (const [rel, hash] of Object.entries(manifest.files)) {
    const p = join(dir, rel);
    if (!existsSync(p)) continue;
    const same = sha(readFileSync(p)) === hash;
    actions.push(same ? { op: 'remove', rel } : { op: 'keep', rel, why: 'edited since install' });
  }
  if (!dryRun) {
    for (const a of actions) {
      if (a.op === 'remove') { const p = join(dir, a.rel); rmSync(p); removeEmptyDirs(dirname(p), dir); }
    }
    if (existsSync(join(dir, MANIFEST))) rmSync(join(dir, MANIFEST));
  }
  return { target, dir: TARGETS[target].dir, actions };
}

export function status(root) {
  return Object.keys(TARGETS).map((t) => {
    const m = readManifest(join(root, TARGETS[t].dir));
    return { target: t, dir: TARGETS[t].dir, version: m.version, files: Object.keys(m.files).length };
  });
}

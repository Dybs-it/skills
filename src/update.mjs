// Safe update for Dybs skills that are already installed (usually by
// `npx skills add Dybs-it/skills`, which puts the real files in
// .agents/skills and symlinks other agents' folders to them).
//
// Safety rules:
// - A file is only overwritten or deleted when its bytes match a version this
//   package shipped (src/known-hashes.json, append-only). Anything else is the
//   user's edit: reported and left alone unless --force, which keeps a .bak.
// - Nothing below the resolved skill folder is followed: a symbolic link,
//   dangling or not, is never read through or written through, --force or not.
// - A skill with any conflict is not touched at all, so it never mixes files
//   from two releases.

import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync,
  rmSync, rmdirSync, copyFileSync, realpathSync, lstatSync, renameSync,
  constants as fsConstants,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SKILLS_SRC = join(PKG_ROOT, 'skills');
export const KNOWN_HASHES = join(PKG_ROOT, 'src/known-hashes.json');
export const INSTALL_HINT = 'npx skills add Dybs-it/skills';

export const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const posix = (p) => p.split(sep).join('/');

export function packageVersion() {
  return JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')).version;
}

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

// Shipped files of one skill: { 'SKILL.md': Buffer, 'template.md': Buffer, ... }
export function shippedFiles(skill) {
  const base = join(SKILLS_SRC, skill);
  return Object.fromEntries(walk(base).map((p) => [posix(relative(base, p)), readFileSync(p)]));
}

// { 'dybs-prd/SKILL.md': [hash, ...] } for every version ever shipped.
export function knownHashes() {
  return existsSync(KNOWN_HASHES) ? JSON.parse(readFileSync(KNOWN_HASHES, 'utf8')) : {};
}

// Every `.<agent>/skills/` folder under a root holds candidate installs.
function skillFolders(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((n) => n.startsWith('.'))
    .map((n) => join(root, n, 'skills'))
    .filter((p) => existsSync(p) && statSync(p).isDirectory());
}

// Installed Dybs skills, deduplicated by real path (symlinks followed).
export function findInstalls(roots) {
  const byReal = new Map();
  for (const root of roots) {
    for (const folder of skillFolders(root)) {
      for (const skill of skillNames()) {
        const dir = join(folder, skill);
        if (!existsSync(join(dir, 'SKILL.md'))) continue;
        const real = realpathSync(dir);
        const seen = byReal.get(real);
        if (seen) seen.via.push(dir);
        else byReal.set(real, { skill, dir: real, via: [dir] });
      }
    }
  }
  return [...byReal.values()].sort((a, b) => a.dir.localeCompare(b.dir));
}

export function rootsFor(projectRoot, { global = false } = {}) {
  return global ? [projectRoot, homedir()] : [projectRoot];
}

// lstat, not exists: a dangling link at the backup name counts as taken.
function taken(p) {
  try { lstatSync(p); return true; } catch { return false; }
}

function backupPath(p) {
  let b = `${p}.bak`;
  for (let i = 1; taken(b); i++) b = `${p}.bak${i}`;
  return b;
}

function removeEmptyDirs(dir, stopAt) {
  let d = dir;
  while (d !== stopAt && d.startsWith(stopAt) && existsSync(d) && readdirSync(d).length === 0) {
    rmdirSync(d);
    d = dirname(d);
  }
}

// What is at `dir/rel`, judged without following any link below `dir`
// (`dir` itself is the already-resolved skill folder). Only a regular file
// reached through real directories is ever read or written.
export function inspectPath(dir, rel) {
  const parts = rel.split('/');
  let p = dir;
  for (let i = 0; i < parts.length; i++) {
    p = join(p, parts[i]);
    let st;
    try {
      st = lstatSync(p);
    } catch (err) {
      if (err.code === 'ENOENT') return { state: 'missing' };
      throw err;
    }
    const last = i === parts.length - 1;
    if (st.isSymbolicLink()) return { state: 'unsafe', why: `${posix(relative(dir, p))} is a symbolic link` };
    if (!last && !st.isDirectory()) return { state: 'unsafe', why: `${posix(relative(dir, p))} is not a directory` };
    if (last && !st.isFile()) return { state: 'unsafe', why: 'not a regular file' };
  }
  return { state: 'file' };
}

// Plans an update of one installed skill without touching the disk.
// `blocked` is true when anything in the skill needs a human: then nothing
// in that skill is applied, so a skill never ends up half one release and
// half another. `--force` resolves edited regular files (with a backup); it
// never resolves an unsafe path.
export function planInstall(install, { force = false, known = knownHashes() } = {}) {
  const { skill, dir } = install;
  const want = shippedFiles(skill);
  const isKnown = (rel, hash) => (known[`${skill}/${rel}`] || []).includes(hash);
  const actions = [];

  for (const [rel, buf] of Object.entries(want)) {
    const at = inspectPath(dir, rel);
    if (at.state === 'unsafe') { actions.push({ op: 'unsafe', rel, why: at.why }); continue; }
    if (at.state === 'missing') { actions.push({ op: 'add', rel }); continue; }
    const curHash = sha(readFileSync(join(dir, rel)));
    if (curHash === sha(buf)) { actions.push({ op: 'same', rel }); continue; }
    if (isKnown(rel, curHash)) { actions.push({ op: 'update', rel }); continue; }
    actions.push({ op: force ? 'replace' : 'conflict', rel, why: 'changed after install' });
  }

  // Files earlier versions shipped that this version no longer does.
  for (const key of Object.keys(known)) {
    if (!key.startsWith(`${skill}/`)) continue;
    const rel = key.slice(skill.length + 1);
    if (rel in want) continue;
    const at = inspectPath(dir, rel);
    if (at.state === 'missing') continue;
    if (at.state === 'unsafe') { actions.push({ op: 'unsafe', rel, why: at.why }); continue; }
    actions.push(isKnown(rel, sha(readFileSync(join(dir, rel))))
      ? { op: 'remove', rel }
      : { op: 'keep', rel, why: 'changed after install, no longer shipped' });
  }

  const blocked = actions.some((a) => a.op === 'conflict' || a.op === 'unsafe');
  return { ...install, actions, blocked, want };
}

// Applies a plan. New content is written to temporary files next to their
// targets first and only then renamed into place, so a failure while
// writing leaves the skill as it was. rename() replaces a path, it never
// follows a link at the destination.
export function applyPlan(plan) {
  if (plan.blocked) return { ...plan, applied: false };
  const { dir, actions, want } = plan;
  const staged = [];
  try {
    for (const a of actions) {
      if (!['add', 'update', 'replace'].includes(a.op)) continue;
      const p = join(dir, a.rel);
      mkdirSync(dirname(p), { recursive: true });
      const tmp = `${p}.dybs-tmp-${process.pid}`;
      writeFileSync(tmp, want[a.rel], { flag: 'wx' });
      staged.push({ a, p, tmp });
    }
  } catch (err) {
    for (const s of staged) rmSync(s.tmp, { force: true });
    throw err;
  }
  for (const { a, p, tmp } of staged) {
    if (a.op === 'replace') { const b = backupPath(p); copyFileSync(p, b, fsConstants.COPYFILE_EXCL); a.backup = b; }
    renameSync(tmp, p);
  }
  for (const a of actions) {
    if (a.op !== 'remove') continue;
    const p = join(dir, a.rel);
    rmSync(p);
    removeEmptyDirs(dirname(p), dir);
  }
  return { ...plan, applied: true };
}

export function updateInstall(install, { dryRun = false, ...opts } = {}) {
  const plan = planInstall(install, opts);
  const { want, ...result } = dryRun ? { ...plan, applied: false } : applyPlan(plan);
  return result;
}

export function update(roots, opts = {}) {
  const installs = findInstalls(roots);
  const installed = new Set(installs.map((i) => i.skill));
  return {
    results: installs.map((i) => updateInstall(i, opts)),
    notInstalled: skillNames().filter((s) => !installed.has(s)),
  };
}

// Adds the hash of every currently shipped file. Never removes one: older
// hashes are what make an install of an older version recognisable.
export function recordHashes() {
  const known = knownHashes();
  let added = 0;
  for (const skill of skillNames()) {
    for (const [rel, buf] of Object.entries(shippedFiles(skill))) {
      const key = `${skill}/${rel}`;
      const h = sha(buf);
      known[key] = known[key] || [];
      if (!known[key].includes(h)) { known[key].push(h); added++; }
    }
  }
  const sorted = Object.fromEntries(Object.keys(known).sort().map((k) => [k, known[k]]));
  writeFileSync(KNOWN_HASHES, JSON.stringify(sorted, null, 2) + '\n');
  return added;
}

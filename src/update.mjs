// Safe update for Dybs skills that are already installed (usually by
// `npx skills add Dybs-it/skills`, which puts the real files in
// .agents/skills and symlinks other agents' folders to them).
//
// Safety rule: a file is only overwritten or deleted when its bytes match a
// version this package has shipped (src/known-hashes.json, append-only).
// Anything else is the user's edit: reported and left alone unless --force,
// which keeps a .bak copy first.

import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync,
  rmSync, rmdirSync, copyFileSync, realpathSync,
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

function backupPath(p) {
  let b = `${p}.bak`;
  for (let i = 1; existsSync(b); i++) b = `${p}.bak${i}`;
  return b;
}

function removeEmptyDirs(dir, stopAt) {
  let d = dir;
  while (d !== stopAt && d.startsWith(stopAt) && existsSync(d) && readdirSync(d).length === 0) {
    rmdirSync(d);
    d = dirname(d);
  }
}

export function updateInstall(install, { force = false, dryRun = false, known = knownHashes() } = {}) {
  const { skill, dir } = install;
  const want = shippedFiles(skill);
  const isKnown = (rel, hash) => (known[`${skill}/${rel}`] || []).includes(hash);
  const actions = [];

  for (const [rel, buf] of Object.entries(want)) {
    const p = join(dir, rel);
    if (!existsSync(p)) { actions.push({ op: 'add', rel }); continue; }
    const curHash = sha(readFileSync(p));
    if (curHash === sha(buf)) { actions.push({ op: 'same', rel }); continue; }
    if (isKnown(rel, curHash)) { actions.push({ op: 'update', rel }); continue; }
    actions.push({ op: force ? 'replace' : 'conflict', rel, why: 'changed after install' });
  }

  // Files earlier versions shipped that this version no longer does.
  for (const key of Object.keys(known)) {
    if (!key.startsWith(`${skill}/`)) continue;
    const rel = key.slice(skill.length + 1);
    if (rel in want) continue;
    const p = join(dir, rel);
    if (!existsSync(p)) continue;
    actions.push(isKnown(rel, sha(readFileSync(p)))
      ? { op: 'remove', rel }
      : { op: 'keep', rel, why: 'changed after install, no longer shipped' });
  }

  if (!dryRun) {
    for (const a of actions) {
      const p = join(dir, a.rel);
      if (a.op === 'add' || a.op === 'update' || a.op === 'replace') {
        mkdirSync(dirname(p), { recursive: true });
        if (a.op === 'replace') { const b = backupPath(p); copyFileSync(p, b); a.backup = b; }
        writeFileSync(p, want[a.rel]);
      }
      if (a.op === 'remove') { rmSync(p); removeEmptyDirs(dirname(p), dir); }
    }
  }
  return { ...install, actions };
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

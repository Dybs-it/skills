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
  rmSync, rmdirSync, copyFileSync, realpathSync, lstatSync, renameSync, linkSync, chmodSync,
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

const within = (p, root) => p === root || p.startsWith(root + sep);

// Installed Dybs skills, deduplicated by real path (symlinks followed).
// A skill whose real folder lies outside every requested root is reported in
// `skipped`, never updated: a linked `.claude` or `.claude/skills` must not
// let a project update reach a shared or home-level install (that takes
// --global).
export function discover(roots) {
  const realRoots = roots.filter((r) => existsSync(r)).map((r) => realpathSync(r));
  const byReal = new Map();
  const skipped = [];
  for (const root of roots) {
    for (const folder of skillFolders(root)) {
      for (const skill of skillNames()) {
        const dir = join(folder, skill);
        // An install is recognised by any file we ship in it, not only by
        // SKILL.md: an install that lost SKILL.md is damaged, and update
        // repairs it instead of calling it "not installed".
        if (!existsSync(dir) || !Object.keys(shippedFiles(skill)).some((rel) => existsSync(join(dir, rel)))) continue;
        const real = realpathSync(dir);
        if (!realRoots.some((r) => within(real, r))) {
          skipped.push({ skill, dir: real, via: dir, why: 'resolves outside the requested folder' });
          continue;
        }
        const seen = byReal.get(real);
        if (seen) seen.via.push(dir);
        else byReal.set(real, { skill, dir: real, via: [dir] });
      }
    }
  }
  return {
    installs: [...byReal.values()].sort((a, b) => a.dir.localeCompare(b.dir)),
    skipped,
  };
}

export function findInstalls(roots) {
  return discover(roots).installs;
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
  // A checkout with core.autocrlf turns LF into CRLF; that is the same
  // shipped file, so match it with line endings normalised too.
  const isKnownFile = (rel, buf) => isKnown(rel, sha(buf)) || isKnown(rel, sha(buf.toString('utf8').replace(/\r\n/g, '\n')));
  const actions = [];

  for (const [rel, buf] of Object.entries(want)) {
    const at = inspectPath(dir, rel);
    if (at.state === 'unsafe') { actions.push({ op: 'unsafe', rel, why: at.why }); continue; }
    if (at.state === 'missing') { actions.push({ op: 'add', rel }); continue; }
    const cur = readFileSync(join(dir, rel));
    const curHash = sha(cur);
    if (curHash === sha(buf)) { actions.push({ op: 'same', rel }); continue; }
    if (isKnownFile(rel, cur)) { actions.push({ op: 'update', rel, hash: curHash }); continue; }
    actions.push(force ? { op: 'replace', rel, hash: curHash, why: 'changed after install' } : { op: 'conflict', rel, why: 'changed after install' });
  }

  // Files earlier versions shipped that this version no longer does.
  for (const key of Object.keys(known)) {
    if (!key.startsWith(`${skill}/`)) continue;
    const rel = key.slice(skill.length + 1);
    if (rel in want) continue;
    const at = inspectPath(dir, rel);
    if (at.state === 'missing') continue;
    if (at.state === 'unsafe') { actions.push({ op: 'unsafe', rel, why: at.why }); continue; }
    const cur = readFileSync(join(dir, rel));
    const curHash = sha(cur);
    actions.push(isKnownFile(rel, cur)
      ? { op: 'remove', rel, hash: curHash }
      : { op: 'keep', rel, why: 'changed after install, no longer shipped' });
  }

  const blocked = actions.some((a) => a.op === 'conflict' || a.op === 'unsafe');
  return { ...install, actions, blocked, want };
}

// Creates the folders of `relDir` below `root` one level at a time, never
// through a link: an existing level must be a real folder, a missing one is
// created on its own (not recursively). Returns the first folder it made.
function mkdirNoFollow(root, relDir) {
  if (relDir === '.' || relDir === '') return undefined;
  let p = root;
  let first;
  for (const part of relDir.split(/[\\/]/)) {
    p = join(p, part);
    let st = null;
    try { st = lstatSync(p); } catch (err) { if (err.code !== 'ENOENT') throw err; }
    if (st) {
      if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(`${posix(relative(root, p))} is not a real folder; nothing was changed, run update again`);
      continue;
    }
    mkdirSync(p);
    first = first || p;
  }
  return first;
}

// Filesystem calls applyPlan uses for no-clobber placement; a test swaps
// `link` to act like a filesystem without hard links.
export const fsOps = { link: linkSync };

// Puts `from` at `to` without overwriting anything there. link() does that
// atomically; on a filesystem without hard links (exFAT, some network
// mounts) it falls back to a check followed by rename().
function placeNoClobber(from, to) {
  try {
    fsOps.link(from, to);
    rmSync(from);
  } catch (err) {
    if (err.code === 'EEXIST') throw err;
    if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EMLINK', 'ENOSYS', 'EXDEV'].includes(err.code)) throw err;
    if (taken(to)) throw Object.assign(new Error(`${to} exists`), { code: 'EEXIST' });
    renameSync(from, to);
  }
}

// Applies a plan as one transaction. New content is written to temporary
// files next to the targets first. Then every file that will be replaced or
// removed is moved aside before its new version is renamed in. If any step
// fails, everything done so far is undone (new files out, originals back),
// so the skill never holds files from two releases. rename() replaces a
// path, it never follows a link at the destination.
// `failAt` is a test hook: throw just before the n-th rename, after calling
// `beforeFail` (which lets a test act like a concurrent writer).
export function applyPlan(plan, { failAt, beforeFail, beforeMkdir } = {}) {
  if (plan.blocked) return { ...plan, applied: false };
  const { dir, actions, want } = plan;
  const tag = `dybs-${process.pid}-${Date.now()}`;
  const staged = [];
  const backups = [];
  const done = [];
  const createdDirs = [];
  let step = 0;
  const tick = () => {
    if (failAt !== undefined && step++ === failAt) { beforeFail?.(); throw new Error('injected failure'); }
  };
  // The plan was made earlier; a folder inside the skill may have been
  // swapped for a link since. Check every path again, right before touching
  // it, so nothing is written through a link out of the skill folder.
  const recheck = (a) => {
    const at = inspectPath(dir, a.rel);
    const expected = a.op === 'add' ? ['missing'] : ['file'];
    if (at.state === 'unsafe' || !expected.includes(at.state)) {
      throw new Error(`${a.rel} changed since the update was planned (${at.why || at.state}); nothing was changed, run update again`);
    }
  };
  try {
    for (const a of actions) if (['add', 'update', 'replace', 'remove'].includes(a.op)) recheck(a);
    for (const a of actions) {
      if (!['add', 'update', 'replace', 'remove'].includes(a.op)) continue;
      const p = join(dir, a.rel);
      if (a.op === 'remove') { staged.push({ a, p }); continue; }
      beforeMkdir?.();
      const made = mkdirNoFollow(dir, dirname(a.rel));
      if (made) createdDirs.push({ deepest: dirname(p), stop: dirname(made) });
      recheck(a);
      const tmp = `${p}.${tag}.new`;
      // A replaced file keeps its permissions: a 0600 file stays 0600.
      const mode = a.op === 'add' ? undefined : lstatSync(p).mode & 0o7777;
      writeFileSync(tmp, want[a.rel], { flag: 'wx', mode });
      if (mode !== undefined) chmodSync(tmp, mode);
      staged.push({ a, p, tmp });
      if (a.op === 'replace') {
        const b = backupPath(p);
        copyFileSync(p, b, fsConstants.COPYFILE_EXCL);
        backups.push(b);
        a.backup = b;
      }
    }
    // Nothing written since the plan may be lost. A file is moved aside and
    // only then compared with the bytes the plan saw; a new file is put in
    // place with link(), which refuses to overwrite one that appeared since.
    for (const s of staged) {
      if (s.a.op !== 'add') {
        tick();
        s.old = `${s.p}.${tag}.old`;
        renameSync(s.p, s.old);
        done.push(s);
        if (sha(readFileSync(s.old)) !== s.a.hash) throw new Error(`${s.a.rel} changed since the update was planned; nothing was changed, run update again`);
      }
      if (s.tmp) {
        tick();
        try {
          placeNoClobber(s.tmp, s.p);
        } catch (err) {
          if (err.code === 'EEXIST') throw new Error(`${s.a.rel} appeared since the update was planned; nothing was changed, run update again`);
          throw err;
        }
        s.placed = true;
        if (s.a.op === 'add') done.push(s);
      }
    }
  } catch (err) {
    const stuck = [];
    const undo = (what, fn) => { try { fn(); } catch (e) { stuck.push(`${what}: ${e.message}`); } };
    for (const s of done.reverse()) {
      // Remove a file we placed only while it still holds exactly what we
      // wrote: if someone changed it since, it is theirs now. It stays, and
      // so does the original we moved aside, for a human to sort out.
      if (s.placed) {
        let ours = false;
        try { ours = sha(readFileSync(s.p)) === sha(want[s.a.rel]); } catch { ours = false; }
        if (!ours) {
          stuck.push(`${s.a.rel} changed after the update wrote it; kept as is${s.old ? `, the original is at ${s.old}` : ''}`);
          continue;
        }
        undo(s.a.rel, () => rmSync(s.p));
      }
      // Put the original back without overwriting anything that appeared.
      if (s.old) undo(s.a.rel, () => placeNoClobber(s.old, s.p));
    }
    for (const s of staged) if (s.tmp) undo(s.a.rel, () => rmSync(s.tmp, { force: true }));
    for (const b of backups) undo(b, () => rmSync(b, { force: true }));
    for (const a of actions) delete a.backup;
    for (const d of createdDirs) undo(d.deepest, () => removeEmptyDirs(d.deepest, d.stop));
    if (stuck.length) err.message += `; could not undo everything, check by hand: ${stuck.join('; ')}`;
    throw err;
  }
  // Committed: the moved-aside originals are no longer needed.
  for (const s of staged) {
    if (s.old) rmSync(s.old, { force: true });
    if (s.a.op === 'remove') removeEmptyDirs(dirname(s.p), dir);
  }
  return { ...plan, applied: true };
}

export function updateInstall(install, { dryRun = false, ...opts } = {}) {
  const plan = planInstall(install, opts);
  const { want, ...result } = dryRun ? { ...plan, applied: false } : applyPlan(plan);
  return result;
}

export function update(roots, opts = {}) {
  const { installs, skipped } = discover(roots);
  const installed = new Set(installs.map((i) => i.skill));
  return {
    results: installs.map((i) => updateInstall(i, opts)),
    notInstalled: skillNames().filter((s) => !installed.has(s)),
    skipped,
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

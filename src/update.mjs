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
  rmSync, rmdirSync, copyFileSync, realpathSync, lstatSync, renameSync, linkSync,
  openSync, closeSync, fstatSync, fchmodSync,
  constants as fsConstants,
} from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
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

// A root that already ends in a separator (`/`, `C:\\`) is its own prefix.
export const within = (p, root) => p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);

// Installed Dybs skills, deduplicated by real path (symlinks followed).
// A skill whose real folder lies outside every requested root is reported in
// `skipped`, never updated: a linked `.claude` or `.claude/skills` must not
// let a project update reach a shared or home-level install (that takes
// --global).
export function discover(roots) {
  const realRoots = roots.filter((r) => existsSync(r)).map((r) => realpathSync(r));
  const byReal = new Map();
  const skipped = [];
  const clash = new Set();
  for (const root of roots) {
    for (const folder of skillFolders(root)) {
      for (const skill of skillNames()) {
        const dir = join(folder, skill);
        // An install is recognised by its folder, not by SKILL.md: an install
        // that lost files (dybs-check ships SKILL.md alone) is damaged, and
        // update repairs it instead of calling it "not installed".
        if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
        const real = realpathSync(dir);
        if (!realRoots.some((r) => within(real, r))) {
          skipped.push({ skill, dir: real, via: dir, why: 'resolves outside the requested folder' });
          continue;
        }
        // One folder answering to two skill names (a link named dybs-prd
        // pointing at dybs-scope) is unsafe: updating it as either would
        // overwrite the other. It is reported for every name, never updated.
        if (basename(real) !== skill) {
          skipped.push({ skill, dir: real, via: dir, why: `resolves to a folder named ${basename(real)}, not ${skill}` });
          clash.add(real);
          continue;
        }
        // A folder whose name is its skill's can answer to no other name.
        const seen = byReal.get(real);
        if (seen) { if (!seen.via.includes(dir)) seen.via.push(dir); }
        else byReal.set(real, { skill, dir: real, via: [dir] });
      }
    }
  }
  for (const real of clash) {
    const seen = byReal.get(real);
    if (!seen) continue;
    byReal.delete(real);
    skipped.push({ skill: seen.skill, dir: real, via: seen.via[0], why: 'the same folder is claimed by more than one skill name' });
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
  // The same folder twice (the home folder with --global) would list every
  // install twice, so roots are deduplicated by their real path.
  const roots = global ? [projectRoot, homedir()] : [projectRoot];
  const real = (r) => { try { return realpathSync(r); } catch { return r; } };
  return roots.filter((r, i) => roots.findIndex((o) => real(o) === real(r)) === i);
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

// The skill folder as planned: a real directory (not a link) at its own
// real path, identified by device and inode, so a folder renamed away and
// replaced by a link or another folder is noticed before anything is written.
function rootIdentity(dir) {
  const st = lstatSync(dir);
  if (!st.isDirectory() || realpathSync(dir) !== dir) return null;
  return { dev: st.dev, ino: st.ino };
}

function sameRoot(dir, root) {
  try {
    const now = rootIdentity(dir);
    return Boolean(root && now && now.dev === root.dev && now.ino === root.ino);
  } catch { return false; }
}

// Device and inode of a path itself (no link followed), or null.
const idOfStat = (st) => `${st.dev}:${st.ino}`;
function idOf(p) {
  try { return idOfStat(lstatSync(p)); } catch { return null; }
}

// Creates `p` exclusively and writes `data` to it. `onCreate(id)` runs as
// soon as the file exists, before any write that can fail, so the caller
// can register it for rollback; the identity comes from the open file
// itself, not from a second lookup of the path.
function writeOwnFile(p, data, mode, onCreate) {
  const fd = openSync(p, 'wx', mode ?? 0o666);
  try {
    onCreate(idOfStat(fstatSync(fd)));
    fsOps.write(fd, data);
    if (mode !== undefined) fchmodSync(fd, mode);
  } finally { closeSync(fd); }
}

// Removes `p` only while it is still the file we created (`id`).
function rmIfOurs(p, id) {
  const now = idOf(p);
  if (now === null) return;
  if (now !== id) throw new Error(`${p} is not the file the update wrote; left in place`);
  rmSync(p);
}

// The identity (device and inode) of the skill folder and of every folder
// between it and `rel`, all real directories, never links. null when any
// is missing or is not a real directory.
export function chainOf(dir, rel) {
  const ids = [];
  let p = dir;
  for (const part of ['', ...rel.split('/').slice(0, -1)]) {
    p = part ? join(p, part) : p;
    let st;
    try { st = lstatSync(p); } catch { return null; }
    if (!st.isDirectory()) return null;
    ids.push(`${st.dev}:${st.ino}`);
  }
  return ids.join('/');
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
  const root = rootIdentity(dir);
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
  return { ...install, actions, blocked, want, root };
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
export const fsOps = { link: linkSync, copyFile: copyFileSync, rm: rmSync, write: writeFileSync };

// Puts a copy of `from` at `to` without overwriting anything there, and
// leaves `from` for the caller to remove once it has recorded the placement:
// a failure after placing must still be undone. link() does that
// atomically; on a filesystem without hard links (exFAT, some network
// mounts) it falls back to an exclusive copy: COPYFILE_EXCL creates `to`
// with O_EXCL, so a file or link that appears there at any moment is
// refused, never replaced. A check followed by rename() would overwrite
// whatever appeared in between.
export function placeNoClobber(from, to) {
  try {
    fsOps.link(from, to);
    return 'link';
  } catch (err) {
    if (err.code === 'EEXIST') throw err;
    if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EMLINK', 'ENOSYS', 'EXDEV'].includes(err.code)) throw err;
    fsOps.copyFile(from, to, fsConstants.COPYFILE_EXCL);
    return 'copy';
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
export function applyPlan(plan, { failAt, beforeFail, beforeMkdir, beforePin, beforeStageCheck, beforeCleanup } = {}) {
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
    if (!sameRoot(dir, plan.root)) throw new Error(`${dir} changed since the update was planned (the skill folder was moved or replaced); nothing was changed, run update again`);
    const at = inspectPath(dir, a.rel);
    const expected = a.op === 'add' ? ['missing'] : ['file'];
    if (at.state === 'unsafe' || !expected.includes(at.state)) {
      throw new Error(`${a.rel} changed since the update was planned (${at.why || at.state}); nothing was changed, run update again`);
    }
  };
  // Node has no openat(), so a folder can still be swapped for a link
  // between a check and the rename that follows it. Every folder on each
  // path is pinned by identity once staged, and checked again before and
  // after every rename: a swap that lands is detected and rolled back
  // (the rollback works through the same path, so it undoes the move
  // wherever it went) instead of being trusted.
  const pinned = (s) => {
    beforePin?.(s);
    if (!s.chain || !sameRoot(dir, plan.root) || chainOf(dir, s.a.rel) !== s.chain) {
      throw new Error(`a folder on the way to ${s.a.rel} changed during the update; nothing was kept, run update again`);
    }
  };
  try {
    for (const a of actions) if (['add', 'update', 'replace', 'remove'].includes(a.op)) recheck(a);
    for (const a of actions) {
      if (!['add', 'update', 'replace', 'remove'].includes(a.op)) continue;
      const p = join(dir, a.rel);
      if (a.op === 'remove') { staged.push({ a, p, chain: chainOf(dir, a.rel) }); continue; }
      beforeMkdir?.();
      const made = mkdirNoFollow(dir, dirname(a.rel));
      if (made) createdDirs.push({ deepest: dirname(p), stop: dirname(made) });
      recheck(a);
      // Pin the folders first, then write, then prove the file is where we
      // meant it: a folder swapped for a link and back again around the
      // write would leave the chain looking unchanged, but our file missing.
      const chain = chainOf(dir, a.rel);
      const tmp = `${p}.${tag}.new`;
      // A replaced file keeps its permissions: a 0600 file stays 0600.
      const mode = a.op === 'add' ? undefined : lstatSync(p).mode & 0o7777;
      // Registered as soon as it exists, before any write that can fail
      // (disk full, quota), so the rollback always knows to remove it.
      const entry = { a, p, tmp, chain };
      writeOwnFile(tmp, want[a.rel], mode, (id) => { entry.tmpId = id; staged.push(entry); });
      beforeStageCheck?.(entry);
      if (!chain || chainOf(dir, a.rel) !== chain || idOf(tmp) !== entry.tmpId) {
        throw new Error(`a folder on the way to ${a.rel} changed while the update was writing; nothing was kept, run update again (a stray ${basename(tmp)} may have been written through it)`);
      }
      if (a.op === 'replace') {
        // The backup is written the same way: created exclusively, tracked
        // before its bytes go in, and proven to be where we meant it.
        const b = backupPath(p);
        const backup = { path: b };
        writeOwnFile(b, readFileSync(p), lstatSync(p).mode & 0o7777, (id) => { backup.id = id; backups.push(backup); });
        if (chainOf(dir, a.rel) !== chain || idOf(b) !== backup.id) {
          throw new Error(`a folder on the way to ${a.rel} changed while the update was writing; nothing was kept, run update again (a stray ${basename(b)} may have been written through it)`);
        }
        a.backup = b;
      }
    }
    // Nothing written since the plan may be lost. A file is moved aside and
    // only then compared with the bytes the plan saw; a new file is put in
    // place with link(), which refuses to overwrite one that appeared since.
    for (const s of staged) {
      if (s.a.op !== 'add') {
        tick();
        pinned(s);
        s.old = `${s.p}.${tag}.old`;
        renameSync(s.p, s.old);
        done.push(s);
        pinned(s);
        if (sha(readFileSync(s.old)) !== s.a.hash) throw new Error(`${s.a.rel} changed since the update was planned; nothing was changed, run update again`);
      }
      if (s.tmp) {
        tick();
        pinned(s);
        // The staged file must still hold exactly the bytes we wrote: one
        // edited in place keeps its identity and its folders, so only its
        // content can tell. A link places this very file, so it is checked
        // here, right before.
        let staged = null;
        try { staged = readFileSync(s.tmp); } catch { staged = null; }
        if (!staged || sha(staged) !== sha(want[s.a.rel])) {
          throw new Error(`the staged copy of ${s.a.rel} changed before it was installed; nothing was kept, run update again`);
        }
        let how;
        try {
          how = placeNoClobber(s.tmp, s.p);
        } catch (err) {
          if (err.code === 'EEXIST') throw new Error(`${s.a.rel} appeared since the update was planned; nothing was changed, run update again`);
          throw err;
        }
        s.placed = true;
        // A link places the staged file itself, whose identity we know; a
        // copy is a new file, read back at once.
        s.placedId = how === 'link' ? s.tmpId : idOf(s.p);
        if (s.a.op === 'add') done.push(s);
        pinned(s);
        fsOps.rm(s.tmp);
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
        // Ours means: reached through the pinned folders, the very file we
        // placed, still holding our bytes. Bytes alone are not enough: a
        // folder swapped for a link could show an outside file with the same
        // shipped content, and that file must never be deleted.
        let ours = false;
        try {
          ours = chainOf(dir, s.a.rel) === s.chain && idOf(s.p) === s.placedId && sha(readFileSync(s.p)) === sha(want[s.a.rel]);
        } catch { ours = false; }
        if (!ours) {
          stuck.push(`${s.a.rel} changed after the update wrote it; kept as is${s.old ? `, the original is at ${s.old}` : ''}`);
          continue;
        }
        undo(s.a.rel, () => rmSync(s.p));
      }
      // Put the original back without overwriting anything that appeared.
      if (s.old) undo(s.a.rel, () => { placeNoClobber(s.old, s.p); rmSync(s.old); });
    }
    // Remove only what is provably ours: the file at that name must be the
    // one we wrote, or a same-named file reached through a swapped link
    // would be deleted instead.
    for (const s of staged) if (s.tmp) undo(s.a.rel, () => rmIfOurs(s.tmp, s.tmpId));
    for (const b of backups) undo(b.path, () => rmIfOurs(b.path, b.id));
    for (const a of actions) delete a.backup;
    for (const d of createdDirs) undo(d.deepest, () => removeEmptyDirs(d.deepest, d.stop));
    if (stuck.length) err.message += `; could not undo everything, check by hand: ${stuck.join('; ')}`;
    throw err;
  }
  // Committed: the moved-aside originals are no longer needed, unless one
  // changed after its check (an editor still writing through an open file):
  // then it holds someone's edit, so it is kept and reported, never deleted.
  for (const s of staged) {
    if (s.old) {
      beforeCleanup?.(s);
      let bytes = null;
      try { bytes = readFileSync(s.old); } catch { bytes = null; }
      if (bytes && sha(bytes) !== s.a.hash) s.a.kept = s.old;
      else rmSync(s.old, { force: true });
    }
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

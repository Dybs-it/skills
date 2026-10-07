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

import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync,
  rmSync, rmdirSync, copyFileSync, realpathSync, lstatSync, renameSync, linkSync,
  openSync, closeSync, fstatSync, fchmodSync, fchownSync,
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

// Skill groups. Getting Started skills share interview.md and the doc rules;
// quality skills share quality.md. A test keeps these lists complete.
export const GETTING_STARTED = ['dybs-start', 'dybs-prd', 'dybs-scope', 'dybs-domain', 'dybs-architecture', 'dybs-ux', 'dybs-ui', 'dybs-check'];
export const QUALITY = ['dybs-test-plan', 'dybs-tests', 'dybs-review', 'dybs-gate', 'dybs-pr'];

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

// Whether a path exists. Only a path that is really not there counts as
// absent: existsSync() also says false for one we may not search, which
// would report an install we could not inspect as an empty one.
function isPresent(p) {
  try { statSync(p); return true; } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return false;
    throw e;
  }
}

// Every `.<agent>/skills/` folder under a root holds candidate installs.
function skillFolders(root) {
  if (!isPresent(root)) return [];
  return readdirSync(root)
    .filter((n) => n.startsWith('.'))
    .map((n) => join(root, n, 'skills'))
    // Only a folder that is really not there counts as absent: existsSync()
    // also says false for one we may not enter, which would report an
    // install we could not inspect as an empty one.
    .filter((p) => {
      try { return statSync(p).isDirectory(); } catch (e) {
        if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return false;
        throw e;
      }
    });
}

// A root that already ends in a separator (`/`, `C:\\`) is its own prefix.
export const within = (p, root) => p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);

// Installed Dybs skills, deduplicated by real path (symlinks followed).
// A skill whose real folder lies outside every requested root is reported in
// `skipped`, never updated: a linked `.claude` or `.claude/skills` must not
// let a project update reach a shared or home-level install (that takes
// --global).
export function discover(roots) {
  const realRoots = roots.filter((r) => isPresent(r)).map((r) => realpathSync(r));
  const byReal = new Map();
  const skipped = [];
  const clash = new Set();
  for (const root of roots) {
    for (const folder of skillFolders(root)) {
      // Evidence that this `.<name>/skills/` is a Dybs install at all: it is
      // skills.sh's own `.agents/skills/`, or some Dybs skill there still has
      // its SKILL.md. Any dot folder is scanned (agents keep adding them), so
      // without it an empty `dybs-prd/` in an unrelated `.cache/skills/`
      // would be "repaired" by writing into it.
      // The evidence is a real SKILL.md file, never a link or a folder by
      // that name.
      // Only a path that is not there is "no evidence"; a lookup that fails
      // otherwise (EACCES, EIO) is an error, never an empty install.
      const realFile = (p) => { try { return fsOps.lstat(p).isFile(); } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return false; throw e; } };
      // The skill folder holding it counts only as an install would: a
      // real folder, or a link that resolves inside the requested folder
      // (as `.claude/skills/x` linking to `.agents/skills/x` does). Through a
      // link out of it, lstat() of SKILL.md reports a file that is not here.
      const realDir = (p) => {
        let st;
        try { st = fsOps.lstat(p); } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return false; throw e; }
        if (!st.isDirectory() && !st.isSymbolicLink()) return false;
        // A real folder too: lstat() follows the folders above it, so through
        // a linked `.<agent>/skills` it may be a folder outside the project.
        let real;
        try { real = realpathSync(p); } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR' || e.code === 'ELOOP') return false; throw e; }
        // And as its own skill: a link named dybs-start that resolves to a
        // folder named foo is no install, so it is no evidence either.
        return basename(real) === basename(p) && realRoots.some((r) => within(real, r));
      };
      // `.agents` vouches by its name only for a folder that is in the project.
      const inside = (() => { try { return realRoots.some((r) => within(realpathSync(folder), r)); } catch { return false; } })();
      const installed = (basename(dirname(folder)) === '.agents' && inside) || skillNames().some((n) => realDir(join(folder, n)) && realFile(join(folder, n, 'SKILL.md')));
      for (const skill of skillNames()) {
        const dir = join(folder, skill);
        // An install is recognised by its folder, not by SKILL.md: an install
        // that lost files (dybs-check ships SKILL.md alone) is damaged, and
        // update repairs it instead of calling it "not installed".
        // Absent only when really not there: existsSync() also says false
        // for a folder we may not search, hiding an install we cannot read.
        let st;
        try { st = statSync(dir); } catch (e) {
          if (e.code === 'ENOENT' || e.code === 'ENOTDIR') continue;
          throw e;
        }
        if (!st.isDirectory()) continue;
        if (!installed) {
          skipped.push({ skill, dir, via: dir, why: 'no Dybs skill with a SKILL.md is installed beside it, so this folder is not treated as an install', notInstall: true });
          continue;
        }
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

// `stopId` is the identity `stopAt` must have: checked on every pass, so a
// skill folder swapped for a link (to a tree with the same empty folders)
// is never pruned through.
function removeEmptyDirs(dir, stopAt, stopId) {
  testHooks.beforePrune?.(dir);
  let d = dir;
  const stopOk = () => {
    try { const st = lstatSync(stopAt, BIG); return !st.isSymbolicLink() && st.isDirectory() && (!stopId || idOfStat(st) === stopId); } catch { return false; }
  };
  // Every folder from `stopAt` down to `d` must be a real folder right
  // before it is removed: an ancestor swapped for a link would make rmdir
  // reach (and delete) an empty folder somewhere else.
  const real = (to) => {
    if (!stopOk()) return false;
    let p = stopAt;
    for (const part of relative(stopAt, to).split(sep).filter(Boolean)) {
      p = join(p, part);
      try { const st = lstatSync(p); if (st.isSymbolicLink() || !st.isDirectory()) return false; } catch { return false; }
    }
    return true;
  };
  // The folders' identities are recorded before the folder is listed and
  // required again right before rmdir: an empty folder that replaced the
  // one this update emptied is someone else's, never removed.
  const ids = (to) => {
    if (!stopOk()) return null;
    const out = [];
    let p = stopAt;
    for (const part of relative(stopAt, to).split(sep).filter(Boolean)) {
      p = join(p, part);
      try { const st = lstatSync(p, BIG); if (st.isSymbolicLink() || !st.isDirectory()) return null; out.push(idOfStat(st)); } catch { return null; }
    }
    return out.join('/');
  };
  while (d !== stopAt && d.startsWith(stopAt) && existsSync(d)) {
    const before = ids(d);
    if (!before || readdirSync(d).length !== 0) return;
    testHooks.beforeRmdir?.(d);
    if (!real(d) || ids(d) !== before) return;
    rmdirSync(d);
    d = dirname(d);
  }
}

// The skill folder as planned: a real directory (not a link) at its own
// real path, identified by device and inode, so a folder renamed away and
// replaced by a link or another folder is noticed before anything is written.
// Birth time included: a folder deleted and recreated can get the same
// device and inode at once.
function rootIdentity(dir) {
  const st = lstatSync(dir, BIG);
  if (!st.isDirectory() || realpathSync(dir) !== dir) return null;
  return idOfStat(st);
}

function sameRoot(dir, root) {
  try {
    const now = rootIdentity(dir);
    return Boolean(root && now && now === root);
  } catch { return false; }
}

// Device and inode of a path itself (no link followed), or null.
// Device, inode and birth time, from a bigint stat: a freed inode number is
// reused at once (ext4 hands it to the very next file), so device and inode
// alone can make a file created later look like one we created and removed.
// Where the filesystem keeps no birth time this is device and inode only.
const ownerOf = (st) => ({ uid: Number(st.uid), gid: Number(st.gid) });
const sameOwner = (st, owner) => Number(st.uid) === owner.uid && Number(st.gid) === owner.gid;
const idOfStat = (st) => `${st.dev}:${st.ino}:${st.birthtimeNs ?? ''}`;
const BIG = { bigint: true };
// Reads a file without following a link at its own name (O_NOFOLLOW), and
// only if what was opened is a regular file: a file swapped for a link after
// it was inspected is never read through. null when it is not.
function readNoFollow(p) {
  return readNoFollowStat(p)?.data ?? null;
}
// The same, with the mode of the very file read (not of a later lookup).
// With `id`, only that very file (device and inode, checked on the open
// descriptor) is read: a check of the name followed by a read of the name
// could read whatever replaced it in between, a link included.
function readNoFollowStat(p, id) {
  let fd;
  try { fd = fsOps.open(p); } catch (e) {
    if (['ELOOP', 'EMLINK', 'ENOENT', 'ENOTDIR'].includes(e.code)) return null;
    throw e;
  }
  try {
    const st = fstatSync(fd, BIG);
    if (!st.isFile() || (id != null && idOfStat(st) !== id) || !stillAtName(p, st)) return null;
    return { data: readFileSync(fd), mode: Number(st.mode) & 0o7777, owner: ownerOf(st) };
  } finally { closeSync(fd); }
}
// Where open() has no O_NOFOLLOW (Windows), a link at the name is followed.
// So the opened file must also be what the name itself is (no link
// followed): the same identity, and not a link.
function stillAtName(p, st) {
  try {
    const own = fsOps.lstat(p, BIG);
    return !own.isSymbolicLink() && idOfStat(own) === idOfStat(st);
  } catch { return false; }
}
// The bytes of exactly the file `id` at `p`, or null.
const readById = (p, id) => readNoFollowStat(p, id)?.data ?? null;

function idOf(p) {
  try { return idOfStat(fsOps.lstat(p, BIG)); } catch { return null; }
}
// Provably absent: only ENOENT and ENOTDIR say so. Any other failure (an
// I/O error, a stale handle) leaves the name possibly holding a file.
function provablyGone(p) {
  try { fsOps.lstat(p); return false; } catch (e) { return e.code === 'ENOENT' || e.code === 'ENOTDIR'; }
}
// Only a regular file is what the plan saw: a link that replaced it keeps
// its own identity through link() and rename(), while reads follow it.
function isRegular(p) {
  try { return fsOps.lstat(p).isFile(); } catch { return false; }
}

// Creates `p` exclusively and writes `data` to it. `onCreate(id)` runs as
// soon as the file exists, before any write that can fail, so the caller
// can register it for rollback; the identity comes from the open file
// itself, not from a second lookup of the path.
// With `owner`, the new file gets that owner too: run as another user (sudo),
// a replacement would otherwise belong to the updater, and the user it was
// for could no longer edit it. One that cannot be given that owner stops the
// update rather than install a file its user cannot change.
// Gives a folder this run just created the owner `owner`, through a
// descriptor opened without following a link; one that cannot be given it
// stops the update (the caller's rollback removes the folder). `name` is
// opened as given: mkdirNoFollow passes the bare name, from inside the
// pinned parent, so no folder on the way is resolved again.
function ownFolder(name, owner) {
  const fd = openSync(name, fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY ?? 0) | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const st = fstatSync(fd, BIG);
    if (sameOwner(st, owner)) return;
    try { fsOps.fchown(fd, owner.uid, owner.gid); } catch (e) {
      throw new Error(`${basename(name)} could not be given its owner ${owner.uid}:${owner.gid} (${e.code || e.message}); run update as that user`);
    }
  } finally { closeSync(fd); }
}

function writeOwnFile(p, data, mode, onCreate, owner) {
  const fd = openSync(p, 'wx', mode ?? 0o666);
  try {
    const st = fstatSync(fd, BIG);
    onCreate(idOfStat(st));
    fsOps.write(fd, data);
    if (owner && (Number(st.uid) !== owner.uid || Number(st.gid) !== owner.gid)) {
      try { fsOps.fchown(fd, owner.uid, owner.gid); } catch (e) {
        throw new Error(`${basename(p)} could not be given its owner ${owner.uid}:${owner.gid} (${e.code || e.message}); run update as that user`);
      }
    }
    // After the owner: a change of owner can clear permission bits.
    if (mode !== undefined) fchmodSync(fd, mode);
  } finally { closeSync(fd); }
}

// Removes `p` only while it is still the file we created (`id`).
// The file is first moved to a name only this run knows, then checked
// there: what is verified is exactly what gets deleted, even if something
// replaces `p` in between. One that is not ours goes back, never over
// anything, or stays under its new name and the error says where.
// Test seam: runs between the first look at a name and acting on it.
export const testHooks = { afterPlace: null, beforePlacedMode: null, inFolder: null, afterLook: null, afterMkdir: null, beforeMove: null, beforePutBack: null, beforePrune: null, beforeRmdir: null, beforeUndoRm: null, beforePlanRead: null, beforeTrash: null };

// `check` runs immediately before the move (for example, that the folders
// on the way are still the pinned ones), so nothing is moved through a
// folder that changed after an earlier check.
// With `sole`, the file must also have no other name: a file this run
// created but someone has since linked elsewhere is not removed. With
// `expect` (a sha), it must also still hold those bytes once under its
// private name: an editor writing through an open file keeps the identity,
// so only the content can tell, and an edited file is put back, not removed.
// Renames `from` to `to` (same folder) only as the very file `id`. Node has
// no renameat(), so a check by path and a rename by path can resolve through
// different folders (one swapped for a link in between). The process steps
// into the folder instead: its working directory stays bound to that folder
// whatever happens to the path, so the file checked by its bare name there
// is the very file the bare-name rename moves. Through a folder swapped
// before the step, the name holds another file, and nothing moves.
function renameInFolder(from, to, id) {
  const back = process.cwd();
  process.chdir(dirname(from));
  try {
    if (idOfStat(lstatSync(basename(from), { bigint: true })) !== id) return false;
    testHooks.inFolder?.(from);
    renameSync(basename(from), basename(to));
    return true;
  } finally { try { process.chdir(back); } catch { /* the caller's folder is gone; nothing of ours depends on it */ } }
}

function rmIfOurs(p, id, check, { sole = false, shared = false, expect = null, mode = null, owner = null } = {}) {
  // Gone is gone; a lookup that fails for another reason (a folder that
  // became unsearchable, I/O) is an error, never "already removed".
  try { fsOps.lstat(p); } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return; throw e; }
  testHooks.afterLook?.(p);
  check?.();
  // Only the very file is moved: whatever replaced it since (a folder too,
  // which no link or copy could put back) stays at its name.
  let now;
  try { now = idOfStat(fsOps.lstat(p, BIG)); } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return; throw e; }
  if (now !== id) throw new Error(`${p} is not the file the update wrote; left in place`);
  testHooks.beforeMove?.(p);
  const aside = `${p}.${randomUUID()}.rm`;
  // The move itself happens inside the very folder that was checked (see
  // renameInFolder): through a folder swapped for a link at this instant it
  // would otherwise take an outside file off its name.
  try {
    if (!renameInFolder(p, aside, id)) throw new Error(`${p} is not the file the update wrote; left in place`);
  } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  let st = null;
  try { st = fsOps.lstat(aside, BIG); } catch { st = null; }
  // `shared`: only a second name of a file that still has another one.
  let disposable = Boolean(st) && idOfStat(st) === id && (!sole || st.nlink === 1n) && (!shared || st.nlink >= 2n);
  if (disposable && expect) {
    let x = null;
    try { x = readById(aside, id); } catch { x = null; }
    disposable = Boolean(x) && sha(x) === expect;
  }
  // The permissions too, under the private name: a mode changed through an
  // open file up to this instant is someone's work, and the file is kept.
  if (disposable && mode !== null) disposable = (Number(st.mode) & 0o7777) === mode;
  // And its owner: a chown made through the update is kept the same way.
  if (disposable && owner) disposable = sameOwner(st, owner);
  if (disposable) {
    // A failed unlink leaves the file under its private name: say where.
    try { fsOps.rm(aside); } catch (e) { e.message += `; ${p} is kept at ${aside}`; e.keptAt = aside; throw e; }
    return;
  }
  // A folder that replaced the file in the last instant cannot be linked
  // or copied back: it is renamed back, only while its name is still free
  // and the folders on the way are still the pinned ones.
  if (st?.isDirectory()) {
    let free = false;
    try { fsOps.lstat(p); } catch (e) { free = e.code === 'ENOENT'; }
    try {
      if (!free) throw new Error('taken');
      check?.();
      renameSync(aside, p);
    } catch {
      throw Object.assign(new Error(`${p} is not the file the update wrote; it is kept at ${aside}`), { keptAt: aside });
    }
    throw new Error(`${p} is not the file the update wrote; left in place`);
  }
  // Put back without overwriting anything: by link where the filesystem
  // has them, else as an exclusive copy. A copy is a snapshot (an editor
  // may still hold the file itself), so the file is then kept aside too.
  // Pinned right before the put-back and checked right after: through a
  // folder swapped in between, the name would land somewhere else, and is
  // then removed again when provably the same file (or the copy just made).
  const theirs = idOf(aside);
  let how;
  const copied = {};
  try { check?.(); how = placeNoClobber(aside, p, check, theirs, copied); } catch {
    throw Object.assign(new Error(`${p} is not the file the update wrote; it is kept at ${aside}`), { keptAt: aside });
  }
  try { check?.(); } catch {
    const now = idOf(p);
    if (now !== null && now === (how === 'copy' ? copied.id : idOf(aside))) { try { rmIfOurs(p, now); } catch { /* named below */ } }
    throw Object.assign(new Error(`${p} is not the file the update wrote, and a folder on the way changed while it was put back; it is kept at ${aside}`), { keptAt: aside });
  }
  // The name must now be the very file put back (or the copy just made): a
  // folder swapped for a link and restored around the link passes the pins
  // while the name landed outside. Then the private name is all that is
  // left inside, and it stays.
  if (idOf(p) !== (how === 'copy' ? copied.id : theirs)) {
    throw Object.assign(new Error(`${p} is not the file the update wrote, and it could not be put back at its name; it is kept at ${aside}`), { keptAt: aside });
  }
  if (how === 'copy') {
    throw Object.assign(new Error(`${p} is not the file the update wrote; it was put back as a copy, the file itself is kept at ${aside}`), { keptAt: aside });
  }
  // The private name goes only as the very file just put back: one that
  // replaced it in the meantime is someone's and stays.
  try { rmIfOurs(aside, theirs, check); } catch {
    throw Object.assign(new Error(`${p} is not the file the update wrote; it is back, and also kept at ${aside}`), { keptAt: aside });
  }
  throw new Error(`${p} is not the file the update wrote; left in place`);
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
    try { st = lstatSync(p, BIG); } catch { return null; }
    if (!st.isDirectory()) return null;
    ids.push(idOfStat(st));
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
  // No real skill folder, no planning reads: through a folder swapped for a
  // link every lookup below would read outside the install.
  const refused = (why) => ({ ...install, actions: [{ op: 'unsafe', rel: '.', why }], blocked: true, want, root: null });
  if (!root) return refused('the skill folder is no longer a real folder');
  const isKnown = (rel, hash) => (known[`${skill}/${rel}`] || []).includes(hash);
  // A checkout with core.autocrlf turns LF into CRLF; that is the same
  // shipped file, so match it with line endings normalised too.
  const isKnownFile = (rel, buf) => isKnown(rel, sha(buf)) || isKnown(rel, sha(buf.toString('utf8').replace(/\r\n/g, '\n')));
  const actions = [];

  for (const [rel, buf] of Object.entries(want)) {
    const at = inspectPath(dir, rel);
    if (at.state === 'unsafe') { actions.push({ op: 'unsafe', rel, why: at.why }); continue; }
    if (at.state === 'missing') { actions.push({ op: 'add', rel }); continue; }
    testHooks.beforePlanRead?.(join(dir, rel));
    const cur = readNoFollow(join(dir, rel));
    if (!cur) { actions.push({ op: 'unsafe', rel, why: 'it changed into something other than a regular file while it was read' }); continue; }
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
    testHooks.beforePlanRead?.(join(dir, rel));
    const read = readNoFollowStat(join(dir, rel));
    const cur = read?.data ?? null;
    if (!cur) { actions.push({ op: 'unsafe', rel, why: 'it changed into something other than a regular file while it was read' }); continue; }
    const curHash = sha(cur);
    // An edited file this release no longer ships needs the user too: the
    // skill stays unchanged unless --force, which keeps the file (never
    // deleting an edit) and updates the rest.
    // Its permissions are recorded with its bytes: a mode changed after the
    // plan is someone's work, and the update stops rather than delete it.
    if (isKnownFile(rel, cur)) actions.push({ op: 'remove', rel, hash: curHash, mode: read.mode, owner: read.owner });
    else actions.push(force
      ? { op: 'keep', rel, why: 'changed after install, no longer shipped; kept as you left it' }
      : { op: 'conflict', rel, why: 'changed after install, no longer shipped; --force keeps it and updates the rest' });
  }

  const blocked = actions.some((a) => a.op === 'conflict' || a.op === 'unsafe');
  // Still the same folder after every read: a swap during planning is not
  // planned on.
  if (rootIdentity(dir) !== root) return refused('the skill folder changed while the update was planned');
  return { ...install, actions, blocked, want, root };
}

// Creates the folders of `relDir` below `root` one level at a time, never
// through a link: an existing level must be a real folder, a missing one is
// created on its own (not recursively). Returns the first folder it made.
// `onMade(p)` runs for each folder as soon as it exists, so a later level
// that fails still leaves the earlier ones registered for the rollback.
function mkdirNoFollow(root, relDir, onMade) {
  if (relDir === '.' || relDir === '') return undefined;
  let p = root;
  let first;
  // Every level already passed, by identity: each is checked again right
  // before a folder is made under it, so a level swapped for a link after
  // its look is refused rather than written through. (Node has no
  // mkdirat(), so a swap in the last instant is detected afterwards by the
  // caller's recheck, not prevented.)
  const pins = [[root, idOf(root)]];
  const still = () => pins.every(([q, id]) => {
    try { const st = lstatSync(q, BIG); return !st.isSymbolicLink() && st.isDirectory() && idOfStat(st) === id; } catch { return false; }
  });
  for (const part of relDir.split(/[\\/]/)) {
    p = join(p, part);
    let st = null;
    try { st = lstatSync(p, BIG); } catch (err) { if (err.code !== 'ENOENT') throw err; }
    if (st) {
      if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(`${posix(relative(root, p))} is not a real folder; nothing was changed, run update again`);
      pins.push([p, idOfStat(st)]);
      continue;
    }
    testHooks.afterLook?.(p);
    if (!still()) throw new Error(`a folder on the way to ${posix(relative(root, p))} changed; nothing was changed, run update again`);
    // Made and handed over inside the very parent that was pinned: the
    // working directory stays bound to it whatever happens to the path, so
    // a folder on the way swapped for a link after the check above can
    // neither receive the new folder nor have an outside one given an owner.
    const back = process.cwd();
    process.chdir(dirname(p));
    let id;
    try {
      if (idOfStat(lstatSync('.', BIG)) !== pins[pins.length - 1][1]) {
        throw new Error(`a folder on the way to ${posix(relative(root, p))} changed; nothing was changed, run update again`);
      }
      mkdirSync(part);
      testHooks.afterMkdir?.(p);
      onMade?.(p, part);
      id = idOfStat(lstatSync(part, BIG));
    } finally { try { process.chdir(back); } catch { /* the caller's folder is gone; nothing of ours depends on it */ } }
    pins.push([p, id]);
    first = first || p;
  }
  return first;
}

// Filesystem calls applyPlan uses for no-clobber placement; a test swaps
// `link` to act like a filesystem without hard links.
// `open` is the one way a file is opened for reading: never through a link
// at its own name.
export const fsOps = { lstat: lstatSync, link: linkSync, copyFile: copyFileSync, rm: rmSync, write: writeFileSync, fchown: fchownSync, open: (p) => openSync(p, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0)) };

// Puts a copy of `from` at `to` without overwriting anything there, and
// leaves `from` for the caller to remove once it has recorded the placement:
// a failure after placing must still be undone. link() does that
// atomically; on a filesystem without hard links (exFAT, some network
// mounts) it falls back to an exclusive copy: COPYFILE_EXCL creates `to`
// with O_EXCL, so a file or link that appears there at any moment is
// refused, never replaced. A check followed by rename() would overwrite
// whatever appeared in between.
// `out.id`, when `out` is given, is set to the identity of a copy: the only
// proof afterwards that a file at `to` is the one this call created.
// The errors a filesystem without hard links answers link() with. Windows
// exFAT reports EISDIR (nodejs/node#65817).
const NO_HARD_LINKS = ['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EMLINK', 'ENOSYS', 'EXDEV', 'EISDIR'];

export function placeNoClobber(from, to, check, fromId, out) {
  try {
    fsOps.link(from, to);
    return 'link';
  } catch (err) {
    if (err.code === 'EEXIST') throw err;
    if (!NO_HARD_LINKS.includes(err.code)) throw err;
    const id = copyExclusive(from, to, check, fromId);
    if (out) out.id = id;
    return 'copy';
  }
}

// Copies `from` to a new file `to`, created exclusively (O_EXCL, so nothing
// already there is ever replaced) and identified before any byte goes in. A
// copy that fails halfway (disk full, I/O) leaves a partial file only this
// call can prove is its own, so it is removed here, by identity and after
// `check`, before the error reaches the caller. Returns the copy's identity.
function copyExclusive(from, to, check, fromId) {
  // The folders are checked before anything is read or created, not only
  // when a partial copy has to be cleaned up.
  check?.();
  // The source is opened without following a link at its name, and only
  // the very file expected (`fromId`, when given) is copied: a link or a
  // replacement swapped in is refused, never read through.
  let fd;
  try { fd = fsOps.open(from); } catch (e) {
    if (e.code === 'ELOOP' || e.code === 'EMLINK') throw new Error(`${from} is no longer a regular file; nothing was copied`);
    throw e;
  }
  let data;
  let mode;
  let owner;
  try {
    const st = fstatSync(fd, BIG);
    if (!st.isFile() || (fromId && idOfStat(st) !== fromId) || !stillAtName(from, st)) throw new Error(`${from} changed before it was copied; nothing was copied`);
    mode = Number(st.mode) & 0o7777;
    owner = { uid: Number(st.uid), gid: Number(st.gid) };
    data = readFileSync(fd);
  } finally { closeSync(fd); }
  let id = null;
  try {
    writeOwnFile(to, data, mode, (made) => { id = made; }, owner);
  } catch (e) {
    if (id) {
      try { rmIfOurs(to, id, check); } catch (e2) { e.message += `; the partial copy is kept: ${e2.message}`; }
    }
    throw e;
  }
  return id;
}

// Applies a plan as one transaction. New content is written to temporary
// files next to the targets first. Then every file that will be replaced or
// removed is moved aside before its new version is renamed in. If any step
// fails, everything done so far is undone (new files out, originals back),
// so the skill never holds files from two releases. rename() replaces a
// path, it never follows a link at the destination.
// `failAt` is a test hook: throw just before the n-th rename, after calling
// `beforeFail` (which lets a test act like a concurrent writer).
export function applyPlan(plan, { failAt, beforeFail, beforeMkdir, beforePin, beforeStageCheck, beforeStage, beforeAside, beforeStageRm, beforePlacedCheck, beforeCommit, beforeCleanup, beforeBackup } = {}) {
  if (plan.blocked) return { ...plan, applied: false };
  const { dir, actions, want } = plan;
  // Unique to this run: two runs in the same millisecond (or a reused pid)
  // never share a name, so a kept `.old` from one is never another's target.
  const tag = `dybs-${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`;
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
  // Every removal re-checks, inside it and right before its move, that the
  // folders on the way are still the pinned ones: nothing is ever moved or
  // deleted through a folder swapped for a link, rollback included.
  const chainCheck = (s) => () => {
    if (chainOf(dir, s.a.rel) !== s.chain) throw new Error(`a folder on the way to ${s.a.rel} changed; nothing was removed through it`);
  };
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
  // The staged file carries the original's permissions as seen when it was
  // written: one tightened since (0644 to 0600) must not be undone, so the
  // very original, moved aside, is asked again before placing and again at
  // the commit point.
  const modeUnchanged = (s) => {
    if (s.mode === undefined || !(s.orig || s.old)) return;
    const src = s.orig ?? s.old;
    const srcId = s.orig ? s.origId : s.oldId;
    let now = null;
    // Only an original that is provably gone has no permissions to keep; a
    // lookup that fails otherwise (EIO, ESTALE) is no answer, so it stops.
    // Another file at the private name is no answer either: the original
    // may still be held open somewhere and its permissions changed there.
    let st = null;
    try { st = fsOps.lstat(src, BIG); } catch (e) {
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw new Error(`the permissions of ${s.a.rel} could not be checked (${e.code || e.message}); nothing was changed, run update again`);
    }
    if (st && idOfStat(st) !== srcId) throw new Error(`the original of ${s.a.rel} was replaced during the update; nothing was changed, run update again`);
    if (st) now = Number(st.mode) & 0o7777;
    if (now !== null && now !== s.mode) throw new Error(`${s.a.rel} had its permissions changed during the update; nothing was changed, run update again`);
    // Its owner likewise: a chown made meanwhile is someone's work too.
    if (now !== null && s.owner && !sameOwner(st, s.owner)) throw new Error(`${s.a.rel} had its owner changed during the update; nothing was changed, run update again`);
  };
  // At cleanup too: an original whose permissions changed after the commit
  // point (through an open file) is someone's work, kept like an edit.
  const sameMode = (s, p, id) => {
    if (s.mode === undefined) return true;
    try { const st = fsOps.lstat(p, BIG); return idOfStat(st) === id && (Number(st.mode) & 0o7777) === s.mode && (!s.owner || sameOwner(st, s.owner)); } catch { return false; }
  };
  const pinned = (s) => {
    beforePin?.(s);
    if (!s.chain || !sameRoot(dir, plan.root) || chainOf(dir, s.a.rel) !== s.chain) {
      throw new Error(`a folder on the way to ${s.a.rel} changed during the update; nothing was kept, run update again`);
    }
  };
  try {
    for (const a of actions) if (['add', 'update', 'replace', 'remove'].includes(a.op)) recheck(a);
    // A file the plan found current is pinned too: its identity and the
    // folders on its way, checked again around its last read.
    const sameAt = new Map();
    for (const a of actions) {
      if (a.op !== 'same') continue;
      recheck(a);
      sameAt.set(a.rel, { id: idOf(join(dir, a.rel)), chain: chainOf(dir, a.rel) });
    }
    for (const a of actions) {
      if (!['add', 'update', 'replace', 'remove'].includes(a.op)) continue;
      const p = join(dir, a.rel);
      // A file to remove keeps its permissions on record too: one changed
      // while it is moved aside is someone's work, kept at cleanup.
      if (a.op === 'remove') {
        // A lookup that fails (EIO, EACCES) leaves no record to guard the
        // file with, so the update stops; only a file provably gone has none.
        // Read between two pins of the folders on the way, and tied to the
        // file it was read from: a folder swapped for a link during the
        // lookup would record another file's permissions, so the update
        // stops, and the file moved aside later must be this very file.
        const chain = chainOf(dir, a.rel);
        let mode;
        let modeId;
        let owner;
        try { const st = fsOps.lstat(p, BIG); mode = Number(st.mode) & 0o7777; modeId = idOfStat(st); owner = ownerOf(st); } catch (e) {
          if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw new Error(`the permissions of ${a.rel} could not be checked (${e.code || e.message}); nothing was changed, run update again`);
          mode = undefined;
        }
        if (!chain || chainOf(dir, a.rel) !== chain) throw new Error(`a folder on the way to ${a.rel} changed during the update; nothing was changed, run update again`);
        if (mode !== undefined && a.mode !== undefined && mode !== a.mode) throw new Error(`${a.rel} had its permissions changed since the update was planned; nothing was changed, run update again`);
        if (owner && a.owner && (owner.uid !== a.owner.uid || owner.gid !== a.owner.gid)) throw new Error(`${a.rel} had its owner changed since the update was planned; nothing was changed, run update again`);
        staged.push({ a, p, chain, mode, modeId, owner });
        continue;
      }
      beforeMkdir?.();
      let made = null;
      let deepest = null;
      let stopId = null;
      try {
        // A new folder belongs to the skill folder's owner, as new files do:
        // run as another user, the owner could not rename or add files in it.
        const folderOwner = ownerOf(fsOps.lstat(dir, BIG));
        mkdirNoFollow(dir, dirname(a.rel), (d, name) => {
          if (!made) { made = d; stopId = idOfStat(lstatSync('.', BIG)); }
          deepest = d;
          ownFolder(name, folderOwner);
        });
      } finally {
        if (made) createdDirs.push({ deepest, stop: dirname(made), stopId });
      }
      recheck(a);
      beforeStage?.(a);
      // Pin the folders first, then write, then prove the file is where we
      // meant it: a folder swapped for a link and back again around the
      // write would leave the chain looking unchanged, but our file missing.
      // No valid pin, no write: a folder that is already a link is never
      // written through.
      const chain = chainOf(dir, a.rel);
      if (!chain) throw new Error(`a folder on the way to ${a.rel} is not a real folder; nothing was kept, run update again`);
      const tmp = `${p}.${tag}.new`;
      // A replaced file keeps its permissions: a 0600 file stays 0600.
      const was = a.op === 'add' ? null : fsOps.lstat(p);
      const mode = was ? was.mode & 0o7777 : undefined;
      // And its owner: run as another user, the replacement is still theirs,
      // and a new file belongs to whoever owns the skill folder.
      const from = was ?? fsOps.lstat(dir);
      const owner = { uid: from.uid, gid: from.gid };
      // Registered as soon as it exists, before any write that can fail
      // (disk full, quota), so the rollback always knows to remove it.
      const entry = { a, p, tmp, chain, mode, owner: was ? owner : undefined };
      writeOwnFile(tmp, want[a.rel], mode, (id) => { entry.tmpId = id; staged.push(entry); }, owner);
      beforeStageCheck?.(entry);
      if (!chain || chainOf(dir, a.rel) !== chain || idOf(tmp) !== entry.tmpId) {
        // Written through a folder swapped in before the open, the staging
        // file is outside the install, where the rollback (which needs the
        // pinned folders) cannot reach it. This run created it, so it is
        // removed by that identity at once, while it has no other name.
        const err = new Error(`a folder on the way to ${a.rel} changed while the update was writing; nothing was kept, run update again`);
        // Node has no openat(): a folder swapped and already restored leaves
        // the file where it went, out of reach by name. It is then named, so
        // the human can remove it.
        try {
          rmIfOurs(tmp, entry.tmpId, null, { sole: true });
          if (idOf(tmp) === null && chainOf(dir, a.rel) === chain) err.message += ` (a stray ${basename(tmp)} may have been written outside the install through a folder swapped meanwhile)`;
        } catch (e) { err.message += ` (a stray ${basename(tmp)} may have been written through it: ${e.message})`; }
        throw err;
      }
      if (a.op === 'replace') {
        // The backup is written the same way: created exclusively, tracked
        // before its bytes go in, and proven to be where we meant it.
        // Read without following a link at the name: a file swapped for a
        // link since the plan is refused, never copied from where it points.
        // The folders are re-pinned right before the read and again before
        // the write, so neither goes through a folder swapped since.
        const b = backupPath(p);
        const swapped = () => new Error(`a folder on the way to ${a.rel} changed while the update was writing; nothing was kept, run update again`);
        beforeBackup?.('read', entry);
        if (chainOf(dir, a.rel) !== chain) throw swapped();
        const orig = readNoFollowStat(p);
        if (!orig) throw new Error(`${a.rel} is no longer a regular file; nothing was changed, run update again`);
        // Exactly the bytes the plan saw: through a folder swapped and
        // restored around the read, an outside file would be backed up while
        // the user's version is later deleted.
        if (sha(orig.data) !== a.hash) throw new Error(`${a.rel} changed since the update was planned; nothing was changed, run update again`);
        const bytes = orig.data;
        const backup = { path: b, hash: sha(bytes), mode: orig.mode, owner: orig.owner, entry };
        if (chainOf(dir, a.rel) !== chain) throw swapped();
        beforeBackup?.('write', entry);
        // The backup belongs to the edited file's owner: run as another user
        // (sudo), a 0600 backup would otherwise be unreadable to its user.
        writeOwnFile(b, bytes, orig.mode, (id) => { backup.id = id; backups.push(backup); }, orig.owner);
        if (chainOf(dir, a.rel) !== chain || idOf(b) !== backup.id) {
          // A swap in the last instant put the backup where `b` now leads.
          // It was created by this run (its identity comes from the open
          // file), so it is removed by that identity at once, without the
          // stale folder pins the rollback would require.
          const err = swapped();
          try {
            rmIfOurs(b, backup.id);
            // Through a folder swapped and already restored, the backup went
            // where no name we hold reaches (Node has no openat()): named.
            if (provablyGone(b) && chainOf(dir, a.rel) === chain) err.message += `; a backup ${basename(b)} holding your version may have been written outside the install through a folder swapped meanwhile`;
          } catch (e) { err.message += `; ${e.message}`; }
          throw err;
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
        const old = `${s.p}.${tag}.old`;
        // Moved aside without ever replacing what is at the new name:
        // rename() would silently overwrite a file that appeared there. A
        // link refuses one (EEXIST); then the original name is dropped only
        // while it is still the same file.
        try {
          pinned(s);
          // The identity planned is taken before the link. The new name is
          // ours only while it is the very file it was linked from (one file
          // under both names, as seen now); a file that replaced it since is
          // never adopted or removed.
          const linkedId = idOf(s.p);
          if (s.modeId !== undefined && linkedId !== s.modeId) throw new Error(`${s.a.rel} changed since its permissions were recorded; nothing was changed, run update again`);
          fsOps.link(s.p, old);
          const dropOld = (check) => {
            const now = idOf(old);
            // The link succeeded, so a name that is not here now was made in
            // a folder swapped in for the call and since put back: it cannot
            // be reached to remove, so it is named.
            if (now === null) return provablyGone(old) ? ` (a second name for ${s.a.rel}, ${basename(old)}, may have been created in a folder swapped in during the update; it could not be reached to remove it)` : ` (${old} could not be checked and may be left in place)`;
            if (now !== idOf(s.p)) return ` (${old} is not provably this update's and was left in place)`;
            try { rmIfOurs(old, now, check); return ''; } catch (e) { return ` (${e.message})`; }
          };
          // A folder swapped in the instant of the link would put the new
          // name outside the install: the name this run just created there
          // is removed again (it is only a second name, the file itself is
          // untouched) and the update stops.
          if (chainOf(dir, s.a.rel) !== s.chain) {
            const note = dropOld();
            throw new Error(`a folder on the way to ${s.a.rel} changed during the update; nothing was changed, run update again${note}`);
          }
          if (!isRegular(old) || idOf(old) !== linkedId) {
            const note = dropOld(chainCheck(s));
            throw new Error(`${s.a.rel} changed since the update was planned (it is no longer a regular file); nothing was changed, run update again${note}`);
          }
          s.old = old;
          s.oldId = linkedId;
          done.push(s);
          // Only while the name just made still holds it too: a second
          // name removed by someone meanwhile leaves this as the last one.
          rmIfOurs(s.p, s.oldId, () => pinned(s), { shared: true });
        } catch (err) {
          if (err.code === 'EEXIST') throw new Error(`something appeared at ${basename(old)} during the update; nothing was changed, run update again`);
          if (s.old || !NO_HARD_LINKS.includes(err.code)) throw err;
          // No hard links here: an exclusive copy (COPYFILE_EXCL never
          // replaces anything), then the original name is moved to a name
          // only this run knows and dropped only while it is the same file
          // with the same bytes as the copy. No rename ever targets a name
          // someone else could use.
          const origId = idOf(s.p);
          if (!isRegular(s.p)) throw new Error(`${s.a.rel} changed since the update was planned (it is no longer a regular file); nothing was changed, run update again`);
          if (s.modeId !== undefined && origId !== s.modeId) throw new Error(`${s.a.rel} changed since its permissions were recorded; nothing was changed, run update again`);
          // The copy's identity is recorded the moment it exists (from the
          // open descriptor), never read again later: a file that replaced
          // it meanwhile is not ours. A copy that fails halfway is removed.
          let copyId;
          try {
            copyId = copyExclusive(s.p, old, chainCheck(s), origId);
          } catch (e) {
            if (e.code === 'EEXIST') throw new Error(`something appeared at ${basename(old)} during the update; nothing was changed, run update again`);
            throw e;
          }
          s.old = old;
          s.oldId = copyId;
          done.push(s);
          beforeAside?.(s);
          // Re-pinned right before the move: through a folder swapped for a
          // link, the rename would take someone else's file off its name.
          pinned(s);
          // A file saved over the original since the copy is never moved:
          // the update stops while it is still at its own name.
          if (idOf(s.p) !== origId || !isRegular(s.p)) throw new Error(`${s.a.rel} changed while it was being moved aside; nothing was changed, run update again`);
          const aside = `${s.p}.${randomUUID()}.rm`;
          // Inside the very folder checked (renameInFolder), and only as the
          // original itself: through a folder swapped for a link it moves nothing.
          testHooks.beforeMove?.(s.p);
          if (!renameInFolder(s.p, aside, origId)) throw new Error(`${s.a.rel} changed while it was being moved aside; nothing was changed, run update again`);
          let same = false;
          try { const x = readById(aside, origId); const y = readById(old, s.oldId); same = Boolean(x && y) && sha(x) === sha(y); } catch { same = false; }
          if (!same) {
            // Changed in the last instant: put back at its own name without
            // ever replacing a file saved there meanwhile (an exclusive copy,
            // as there are no hard links here), and the file itself is kept.
            testHooks.beforePutBack?.(s.p);
            let back = false;
            try { chainCheck(s)(); placeNoClobber(aside, s.p, chainCheck(s), origId, {}); back = true; } catch { back = false; }
            throw new Error(back
              ? `${s.a.rel} changed while it was being moved aside; it is back at its own name as a copy, and the file itself is kept at ${aside}; run update again`
              : `${s.a.rel} changed while it was being moved aside; your version is kept at ${aside}`);
          }
          // Kept, not deleted, until the update is committed: an editor
          // that still holds the original open writes into this very file,
          // and the cleanup (or the rollback) then finds the edit and keeps
          // it, as the moved-aside link does where there are hard links.
          s.orig = aside;
          s.origId = origId;
        }
        pinned(s);
        // Checked against the identity recorded at creation, not re-read:
        // a replacement of the moved-aside file is never adopted as ours.
        const oldBytes = readById(s.old, s.oldId);
        if (!oldBytes) throw new Error(`${s.a.rel} is not where it was moved aside; run update again`);
        if (sha(oldBytes) !== s.a.hash) throw new Error(`${s.a.rel} changed since the update was planned; nothing was changed, run update again`);
      }
      if (s.tmp) {
        tick();
        pinned(s);
        // The staged file must still hold exactly the bytes we wrote: one
        // edited in place keeps its identity and its folders, so only its
        // content can tell. A link places this very file, so it is checked
        // here, right before.
        // The very file staged, by identity, not just the same bytes: a
        // replacement with the shipped content would otherwise be linked
        // into place under an identity the rollback does not know.
        let staged = null;
        try { staged = readById(s.tmp, s.tmpId); } catch { staged = null; }
        if (!staged || sha(staged) !== sha(want[s.a.rel])) {
          throw new Error(`the staged copy of ${s.a.rel} changed before it was installed; nothing was kept, run update again`);
        }
        modeUnchanged(s);
        let how;
        const copied = {};
        try {
          // Copied from a descriptor checked to be the staged file, never
          // linked: link() takes whatever the staging name holds at that
          // instant, and a replacement linked in is not provably ours to
          // remove, so neither the rollback nor the original could come back.
          copied.id = copyExclusive(s.tmp, s.p, chainCheck(s), s.tmpId);
          how = 'copy';
          testHooks.afterPlace?.(s);
        } catch (err) {
          if (err.code === 'EEXIST') throw new Error(`${s.a.rel} appeared since the update was planned; nothing was changed, run update again`);
          throw err;
        }
        // The identity actually placed, read at once: a link places whatever
        // the staging name held at that instant. A replacement linked in is
        // not ours, so the name we just created for it is removed (by that
        // identity) and the update stops; the original is then put back.
        const placedNow = idOf(s.p);
        // Only a file provably created by this placement is ever removed: a
        // copy by the identity the copy was created with, a link only while
        // the staging name still holds the very same file (the link made the
        // two names one). A file that replaced the new name after it was
        // created matches neither, and is left where it is, named.
        const oursNow = () => placedNow !== null && placedNow === (how === 'copy' ? copied.id : idOf(s.tmp));
        const dropOurs = (check) => {
          if (!oursNow()) return ` (${s.p} is not provably this update's file and was left in place)`;
          try { rmIfOurs(s.p, placedNow, check); return ''; } catch (e) { return ` (${e.message})`; }
        };
        // A folder swapped during the placement put the new name outside the
        // install: it is removed only if it is provably ours, without
        // requiring the changed folders, and the update stops.
        if (chainOf(dir, s.a.rel) !== s.chain) {
          const note = dropOurs();
          throw new Error(`a folder on the way to ${s.a.rel} changed while it was being installed; nothing was kept, run update again${note}`);
        }
        if (placedNow !== (how === 'copy' ? copied.id : s.tmpId)) {
          const note = dropOurs(chainCheck(s));
          throw new Error(`the staged copy of ${s.a.rel} changed while it was being installed; nothing was kept, run update again${note}`);
        }
        s.placed = true;
        s.placedId = placedNow;
        // Its permissions as placed: a rollback removes it only while they
        // still hold, so a mode changed on the new file is kept like an edit.
        // Read between pins of the folders on the way and only from the very
        // file placed: through a folder swapped for a link during the lookup
        // it would be another file's mode, so the update stops instead.
        s.placedMode = null;
        let placedSt = null;
        testHooks.beforePlacedMode?.(s);
        try { placedSt = fsOps.lstat(s.p, BIG); } catch { placedSt = null; }
        if (!placedSt || chainOf(dir, s.a.rel) !== s.chain || idOfStat(placedSt) !== s.placedId) {
          throw new Error(`a folder on the way to ${s.a.rel} changed while it was being installed; nothing was kept, run update again`);
        }
        s.placedMode = Number(placedSt.mode) & 0o7777;
        s.placedOwner = ownerOf(placedSt);
        if (s.a.op === 'add') done.push(s);
        pinned(s);
        // The staging name is removed only while it still leads, through
        // the pinned folders, to the file we staged: a same-named file
        // reached through a swapped folder is never ours to delete.
        beforeStageRm?.(s);
        if (chainOf(dir, s.a.rel) !== s.chain || idOf(s.tmp) !== s.tmpId) {
          throw new Error(`a folder on the way to ${s.a.rel} changed during the update; nothing was kept, run update again`);
        }
        // Removed by identity under a private name, the folders re-checked
        // right before: a file that replaced the staging name is kept.
        rmIfOurs(s.tmp, s.tmpId, () => pinned(s));
        // Until that unlink, a link placement left two names for one file, and
        // a write through the staging name would land in the target. So the
        // target is read once more now that it is the only name.
        beforePlacedCheck?.(s);
        // Read through the pinned folders, and only the very file placed: a
        // folder swapped for a link could show an outside file with the
        // same shipped bytes.
        pinned(s);
        let placedBytes = null;
        try { placedBytes = readById(s.p, s.placedId); } catch { placedBytes = null; }
        if (!placedBytes || sha(placedBytes) !== sha(want[s.a.rel])) {
          throw new Error(`${s.a.rel} changed while it was being placed; nothing was kept, run update again`);
        }
      }
    }
    // A --force backup holds the user's own version: it must still hold
    // exactly that before the originals are let go. Edited in place (same
    // identity), it is someone's work now, so nothing is committed.
    beforeCommit?.();
    // The commit point: the skill folder and every folder chain must still be
    // the pinned ones. When every file was added or replaced there is no
    // unchanged file below whose recheck would notice a swapped folder.
    // Permissions too: a change made after placement (through an open file)
    // would otherwise be lost with the original at cleanup.
    for (const s of staged) { pinned(s); modeUnchanged(s); }
    // Files the plan found already current are part of the result too: one
    // edited, removed or swapped for a link since would leave the skill
    // mixed, so it stops the update like any other change.
    // A removed file's name must still be free: a file that appeared there
    // since would keep acting as part of the skill while the update says
    // it was removed.
    for (const a of actions) {
      if (a.op !== 'remove') continue;
      // Free only when provably absent: a lookup that fails otherwise (EIO,
      // ESTALE) may hide a file that came back.
      if (!provablyGone(join(dir, a.rel))) throw new Error(`${a.rel} appeared again while it was being removed, or could not be checked; nothing was kept, run update again`);
    }
    for (const a of actions) {
      if (a.op !== 'same') continue;
      recheck(a);
      // Read only the very file pinned, and only while the folders on its
      // way are the pinned ones before and after the read: O_NOFOLLOW
      // guards the name itself, not a folder swapped for a link around it.
      const pin = sameAt.get(a.rel);
      let current = false;
      try {
        if (pin.chain && chainOf(dir, a.rel) === pin.chain) {
          const x = readById(join(dir, a.rel), pin.id);
          current = Boolean(x) && sha(x) === sha(want[a.rel]) && chainOf(dir, a.rel) === pin.chain;
        }
      } catch { current = false; }
      if (!current) throw new Error(`${a.rel} changed since the update was planned; nothing was kept, run update again`);
    }
    for (const b of backups) {
      let same = false;
      try { const x = readById(b.path, b.id); same = Boolean(x) && sha(x) === b.hash; } catch { same = false; }
      if (!same) throw new Error(`the backup ${basename(b.path)} changed during the update; nothing was kept, run update again`);
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
          const x = chainOf(dir, s.a.rel) === s.chain ? readById(s.p, s.placedId) : null;
          const now = fsOps.lstat(s.p, BIG);
          ours = Boolean(x) && sha(x) === sha(want[s.a.rel]) && s.placedMode !== null && (Number(now.mode) & 0o7777) === s.placedMode && sameOwner(now, s.placedOwner);
        } catch { ours = false; }
        if (!ours) {
          // Without hard links the original itself is `s.orig` (an edit
          // through an open file lands there); `s.old` is only a snapshot.
          const where = s.orig ? `, the original is at ${s.orig}${s.old ? ` (a snapshot copy is at ${s.old})` : ''}` : (s.old ? `, the original is at ${s.old}` : '');
          stuck.push(`${s.a.rel} changed after the update wrote it; kept as is${where}`);
          continue;
        }
        testHooks.beforeUndoRm?.(s);
        // Removed only as the very file checked above (verify-then-delete
        // under a private name): a file that replaced it meanwhile stays.
        // The folders are re-checked inside the removal, right before its
        // move: a swap after the check above is never acted through.
        undo(s.a.rel, () => rmIfOurs(s.p, s.placedId, () => {
          if (chainOf(dir, s.a.rel) !== s.chain) throw new Error('a folder on the way changed; the file the update wrote was kept');
        }, { expect: sha(want[s.a.rel]), mode: s.placedMode, owner: s.placedOwner ?? null }));
      }
      // Put the original back without overwriting anything that appeared,
      // and only while the name still leads, through the pinned folders, to
      // the very file we moved aside: a folder swapped for a link could show
      // an outside file under the same name, which is never ours to move.
      // Whether a copy of the original is back at its name: until then the
      // original itself (`s.orig`) is the only one, and is never removed.
      let restored = false;
      let restoredHow = null;
      if (s.old) {
        undo(s.a.rel, () => {
          if (chainOf(dir, s.a.rel) !== s.chain || idOf(s.old) !== s.oldId) {
            throw new Error(`a folder on the way changed; the original was not put back, it is at ${s.old}`);
          }
          // A link puts the very file back, so the moved-aside name can go.
          // A copy is a snapshot: an editor still holding the original could
          // write to it after the copy, so the original itself is kept.
          // Re-pinned right before, and checked again right after: a folder
          // swapped in between put the new name outside the install, so it
          // is removed again when provably ours (a link to the very original,
          // or the copy just made), never anything else.
          const copied = {};
          const check = chainCheck(s);
          check();
          const how = placeNoClobber(s.old, s.p, check, s.oldId, copied);
          // What was placed, checked at once: a link places whatever the
          // moved-aside name held at that instant, which must be the very
          // original. A name placed wrongly is removed only when provably
          // ours (the same file as its source, or the copy just made).
          const now = idOf(s.p);
          const swapped = chainOf(dir, s.a.rel) !== s.chain;
          if (swapped || (how === 'link' && now !== s.oldId)) {
            let note = `${s.p} is not provably this update's file and was left in place`;
            if (now !== null && now === (how === 'copy' ? copied.id : idOf(s.old))) {
              try { rmIfOurs(s.p, now); note = 'the name placed there was removed again'; } catch (e) { note = e.message; }
            }
            throw new Error(swapped
              ? `a folder on the way changed while the original was put back (${note}); the original is at ${s.old}`
              : `the moved-aside original was replaced before it was put back (${note}); it is not at ${s.old} any more`);
          }
          restored = true;
          restoredHow = how;
          // A link put the very file back, so the private name goes, but
          // only while the file still has another name (`shared`): one whose
          // restored name was removed meanwhile is kept, never unlinked last.
          // (A removal in the instant after that check is the remover's own
          // deletion of the original, as it would be without an update.)
          if (how === 'link') rmIfOurs(s.old, s.oldId, chainCheck(s), { shared: true });
          // Without hard links `s.old` is only this run's snapshot, and the
          // original itself is `s.orig`, kept below: the snapshot goes.
          else if (s.orig) rmIfOurs(s.old, s.oldId, chainCheck(s), { expect: s.a.hash });
          else throw new Error(`the original was put back as a copy; the file itself is kept at ${s.old}`);
        });
      }
      // The original itself (no hard links): removed only while unchanged.
      // One edited through an open file since holds the newest version, so
      // it is kept and named.
      if (s.orig) {
        undo(s.a.rel, () => {
          let ours = false;
          try {
            const x = chainOf(dir, s.a.rel) === s.chain ? readById(s.orig, s.origId) : null;
            ours = Boolean(x) && sha(x) === s.a.hash;
          } catch { ours = false; }
          if (ours && !restored) throw new Error(`the original could not be put back at its name; it is kept at ${s.orig}`);
          // Put back as a copy, the name holds a snapshot: an editor still
          // holding the original writes to it, so it is kept and named.
          if (ours && restoredHow === 'copy') throw new Error(`the original was put back as a copy; the file itself is kept at ${s.orig}`);
          if (ours) rmIfOurs(s.orig, s.origId, chainCheck(s), { expect: s.a.hash, mode: s.mode ?? null, owner: s.owner ?? null });
          else if (!provablyGone(s.orig)) throw new Error(`the original changed during the update (an edit through an open file), or could not be read; that version is kept at ${s.orig}`);
        });
      }
    }
    // Remove only what is provably ours: the file at that name must be the
    // one we wrote, or a same-named file reached through a swapped link
    // would be deleted instead.
    for (const s of staged) if (s.tmp) undo(s.a.rel, () => rmIfOurs(s.tmp, s.tmpId, chainCheck(s)));
    // A backup edited in place keeps its identity, so its bytes are checked
    // too: a changed one is someone's work now and is kept.
    for (const b of backups) {
      undo(b.path, () => {
        let same = false;
        // Its permissions too: a backup whose mode changed is someone's now.
        // And its owner: a backup re-owned since is someone's too.
        try { const x = readById(b.path, b.id); const st = fsOps.lstat(b.path, BIG); same = Boolean(x) && sha(x) === b.hash && (Number(st.mode) & 0o7777) === b.mode && (!b.owner || sameOwner(st, b.owner)); } catch { same = false; }
        if (same) rmIfOurs(b.path, b.id, chainCheck(b.entry), { expect: b.hash, mode: b.mode, owner: b.owner ?? null });
        else if (idOf(b.path) !== null) throw new Error(`${b.path} changed during the update; kept`);
      });
    }
    for (const a of actions) delete a.backup;
    for (const d of createdDirs) undo(d.deepest, () => removeEmptyDirs(d.deepest, d.stop, d.stopId));
    if (stuck.length) err.message += `; could not undo everything, check by hand: ${stuck.join('; ')}`;
    throw err;
  }
  // Committed: the moved-aside originals are no longer needed, unless one
  // changed after its check (an editor still writing through an open file):
  // then it holds someone's edit, so it is kept and reported, never deleted.
  for (const s of staged) {
    if (s.old) {
      beforeCleanup?.(s);
      // Deleted only when provably ours: reached through the pinned folders,
      // the very file we moved aside, and still holding the planned bytes.
      // Anything less is kept and reported.
      const chainOk = chainOf(dir, s.a.rel) === s.chain;
      // Absent only when the lookup says so (ENOENT/ENOTDIR): any other
      // failure leaves the original in place, and it is reported as kept.
      let id = null;
      let gone = false;
      try { id = idOfStat(fsOps.lstat(s.old, BIG)); } catch (e) { gone = e.code === 'ENOENT' || e.code === 'ENOTDIR'; }
      // The update is committed by now: a cleanup that fails (a locked
      // file, a permission change, a file that cannot be read) leaves the
      // original in place and is reported, it never turns a finished update
      // into a failure. Only a name that is provably empty is "already gone".
      if (chainOk && id === s.oldId) {
        // Checked under a name only this run knows: the file is first moved
        // to it, so what is verified is exactly what gets deleted, even if
        // something new appears at the old name in between.
        const trash = `${s.old}.${randomUUID()}.rm`;
        let moved = false;
        // The folders are re-checked right before the move: a swap after the
        // check above is never acted through.
        testHooks.beforeTrash?.(s);
        try {
          if (chainOf(dir, s.a.rel) !== s.chain) throw new Error('a folder on the way changed');
          // Inside the very folder checked, and only as the moved-aside file.
          testHooks.beforeMove?.(s.old);
          moved = renameInFolder(s.old, trash, s.oldId);
          if (!moved) s.a.kept = s.old;
        } catch { s.a.kept = s.old; }
        if (moved) {
          let ours = false;
          try { const x = readById(trash, s.oldId); ours = Boolean(x) && sha(x) === s.a.hash && sameMode(s, trash, s.oldId); } catch { ours = false; }
          if (ours) {
            // Deleted by identity under yet another private name: a file
            // that replaced `trash` since the check is kept, never deleted.
            try { rmIfOurs(trash, s.oldId, chainCheck(s), { expect: s.a.hash, mode: s.mode ?? null, owner: s.owner ?? null }); } catch (e) { s.a.kept = e.keptAt ?? trash; }
          } else {
            // Not ours after all (edited, or replaced before the move): put
            // it back without overwriting anything, else report where it is.
            // The trash name goes only by identity: a file that replaced it
            // after the link is never ours to delete.
            // Pinned right before and checked right after the link: through
            // a swapped folder it would land outside the install, and that
            // name is removed again when it is provably the same file.
            const trashId = idOf(trash);
            let linked = false;
            try {
              chainCheck(s)();
              fsOps.link(trash, s.old);
              linked = true;
              if (chainOf(dir, s.a.rel) !== s.chain) {
                if (idOf(s.old) === trashId) { try { rmIfOurs(s.old, trashId); } catch { /* reported below */ } }
                throw new Error('a folder on the way changed');
              }
              // At its name, the very file: a folder swapped and restored
              // around the link passes the pins while the name went outside.
              if (idOf(s.old) !== trashId) throw new Error('not put back at its name');
              // The private name stays: no check before an unlink can prove
              // the put-back name still exists at the unlink itself, and
              // dropping the last name would lose the edit. Both are one file.
              s.a.kept = s.old;
              s.a.alsoAt = trash;
            } catch {
              s.a.kept = trash;
              // The link succeeded but is not here: it was made in a folder
              // swapped in for the call, which cannot be reached now.
              if (linked && provablyGone(s.old)) s.a.stray = `a second name, ${basename(s.old)}, may have been created in a folder swapped in during the update`;
            }
          }
        }
      } else if (chainOk && gone) { /* already gone */ } else s.a.kept = s.old;
    }
    if (s.orig) {
      // The original itself (no hard links): deleted only while it is the
      // very file moved aside, reached through the pinned folders, and still
      // holds the planned bytes. An edit made through an open file since is
      // kept and reported.
      let ours = false;
      try {
        const x = chainOf(dir, s.a.rel) === s.chain ? readById(s.orig, s.origId) : null;
        ours = Boolean(x) && sha(x) === s.a.hash && sameMode(s, s.orig, s.origId);
      } catch { ours = false; }
      if (ours) {
        try { rmIfOurs(s.orig, s.origId, chainCheck(s), { expect: s.a.hash, mode: s.mode ?? null, owner: s.owner ?? null }); } catch (e) { s.a.kept = e.keptAt ?? s.orig; }
      } else if (!provablyGone(s.orig)) s.a.kept = s.a.kept ? `${s.a.kept} (and ${s.orig})` : s.orig;
    }
    if (s.a.op === 'remove' && chainOf(dir, s.a.rel) === s.chain) {
      try { removeEmptyDirs(dirname(s.p), dir, s.chain.split('/')[0]); } catch { /* an empty folder left behind is harmless */ }
    }
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
  // Each install is its own transaction. When a later one fails, the ones
  // before it are already committed: the error says which, and carries their
  // results, so nothing changed goes unreported.
  const results = [];
  for (const i of installs) {
    try {
      results.push(updateInstall(i, opts));
    } catch (err) {
      const changed = results.filter((r) => r.applied && r.actions.some((a) => ['add', 'update', 'replace', 'remove'].includes(a.op)));
      if (changed.length) err.message += `; already updated before it stopped: ${changed.map((r) => `${r.skill} (${r.dir})`).join(', ')}`;
      err.completed = results;
      throw err;
    }
  }
  return {
    results,
    // A skill found but left alone is installed, just not updated here:
    // it is never also offered as missing, or a second install would follow.
    // A folder that was not treated as an install leaves its skill missing.
    notInstalled: skillNames().filter((s) => !installed.has(s) && !skipped.some((k) => k.skill === s && !k.notInstall)),
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

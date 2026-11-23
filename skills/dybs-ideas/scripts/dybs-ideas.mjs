#!/usr/bin/env node
// The facts behind dybs-ideas: which notes are new, whether every quoted
// mention is really in its source, and which notes have been read.
// The agent finds the ideas; this script keeps it honest and repeatable.
//
// Usage:
//   node dybs-ideas.mjs new    [project] [--folder <dir>] [--json]
//   node dybs-ideas.mjs verify [project] [--folder <dir>] [--json]
//   node dybs-ideas.mjs mark   [project] <file[@sha256]>... [--folder <dir>] [--json]
//
// The notes folder is --folder, else the one given last on this device, kept
// in dybs/ideas/.folder (never committed: the script lists it in
// dybs/ideas/.gitignore). The ledger of read notes, dybs/ideas/.read.json,
// holds content hashes and names only, so it can be shared. Only .txt, .md,
// .srt and .vtt files directly in the folder count; links and subfolders are
// skipped. The script never changes a note. It writes the ledger on `mark`,
// and the folder file whenever --folder is given.
// Exit code 0 = done; 1 = verify found a mention that does not hold;
// 2 = it could not run (no folder, unreadable ledger, bad arguments).

import { readFileSync, writeFileSync, readdirSync, lstatSync, statSync, mkdirSync, renameSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const LEDGER = 'dybs/ideas/.read.json';
export const FOLDER = 'dybs/ideas/.folder';
export const SNAPSHOT = 'dybs/ideas/.run.json';
// Notes this device never reads: one file name per line.
export const SKIP = 'dybs/ideas/.skip';
export const PROMPT = 'dybs/transcript-prompt.txt';
export const SUPPORTED = /\.(txt|md|srt|vtt)$/i;
// The version of a note a mention cites: the first 12 hex of its sha256.
export const REF = 12;
// - "<quote>" (<who>, <YYYY-MM-DD or date unknown>, `<file>@<ref>`, asked|need)
export const MENTION = /^- "(.+)" \((.+?), (\d{4}-\d{2}-\d{2}|date unknown), `([^`]+)@([0-9a-f]{12})`, (asked|need)\)$/;
// A quote this short would be found in almost any note, so it proves nothing.
export const MIN_WORDS = 3;

export class Stop extends Error {}

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const today = () => new Date().toISOString().slice(0, 10);

// Text as a reader sees it: no subtitle numbering, timings, notes or voice
// tags, no Markdown quote marks at line starts, straight quotes, single
// spaces. Quotes are compared on this form, so a passage that wraps across
// lines or cues still matches; a changed word does not.
export function fold(text, name = '') {
  let t = String(text).replace(/^﻿/, '');
  if (/\.(srt|vtt)$/i.test(name)) {
    // Read block by block: a cue's number or name sits only on the lines
    // before its timing line, so a line of speech that is just a number
    // stays. The WEBVTT header and NOTE, STYLE and REGION blocks are not speech.
    const keep = [];
    for (const block of t.split(/\r?\n[ \t]*\r?\n/)) {
      const lines = block.split(/\r?\n/).filter((l) => l.trim());
      if (!lines.length || /^(WEBVTT|NOTE|STYLE|REGION)\b/.test(lines[0])) continue;
      const timing = lines.findIndex((l) => /-->/.test(l));
      keep.push(...(timing >= 0 && timing <= 1 ? lines.slice(timing + 1) : lines));
    }
    t = keep.join('\n').replace(/<[^>]+>/g, ' ');
  } else if (/\.md$/i.test(name)) {
    t = t.replace(/^[ \t]*(>[ \t]?)+/gm, '');
  }
  return t.replace(/[‘’‛′]/g, "'").replace(/[“”‟″]/g, '"')
    .replace(/…/g, '...').replace(/\s+/g, ' ').trim();
}

export function readLedger(root) {
  const p = join(root, LEDGER);
  if (!existsSync(p)) return { version: 1, read: [] };
  let l;
  try { l = JSON.parse(readFileSync(p, 'utf8')); } catch {
    throw new Stop(`${LEDGER} is not valid JSON. Fix it, or move it aside: every note is then read again. It was not changed.`);
  }
  if (!l || l.version !== 1 || !Array.isArray(l.read)) throw new Stop(`${LEDGER} is not a version 1 ledger. It was not changed.`);
  return { version: 1, read: l.read };
}

// dybs/ideas as a plain folder inside the project, made when missing.
function ideasDir(root) {
  const dir = join(root, 'dybs/ideas');
  mkdirSync(dir, { recursive: true });
  for (const d of [join(root, 'dybs'), dir]) {
    if (lstatSync(d).isSymbolicLink() || !lstatSync(d).isDirectory()) throw new Stop(`${d} is not a plain folder; nothing was written.`);
  }
  return dir;
}

// Replace one file in dybs/ideas whole, or not at all.
function publish(root, rel, body) {
  const dir = ideasDir(root);
  const p = join(root, rel);
  if (existsSync(p) && lstatSync(p).isSymbolicLink()) throw new Stop(`${rel} is a link; it was not written.`);
  const tmp = join(dir, `.${randomUUID()}.tmp`);
  try {
    writeFileSync(tmp, body, { flag: 'wx' });
    renameSync(tmp, p);
  } finally { rmSync(tmp, { force: true }); }
}

// Files that belong to this device, never to the repository: git is told to
// ignore them before they are written.
const LOCAL = ['.folder', '.run.json', '.skip'];
function ignoreLocal(root) {
  ideasDir(root);
  const ignore = join(root, 'dybs/ideas/.gitignore');
  let st = null;
  try { st = lstatSync(ignore); } catch { /* none yet */ }
  if (st && !st.isFile()) throw new Stop('dybs/ideas/.gitignore is not a plain file, so nothing was written. Remove it or make it a plain file, then run again.');
  const cur = st ? readFileSync(ignore, 'utf8') : '';
  const have = new Set(cur.split(/\r?\n/).map((l) => l.trim()));
  const add = LOCAL.filter((n) => !have.has(n));
  if (add.length) writeFileSync(ignore, cur + (cur && !cur.endsWith('\n') ? '\n' : '') + add.join('\n') + '\n', { flag: st ? 'r+' : 'wx' });
}

function rememberFolder(root, dir) {
  ignoreLocal(root);
  publish(root, FOLDER, dir + '\n');
}

// Every line under ## Mentions in dybs/ideas/*.md, in file order.
function mentionLines(root) {
  const dir = join(root, 'dybs/ideas');
  const files = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.md')).sort() : [];
  const out = [];
  for (const f of files) {
    const text = readFileSync(join(dir, f), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    const section = text.split(/^## Mentions[ \t]*$/m)[1];
    if (section === undefined) continue;
    for (const raw of section.split(/^## /m)[0].split(/\r?\n/)) if (raw.trim()) out.push({ idea: f, line: raw.trim() });
  }
  return { files, lines: out };
}
const lineKey = (idea, line) => sha(`${idea}\n${line}`);

// The mentions that were there before this run, so verify can tell them
// from the ones the run adds. Taken by the first `new` of a run and dropped
// by `mark`; a run that stops early leaves it, so the next run checks more
// strictly, never less.
function snapshot(root) {
  if (existsSync(join(root, SNAPSHOT))) return;
  ignoreLocal(root);
  publish(root, SNAPSHOT, JSON.stringify({ version: 1, lines: mentionLines(root).lines.map((l) => lineKey(l.idea, l.line)) }) + '\n');
}

function readSnapshot(root) {
  const p = join(root, SNAPSHOT);
  try {
    if (lstatSync(p).isSymbolicLink()) return new Set();
    const s = JSON.parse(readFileSync(p, 'utf8'));
    return new Set(Array.isArray(s.lines) ? s.lines : []);
  } catch { return new Set(); }
}

export function folderOf(root, given) {
  let f = given;
  if (!f) {
    const p = join(root, FOLDER);
    try { if (!lstatSync(p).isSymbolicLink()) f = readFileSync(p, 'utf8').trim(); } catch { /* none yet */ }
  }
  if (!f) throw new Stop('No notes folder. Pass it: /dybs-ideas <folder> (it is remembered on this device in dybs/ideas/.folder).');
  const dir = resolve(root, f);
  let st;
  try { st = statSync(dir); } catch { throw new Stop(`The notes folder ${dir} does not exist or cannot be read.`); }
  if (!st.isDirectory()) throw new Stop(`The notes folder ${dir} is not a folder.`);
  if (given) rememberFolder(root, dir);
  return dir;
}

// The notes in a folder: regular files with a supported extension, by name.
// A note that cannot be read is listed, never skipped in silence.
export function notes(dir, { text = false, skip = new Set() } = {}) {
  let names;
  try { names = readdirSync(dir); } catch { throw new Stop(`The notes folder ${dir} cannot be read.`); }
  const out = [];
  for (const name of names.sort()) {
    if (!SUPPORTED.test(name) || name.startsWith('.')) continue;
    const p = join(dir, name);
    let st;
    try { st = lstatSync(p); } catch { continue; }
    if (!st.isFile()) continue;
    // A skipped note is listed by name and never opened.
    if (skip.has(name)) { out.push({ name, skipped: true }); continue; }
    let buf;
    try { buf = readFileSync(p); } catch { out.push({ name, unreadable: true }); continue; }
    out.push({ name, sha256: sha(buf), bytes: buf.length, empty: !buf.toString('utf8').trim(), ...(text ? { text: buf.toString('utf8') } : {}) });
  }
  return out;
}

export function readSkip(root) {
  const p = join(root, SKIP);
  try {
    if (lstatSync(p).isSymbolicLink()) throw new Stop(`${SKIP} is a link; it was not read.`);
    return new Set(readFileSync(p, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
  } catch (e) { if (e instanceof Stop) throw e; return new Set(); }
}

export function findNew(root, given) {
  const folder = folderOf(root, given);
  const known = new Set(readLedger(root).read.map((r) => r.sha256));
  const skip = readSkip(root);
  ignoreLocal(root);
  const listed = notes(folder, { skip });
  const all = listed.filter((n) => !n.skipped);
  const readable = all.filter((n) => !n.unreadable);
  const fresh = readable.filter((n) => !known.has(n.sha256));
  snapshot(root);
  return {
    folder,
    prompt: existsSync(join(root, PROMPT)) ? PROMPT : null,
    new: fresh.filter((n) => !n.empty).map(({ name, sha256, bytes }) => ({ name, sha256, bytes, ref: `${name}@${sha256.slice(0, REF)}`, mark: `${name}@${sha256}` })),
    empty: fresh.filter((n) => n.empty).map((n) => n.name),
    unreadable: all.filter((n) => n.unreadable).map((n) => n.name),
    skipped: listed.filter((n) => n.skipped).map((n) => n.name),
    alreadyRead: readable.length - fresh.length,
  };
}

export function mark(root, args, given) {
  const folder = folderOf(root, given);
  const ledger = readLedger(root);
  const skip = readSkip(root);
  const listed = notes(folder, { skip });
  const here = new Map(listed.filter((n) => !n.unreadable).map((n) => [n.name, n.sha256]));
  const known = new Set(ledger.read.map((r) => r.sha256));
  const added = [], skipped = [];
  for (const a of args) {
    const m = a.match(/^(.*)@([0-9a-f]{64})$/);
    const name = m ? m[1] : a;
    if (basename(name) !== name || !here.has(name)) throw new Stop(`${name} is not a note in ${folder}; nothing was marked.`);
    // A skipped note is never marked read, so unskipping it makes it new again.
    if (skip.has(name)) { skipped.push(name); continue; }
    const hash = m ? m[2] : here.get(name);
    if (known.has(hash)) continue;
    known.add(hash);
    added.push({ name, sha256: hash, read: today() });
  }
  publish(root, LEDGER, JSON.stringify({ version: 1, read: [...ledger.read, ...added] }, null, 2) + '\n');
  rmSync(join(root, SNAPSHOT), { force: true });
  return { folder, marked: added.map((a) => a.name), skipped, alreadyRead: args.length - added.length - skipped.length };
}

// Every mention in dybs/ideas/*.md, with the problems found. A mention cites
// one version of a note; it is checked against that version when it is in the
// folder, under any name. A version that was read and is gone since (the note
// was re-exported or removed) cannot be checked again, and is counted, not
// failed, so evidence on an idea is never lost to a later export.
// A problem in a mention that was there before this run (see snapshot) is
// listed under `earlier` and does not fail it, so an old line nobody can fix
// now never blocks a run; every line the run added is checked strictly.
// Without a snapshot, every problem fails.
export function verify(root, given) {
  const before = readSnapshot(root);
  const old = (p) => before.has(lineKey(p.idea, p.line));
  const folder = folderOf(root, given);
  const readRefs = new Set(readLedger(root).read.map((r) => r.sha256.slice(0, REF)));
  const byRef = new Map();
  for (const n of notes(folder, { text: true })) if (!n.unreadable) byRef.set(n.sha256.slice(0, REF), fold(n.text, n.name));
  const { files, lines } = mentionLines(root);
  const problems = [], earlier = [];
  const report = (p) => (old(p) ? earlier : problems).push(p);
  const seen = new Map();
  let checked = 0, unchecked = 0;
  for (const { idea: f, line } of lines) {
      const m = line.match(MENTION);
      if (!m) { report({ idea: f, problem: 'malformed', line }); continue; }
      const [, quote, , , name, ref] = m;
      const q = fold(quote);
      if (q.split(' ').length < MIN_WORDS) { report({ idea: f, problem: 'too short', line }); continue; }
      // The same quote from the same note belongs in one idea, once, also
      // when the note was exported again under a new version. The line this
      // run added is the one reported, never the evidence that was there.
      const dup = seen.get(`${ref}\n${q}`) || seen.get(`${name}\n${q}`);
      if (dup) {
        const here = { idea: f, line };
        if (old(here) && !old(dup)) report({ idea: dup.idea, problem: `duplicate of ${f}`, line: dup.line });
        else report({ idea: f, problem: `duplicate of ${dup.idea}`, line });
        continue;
      }
      seen.set(`${ref}\n${q}`, { idea: f, line }).set(`${name}\n${q}`, { idea: f, line });
      const src = byRef.get(ref);
      if (src === undefined) {
        if (readRefs.has(ref)) unchecked++;
        else report({ idea: f, problem: 'unknown source', line });
        continue;
      }
      checked++;
      if (!src.includes(q)) report({ idea: f, problem: 'quote not in source', line });
  }
  return { folder, ideas: files.length, checked, unchecked, problems, earlier };
}

function parse(argv) {
  const opts = { json: false, folder: null, rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--folder') { opts.folder = argv[++i]; if (!opts.folder) throw new Stop('--folder needs a folder.'); }
    else if (a.startsWith('--')) throw new Stop(`Unknown option ${a}.`);
    else opts.rest.push(a);
  }
  return opts;
}

export function main(argv, out = console.log) {
  const [cmd, ...more] = argv;
  try {
    if (!['new', 'verify', 'mark'].includes(cmd)) throw new Stop('Usage: dybs-ideas.mjs new|verify|mark [project] [files...] [--folder <dir>] [--json]');
    const o = parse(more);
    const root = resolve(o.rest.shift() || '.');
    if (!existsSync(root) || !statSync(root).isDirectory()) throw new Stop(`${root} is not a folder.`);
    if (cmd === 'new') {
      const r = findNew(root, o.folder);
      if (o.json) out(JSON.stringify(r, null, 2));
      else {
        out(`Notes folder: ${r.folder}`);
        out(`New: ${r.new.length}, already read: ${r.alreadyRead}${r.skipped.length ? `, skipped: ${r.skipped.length}` : ''}${r.empty.length ? `, empty: ${r.empty.length}` : ''}${r.unreadable.length ? `, unreadable: ${r.unreadable.length}` : ''}`);
        for (const n of r.new) out(`- ${n.mark}`);
        for (const n of r.unreadable) out(`- cannot be read: ${n}`);
        if (r.prompt) out(`Project prompt: ${r.prompt}`);
      }
      return 0;
    }
    if (cmd === 'mark') {
      if (!o.rest.length) throw new Stop('mark needs the notes that were read.');
      const r = mark(root, o.rest, o.folder);
      out(o.json ? JSON.stringify(r, null, 2) : `Marked as read: ${r.marked.length}${r.alreadyRead ? `, already read: ${r.alreadyRead}` : ''}`);
      return 0;
    }
    if (o.rest.length) throw new Stop('verify takes no notes; it checks every mention.');
    const r = verify(root, o.folder);
    if (o.json) out(JSON.stringify(r, null, 2));
    else {
      out(`Mentions checked: ${r.checked}, source changed or gone: ${r.unchecked}, problems: ${r.problems.length}`);
      for (const p of r.problems) out(`- ${p.idea}: ${p.problem}: ${p.line}`);
      if (r.earlier.length) out(`Earlier runs, not failing: ${r.earlier.length}`);
      for (const p of r.earlier) out(`- ${p.idea}: ${p.problem}: ${p.line}`);
    }
    return r.problems.length ? 1 : 0;
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    out(argv.includes('--json') ? JSON.stringify({ error: e.message }) : `dybs-ideas: ${e.message}`);
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}

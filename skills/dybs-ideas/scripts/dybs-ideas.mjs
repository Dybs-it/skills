#!/usr/bin/env node
// The facts behind dybs-ideas: which notes are new, whether every quoted
// mention is really in its source, and which notes have been read.
// The agent finds the ideas; this script keeps it honest and repeatable.
//
// Usage:
//   node dybs-ideas.mjs new    [project] [--folder <dir>] [--json]
//   node dybs-ideas.mjs verify [project] [--folder <dir>] [--json]
//   node dybs-ideas.mjs part   <project> <file@ref> <n>... [--json]
//   node dybs-ideas.mjs mark   [project] <file[@sha256]>... [--folder <dir>] [--json]
//
// The notes folder is --folder, else the one given last on this device, kept
// in dybs/ideas/.folder (never committed: the script lists it in
// dybs/ideas/.gitignore). The ledger of read notes, dybs/ideas/.read.json,
// holds content hashes and names only, so it can be shared. Only .txt, .md,
// .srt and .vtt files directly in the folder count; links and subfolders are
// skipped. The script never changes a note. It writes the ledger on `mark`,
// the folder file whenever --folder is given, and the run record
// (dybs/ideas/.run.json) on `new`, `part` and `verify`.
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
// - "<quote>" (<who>, <YYYY-MM-DD or date unknown> <HH:MM or no time>, `<file>@<ref>`, asked|need)
export const MENTION = /^- "(.+)" \((.+?), (\d{4}-\d{2}-\d{2}|date unknown) (\d{2}:\d{2}|no time), `([^`]+)@([0-9a-f]{12})`, (asked|need)\)$/;
// A subtitle timing line, the whole line: start --> end, then cue settings.
export const TIMING = /^\s*((?:\d{1,2}:)?\d{1,2}:\d{2})[.,]\d{1,3}\s*-->\s*(?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}(?:\s.*)?$/;
// A timestamp in a text note: [08:43], [08:43:37], (08:43:37), or 08:43:37
// at the start of a line. A time in a sentence ("at 10:30") is not one.
const STAMP = /\[(\d{1,2}):(\d{2})(?::\d{2})?\]|\((\d{1,2}):(\d{2}):\d{2}\)|^[ \t]*(\d{1,2}):(\d{2}):\d{2}\b/gm;
// A long note is read in parts of about this many characters, so its end
// gets the same attention as its start.
export const PART_CHARS = 20000;
export const RECORD_VERSION = 2;
// A quote this short would be found in almost any note, so it proves nothing.
export const MIN_WORDS = 3;

export class Stop extends Error {}

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const today = () => new Date().toISOString().slice(0, 10);

const hhmm = (h, m) => `${String(h).padStart(2, '0')}:${m}`;
// HH:MM of a subtitle start time (h:mm:ss or mm:ss).
const cueTime = (s) => { const p = s.split(':'); return p.length === 3 ? hhmm(p[0], p[1]) : hhmm('0', p[0].padStart(2, '0')); };
const clean = (t) => t.replace(/[‘’‛′]/g, "'").replace(/[“”‟″]/g, '"')
  .replace(/…/g, '...').replace(/\s+/g, ' ').trim();

// A note as a reader sees it, in timed pieces: no subtitle numbering, timing
// lines, notes or voice tags, no timestamps, no Markdown quote marks at line
// starts, straight quotes, single spaces. Each piece carries the HH:MM it
// starts at, or null when the note shows none there.
export function segments(text, name = '') {
  let t = String(text).replace(/^﻿/, '');
  const out = [];
  if (/\.(srt|vtt)$/i.test(name)) {
    // Block by block: a cue's number or name sits only right before its
    // timing line, so a line of speech that is just a number stays, and a
    // line is a timing line only when the whole line is one.
    for (const block of t.split(/\r?\n[ \t]*\r?\n/)) {
      const lines = block.split(/\r?\n/).filter((l) => l.trim());
      if (!lines.length || /^(WEBVTT|NOTE|STYLE|REGION)\b/.test(lines[0])) continue;
      let time = null, buf = [];
      const flush = () => { if (buf.length) out.push({ time, text: buf.join('\n').replace(/<[^>]+>/g, ' ') }); buf = []; };
      lines.forEach((l, i) => {
        const m = l.match(TIMING);
        if (m) { flush(); time = cueTime(m[1]); return; }
        if (TIMING.test(lines[i + 1] || '') && (i === 0 || /^\s*\d+\s*$/.test(l))) return;
        buf.push(l);
      });
      flush();
    }
  } else {
    if (/\.md$/i.test(name)) t = t.replace(/^[ \t]*(>[ \t]?)+/gm, '');
    let last = 0, time = null, m;
    STAMP.lastIndex = 0;
    while ((m = STAMP.exec(t))) {
      out.push({ time, text: t.slice(last, m.index) });
      time = hhmm(m[1] ?? m[3] ?? m[5], m[2] ?? m[4] ?? m[6]);
      last = m.index + m[0].length;
    }
    out.push({ time, text: t.slice(last) });
  }
  return out.map((s) => ({ time: s.time, text: clean(s.text) })).filter((s) => s.text);
}

// The text quotes are compared on: a passage that wraps across lines, cues or
// timestamps still matches; a changed word does not.
export function fold(text, name = '') {
  return segments(text, name).map((s) => s.text).join(' ');
}

// Where a folded quote is in a note: the times of the pieces it starts in.
export function locate(segs, q) {
  let full = '';
  const starts = [];
  for (const s of segs) { starts.push(full ? full.length + 1 : 0); full += (full ? ' ' : '') + s.text; }
  const times = new Set();
  for (let i = full.indexOf(q); i >= 0; i = full.indexOf(q, i + 1)) {
    let k = starts.length - 1;
    while (k > 0 && starts[k] > i) k--;
    times.add(segs[k].time);
  }
  return times;
}

// The parts a long note is read in: line ranges of about PART_CHARS, with the
// first and last time each shows.
export function parts(text, name = '') {
  const lines = String(text).split('\n');
  const ranges = [];
  let start = 0, size = 0;
  for (let i = 0; i < lines.length; i++) {
    size += lines[i].length + 1;
    if (size >= PART_CHARS && i < lines.length - 1) { ranges.push([start, i]); start = i + 1; size = 0; }
  }
  ranges.push([start, lines.length - 1]);
  return ranges.map(([a, b], k) => {
    const times = segments(lines.slice(a, b + 1).join('\n'), name).map((s) => s.time).filter(Boolean);
    return { part: k + 1, lines: [a + 1, b + 1], from: times[0] || null, to: times[times.length - 1] || null };
  });
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
  // The nth copy of a line is its own line: a copy added next to an old one
  // is new.
  const count = new Map();
  for (const l of out) {
    const k = `${l.idea}\n${l.line}`;
    l.key = sha(`${k}\n${count.get(k) || 0}`);
    count.set(k, (count.get(k) || 0) + 1);
  }
  return { files, lines: out };
}

// The run record: the mentions that were there before this run (so verify
// can tell them from the ones the run adds), the lines the run added that
// passed verify, and the notes of this run with the parts read so far.
// Taken by the first `new` that has notes to read and dropped by `mark`.
// A run that stops early leaves it, so the next run checks more strictly,
// never less; a run with nothing to read drops it only when no line was
// added since that never passed verify.
function readRecord(root) {
  const p = join(root, SNAPSHOT);
  try {
    if (lstatSync(p).isSymbolicLink()) return null;
    const r = JSON.parse(readFileSync(p, 'utf8'));
    if (r.version !== RECORD_VERSION || !Array.isArray(r.lines) || !Array.isArray(r.verified) || !r.notes) return null;
    return r;
  } catch { return null; }
}

function writeRecord(root, r) {
  ignoreLocal(root);
  publish(root, SNAPSHOT, JSON.stringify(r) + '\n');
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
    if (skip.has(name.toLowerCase())) { out.push({ name, skipped: true }); continue; }
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
    return new Set(readFileSync(p, 'utf8').split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter(Boolean));
  } catch (e) { if (e instanceof Stop) throw e; return new Set(); }
}

export function findNew(root, given) {
  const folder = folderOf(root, given);
  const known = new Set(readLedger(root).read.map((r) => r.sha256));
  const skip = readSkip(root);
  ignoreLocal(root);
  const listed = notes(folder, { skip, text: true });
  const all = listed.filter((n) => !n.skipped);
  const readable = all.filter((n) => !n.unreadable);
  const fresh = readable.filter((n) => !known.has(n.sha256));
  const toRead = fresh.filter((n) => !n.empty).map((n) => ({ ...n, parts: parts(n.text, n.name) }));
  // A record of an older version is ignored, and so is dropped.
  let rec = readRecord(root);
  if (!rec) rmSync(join(root, SNAPSHOT), { force: true });
  if (toRead.length) {
    rec = rec || { version: RECORD_VERSION, lines: mentionLines(root).lines.map((l) => l.key), verified: [], notes: {} };
    for (const n of toRead) rec.notes[n.sha256.slice(0, REF)] ||= { name: n.name, parts: n.parts.length, read: [] };
    writeRecord(root, rec);
  } else if (rec) {
    const passed = new Set([...rec.lines, ...rec.verified]);
    if (mentionLines(root).lines.every((l) => passed.has(l.key))) rmSync(join(root, SNAPSHOT), { force: true });
  }
  return {
    folder,
    prompt: existsSync(join(root, PROMPT)) ? PROMPT : null,
    new: toRead.map(({ name, sha256, bytes, parts: p }) => ({ name, sha256, bytes, ref: `${name}@${sha256.slice(0, REF)}`, mark: `${name}@${sha256}`, parts: p })),
    empty: fresh.filter((n) => n.empty).map((n) => n.name),
    unreadable: all.filter((n) => n.unreadable).map((n) => n.name),
    skipped: listed.filter((n) => n.skipped).map((n) => n.name),
    alreadyRead: readable.length - fresh.length,
  };
}

// Tick parts of a note of this run as read.
export function readPart(root, refArg, nums) {
  const m = String(refArg || '').match(/^(.+)@([0-9a-f]{12})[0-9a-f]*$/);
  if (!m) throw new Stop(`${refArg} is not a ref from \`new\`.`);
  const rec = readRecord(root);
  const entry = rec?.notes[m[2]];
  if (!entry) throw new Stop(`${m[1]} is not a note of this run; run \`new\` first.`);
  const ns = nums.map(Number);
  if (!ns.length || ns.some((n) => !Number.isInteger(n) || n < 1 || n > entry.parts)) throw new Stop(`Give part numbers from 1 to ${entry.parts}.`);
  entry.read = [...new Set([...entry.read, ...ns])].sort((a, b) => a - b);
  writeRecord(root, rec);
  return { name: entry.name, parts: entry.parts, read: entry.read };
}

export function mark(root, args, given) {
  const folder = folderOf(root, given);
  const ledger = readLedger(root);
  const skip = readSkip(root);
  const listed = notes(folder, { skip });
  const here = new Map(listed.filter((n) => !n.unreadable).map((n) => [n.name, n.sha256]));
  const known = new Set(ledger.read.map((r) => r.sha256));
  const rec = readRecord(root);
  const added = [], skipped = [];
  for (const a of args) {
    const m = a.match(/^(.*)@([0-9a-f]{64})$/);
    const name = m ? m[1] : a;
    if (basename(name) !== name || !here.has(name)) throw new Stop(`${name} is not a note in ${folder}; nothing was marked.`);
    // A skipped note is never marked read, so unskipping it makes it new again.
    if (skip.has(name.toLowerCase())) { skipped.push(name); continue; }
    const hash = m ? m[2] : here.get(name);
    if (known.has(hash)) continue;
    // A note of this run in several parts is marked only once every part of
    // it was read; a note of one part is read whole.
    const entry = rec?.notes[hash.slice(0, REF)];
    if (entry && entry.parts > 1 && entry.read.length < entry.parts) {
      const left = Array.from({ length: entry.parts }, (_, i) => i + 1).filter((n) => !entry.read.includes(n));
      throw new Stop(`Read every part of ${name} first: part ${left.join(', ')} of ${entry.parts} not read. Nothing was marked.`);
    }
    known.add(hash);
    added.push({ name, sha256: hash, read: today(), ...(entry ? { parts: entry.parts } : {}) });
  }
  publish(root, LEDGER, JSON.stringify({ version: 1, read: [...ledger.read, ...added] }, null, 2) + '\n');
  rmSync(join(root, SNAPSHOT), { force: true });
  return { folder, marked: added.map((a) => a.name), skipped, alreadyRead: args.length - added.length - skipped.length };
}

// Every mention in dybs/ideas/*.md, with the problems found. A mention cites
// one version of a note; it is checked against that version when it is in the
// folder, under any name, and its time against the time the quote starts at.
// A version that was read and is gone since (the note was re-exported or
// removed) cannot be checked again, and is counted, not failed, so evidence
// on an idea is never lost to a later export.
// With a run record, a problem in a mention that was there before this run
// is listed under `earlier` and does not fail it, so an old line nobody can
// fix now never blocks a run; every line the run added is checked strictly
// and must cite a note of this run that is not skipped. Without a record,
// every problem fails.
export function verify(root, given) {
  const rec = readRecord(root);
  const before = new Set(rec?.lines || []);
  const old = (l) => before.has(l.key);
  const folder = folderOf(root, given);
  const readRefs = new Set(readLedger(root).read.map((r) => r.sha256.slice(0, REF)));
  const byRef = new Map();
  for (const n of notes(folder, { text: true, skip: readSkip(root) })) if (!n.unreadable && !n.skipped) byRef.set(n.sha256.slice(0, REF), segments(n.text, n.name));
  const { files, lines } = mentionLines(root);
  const problems = [], earlier = [], bad = new Set();
  const report = (l, problem) => { bad.add(l.key); (old(l) ? earlier : problems).push({ idea: l.idea, problem, line: l.line }); };
  const seen = new Map();
  let checked = 0, unchecked = 0;
  for (const here of lines) {
    const m = here.line.match(MENTION);
    if (!m) { report(here, 'malformed'); continue; }
    const [, quote, , , time, name, ref] = m;
    const q = fold(quote);
    if (q.split(' ').length < MIN_WORDS) { report(here, 'too short'); continue; }
    // The same quote from the same note belongs in one idea, once, also
    // when the note was exported again under a new version. The line this
    // run added is the one reported, never the evidence that was there.
    const dup = seen.get(`${ref}\n${q}`) || seen.get(`${name}\n${q}`);
    if (dup) {
      if (old(here) && !old(dup)) report(dup, `duplicate of ${here.idea}`);
      else report(here, `duplicate of ${dup.idea}`);
      continue;
    }
    seen.set(`${ref}\n${q}`, here).set(`${name}\n${q}`, here);
    if (rec && !old(here) && !rec.notes[ref]) { report(here, 'not a note of this run'); continue; }
    const segs = byRef.get(ref);
    if (segs === undefined) {
      if (rec && !old(here)) report(here, 'source skipped or gone');
      else if (readRefs.has(ref)) unchecked++;
      else report(here, 'unknown source');
      continue;
    }
    checked++;
    const times = locate(segs, q);
    if (!times.size) { report(here, 'quote not in source'); continue; }
    const timed = segs.some((s) => s.time);
    if (time === 'no time') { if (!times.has(null)) report(here, 'time missing'); }
    else if (!times.has(time)) report(here, timed ? 'wrong time' : 'time not in note');
  }
  // Lines this run added that passed are remembered, so a later run with
  // nothing to read knows the record can go.
  if (rec) {
    rec.verified = [...new Set([...rec.verified, ...lines.filter((l) => !old(l) && !bad.has(l.key)).map((l) => l.key)])];
    writeRecord(root, rec);
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
    if (!['new', 'verify', 'mark', 'part'].includes(cmd)) throw new Stop('Usage: dybs-ideas.mjs new|verify|part|mark [project] [files...] [--folder <dir>] [--json]');
    const o = parse(more);
    const root = resolve(o.rest.shift() || '.');
    if (!existsSync(root) || !statSync(root).isDirectory()) throw new Stop(`${root} is not a folder.`);
    if (cmd === 'new') {
      const r = findNew(root, o.folder);
      if (o.json) out(JSON.stringify(r, null, 2));
      else {
        out(`Notes folder: ${r.folder}`);
        out(`New: ${r.new.length}, already read: ${r.alreadyRead}${r.skipped.length ? `, skipped: ${r.skipped.length}` : ''}${r.empty.length ? `, empty: ${r.empty.length}` : ''}${r.unreadable.length ? `, unreadable: ${r.unreadable.length}` : ''}`);
        for (const n of r.new) out(`- ${n.mark} (${n.parts.length === 1 ? '1 part' : `${n.parts.length} parts: ${n.parts.map((p) => `lines ${p.lines[0]}-${p.lines[1]}`).join(', ')}`})`);
        for (const n of r.unreadable) out(`- cannot be read: ${n}`);
        if (r.prompt) out(`Project prompt: ${r.prompt}`);
      }
      return 0;
    }
    if (cmd === 'part') {
      const r = readPart(root, o.rest.shift(), o.rest);
      out(o.json ? JSON.stringify(r, null, 2) : `${r.name}: read part ${r.read.join(', ')} of ${r.parts}`);
      return 0;
    }
    if (cmd === 'mark') {
      if (!o.rest.length) throw new Stop('mark needs the notes that were read.');
      const r = mark(root, o.rest, o.folder);
      out(o.json ? JSON.stringify(r, null, 2) : `Marked as read: ${r.marked.length}${r.skipped.length ? `, skipped: ${r.skipped.join(', ')}` : ''}${r.alreadyRead ? `, already read: ${r.alreadyRead}` : ''}`);
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

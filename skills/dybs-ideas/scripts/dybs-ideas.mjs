#!/usr/bin/env node
// The facts behind dybs-ideas: which notes are new, whether every quoted
// mention is really in its source, and which notes have been read.
// The agent finds the ideas; this script keeps it honest and repeatable.
//
// Usage:
//   node dybs-ideas.mjs new    [project] [--folder <dir>] [--json]
//   node dybs-ideas.mjs verify [project] [<file@ref>...] [--folder <dir>] [--json]
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
    const keep = [];
    let skipping = false;
    for (const l of t.split(/\r?\n/)) {
      if (!l.trim()) { skipping = false; keep.push(''); continue; }
      if (skipping) continue;
      if (/^(NOTE|STYLE|REGION)\b/.test(l)) { skipping = true; continue; }
      if (/^\s*\d+\s*$/.test(l) || /-->/.test(l) || /^WEBVTT\b/.test(l)) continue;
      keep.push(l);
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

// The folder is per device: remembered in a file git is told to ignore.
// Git is told first, so a path is never written where it could be committed.
function rememberFolder(root, dir) {
  ideasDir(root);
  const ignore = join(root, 'dybs/ideas/.gitignore');
  let st = null;
  try { st = lstatSync(ignore); } catch { /* none yet */ }
  if (st && !st.isFile()) throw new Stop('dybs/ideas/.gitignore is not a plain file, so the folder was not remembered. Pass the folder on every run, or make it a plain file.');
  const cur = st ? readFileSync(ignore, 'utf8') : '';
  if (!cur.split(/\r?\n/).some((l) => l.trim() === '.folder')) {
    writeFileSync(ignore, cur + (cur && !cur.endsWith('\n') ? '\n' : '') + '.folder\n', { flag: st ? 'r+' : 'wx' });
  }
  publish(root, FOLDER, dir + '\n');
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
export function notes(dir, { text = false } = {}) {
  let names;
  try { names = readdirSync(dir); } catch { throw new Stop(`The notes folder ${dir} cannot be read.`); }
  const out = [];
  for (const name of names.sort()) {
    if (!SUPPORTED.test(name) || name.startsWith('.')) continue;
    const p = join(dir, name);
    let st;
    try { st = lstatSync(p); } catch { continue; }
    if (!st.isFile()) continue;
    let buf;
    try { buf = readFileSync(p); } catch { out.push({ name, unreadable: true }); continue; }
    out.push({ name, sha256: sha(buf), bytes: buf.length, empty: !buf.toString('utf8').trim(), ...(text ? { text: buf.toString('utf8') } : {}) });
  }
  return out;
}

export function findNew(root, given) {
  const folder = folderOf(root, given);
  const known = new Set(readLedger(root).read.map((r) => r.sha256));
  const all = notes(folder);
  const readable = all.filter((n) => !n.unreadable);
  const fresh = readable.filter((n) => !known.has(n.sha256));
  return {
    folder,
    prompt: existsSync(join(root, PROMPT)) ? PROMPT : null,
    new: fresh.filter((n) => !n.empty).map(({ name, sha256, bytes }) => ({ name, sha256, bytes, ref: `${name}@${sha256.slice(0, REF)}`, mark: `${name}@${sha256}` })),
    empty: fresh.filter((n) => n.empty).map((n) => n.name),
    unreadable: all.filter((n) => n.unreadable).map((n) => n.name),
    alreadyRead: readable.length - fresh.length,
  };
}

export function mark(root, args, given) {
  const folder = folderOf(root, given);
  const ledger = readLedger(root);
  const here = new Map(notes(folder).filter((n) => !n.unreadable).map((n) => [n.name, n.sha256]));
  const known = new Set(ledger.read.map((r) => r.sha256));
  const added = [];
  for (const a of args) {
    const m = a.match(/^(.*)@([0-9a-f]{64})$/);
    const name = m ? m[1] : a;
    if (basename(name) !== name || !here.has(name)) throw new Stop(`${name} is not a note in ${folder}; nothing was marked.`);
    const hash = m ? m[2] : here.get(name);
    if (known.has(hash)) continue;
    known.add(hash);
    added.push({ name, sha256: hash, read: today() });
  }
  publish(root, LEDGER, JSON.stringify({ version: 1, read: [...ledger.read, ...added] }, null, 2) + '\n');
  return { folder, marked: added.map((a) => a.name), alreadyRead: args.length - added.length };
}

// Every mention in dybs/ideas/*.md, with the problems found. A mention cites
// one version of a note; it is checked against that version when it is in the
// folder, under any name. A version that was read and is gone since (the note
// was re-exported or removed) cannot be checked again, and is counted, not
// failed, so evidence on an idea is never lost to a later export.
// Given the refs of the notes read in this run, only problems in mentions of
// those notes fail; the others are listed under `earlier`, so an old line
// nobody can fix now never blocks a run. Without refs, every problem fails.
export function verify(root, given, runRefs = []) {
  const run = runRefs.map((r) => { const m = r.match(/^(.+)@([0-9a-f]{12})[0-9a-f]*$/); if (!m) throw new Stop(`${r} is not a ref from \`new\`.`); return `${m[1]}@${m[2]}`; });
  const ours = (...lines) => !run.length || lines.some((l) => run.some((r) => l.includes(r)));
  const folder = folderOf(root, given);
  const readRefs = new Set(readLedger(root).read.map((r) => r.sha256.slice(0, REF)));
  const byRef = new Map();
  for (const n of notes(folder, { text: true })) if (!n.unreadable) byRef.set(n.sha256.slice(0, REF), fold(n.text, n.name));
  const dir = join(root, 'dybs/ideas');
  const files = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.md')).sort() : [];
  const problems = [], earlier = [];
  const report = (p, ...also) => (ours(p.line, ...also) ? problems : earlier).push(p);
  const seen = new Map();
  let checked = 0, unchecked = 0;
  for (const f of files) {
    const text = readFileSync(join(dir, f), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    const section = text.split(/^## Mentions[ \t]*$/m)[1];
    if (section === undefined) continue;
    for (const raw of section.split(/^## /m)[0].split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const m = line.match(MENTION);
      if (!m) { report({ idea: f, problem: 'malformed', line }); continue; }
      const [, quote, , , name, ref] = m;
      const q = fold(quote);
      if (q.split(' ').length < MIN_WORDS) { report({ idea: f, problem: 'too short', line }); continue; }
      // The same quote from the same note belongs in one idea, once, also
      // when the note was exported again under a new version.
      const dup = seen.get(`${ref}\n${q}`) || seen.get(`${name}\n${q}`);
      if (dup) { report({ idea: f, problem: `duplicate of ${dup.idea}`, line }, dup.line); continue; }
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
        out(`New: ${r.new.length}, already read: ${r.alreadyRead}${r.empty.length ? `, empty: ${r.empty.length}` : ''}${r.unreadable.length ? `, unreadable: ${r.unreadable.length}` : ''}`);
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
    const r = verify(root, o.folder, o.rest);
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

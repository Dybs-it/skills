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
// The notes folder is --folder, else the folder of the last run, kept in the
// ledger dybs/ideas/.read.json. Only .txt, .md, .srt and .vtt files directly
// in that folder count; links and subfolders are skipped. The script reads
// the notes and never changes them. It writes only the ledger, and only on
// `mark`.
// Exit code 0 = done; 1 = verify found a mention that does not hold;
// 2 = it could not run (no folder, unreadable ledger, bad arguments).

import { readFileSync, writeFileSync, readdirSync, lstatSync, mkdirSync, renameSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const LEDGER = 'dybs/ideas/.read.json';
export const PROMPT = 'dybs/transcript-prompt.txt';
export const SUPPORTED = /\.(txt|md|srt|vtt)$/i;
// - "<quote>" (<who>, <YYYY-MM-DD or date unknown>, `<file>`, asked|need)
export const MENTION = /^- "(.+)" \((.+?), (\d{4}-\d{2}-\d{2}|date unknown), `([^`]+)`, (asked|need)\)$/;

export class Stop extends Error {}

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const today = () => new Date().toISOString().slice(0, 10);

// Text as a reader sees it: no subtitle numbering, timings or voice tags,
// straight quotes, single spaces. Quotes are compared on this form, so a
// passage that wraps across lines or cues still matches; a changed word does not.
export function fold(text, name = '') {
  let t = String(text).replace(/^﻿/, '');
  if (/\.(srt|vtt)$/i.test(name)) {
    t = t.split(/\r?\n/)
      .filter((l) => !/^\s*\d+\s*$/.test(l) && !/-->/.test(l) && !/^WEBVTT\b/.test(l) && !/^(NOTE|STYLE|REGION)\b/.test(l))
      .join('\n')
      .replace(/<[^>]+>/g, ' ');
  }
  return t.replace(/[‘’‛′]/g, "'").replace(/[“”‟″]/g, '"')
    .replace(/…/g, '...').replace(/\s+/g, ' ').trim();
}

export function readLedger(root) {
  const p = join(root, LEDGER);
  if (!existsSync(p)) return { version: 1, folder: null, read: [] };
  let l;
  try { l = JSON.parse(readFileSync(p, 'utf8')); } catch {
    throw new Stop(`${LEDGER} is not valid JSON. Fix it or delete it (every note is then read again); it was not changed.`);
  }
  if (!l || l.version !== 1 || !Array.isArray(l.read)) throw new Stop(`${LEDGER} is not a version 1 ledger. It was not changed.`);
  return l;
}

function writeLedger(root, ledger) {
  const dir = join(root, 'dybs/ideas');
  mkdirSync(dir, { recursive: true });
  for (const d of [join(root, 'dybs'), dir]) {
    if (lstatSync(d).isSymbolicLink() || !lstatSync(d).isDirectory()) throw new Stop(`${d} is not a plain folder; the ledger was not written.`);
  }
  const p = join(root, LEDGER);
  if (existsSync(p) && lstatSync(p).isSymbolicLink()) throw new Stop(`${LEDGER} is a link; it was not written.`);
  const tmp = join(dir, `.read.${randomUUID()}.tmp`);
  try {
    writeFileSync(tmp, JSON.stringify(ledger, null, 2) + '\n', { flag: 'wx' });
    renameSync(tmp, p);
  } finally { rmSync(tmp, { force: true }); }
}

export function folderOf(root, given) {
  const f = given || readLedger(root).folder;
  if (!f) throw new Stop('No notes folder. Pass it: /dybs-ideas <folder> (it is remembered in dybs/ideas/.read.json).');
  const dir = resolve(root, f);
  let st;
  try { st = lstatSync(dir); } catch { throw new Stop(`The notes folder ${dir} does not exist or cannot be read.`); }
  if (!st.isDirectory()) throw new Stop(`The notes folder ${dir} is not a folder.`);
  return dir;
}

// The notes in a folder: regular files with a supported extension, by name.
export function notes(dir) {
  let names;
  try { names = readdirSync(dir); } catch { throw new Stop(`The notes folder ${dir} cannot be read.`); }
  const out = [];
  for (const name of names.sort()) {
    if (!SUPPORTED.test(name) || name.startsWith('.')) continue;
    const p = join(dir, name);
    let st;
    try { st = lstatSync(p); } catch { continue; }
    if (!st.isFile()) continue;
    const buf = readFileSync(p);
    out.push({ name, sha256: sha(buf), bytes: buf.length, empty: !buf.toString('utf8').trim() });
  }
  return out;
}

export function findNew(root, given) {
  const folder = folderOf(root, given);
  const ledger = readLedger(root);
  const known = new Set(ledger.read.map((r) => r.sha256));
  const all = notes(folder);
  const fresh = all.filter((n) => !known.has(n.sha256));
  return {
    folder,
    prompt: existsSync(join(root, PROMPT)) ? PROMPT : null,
    new: fresh.filter((n) => !n.empty).map(({ name, sha256, bytes }) => ({ name, sha256, bytes, mark: `${name}@${sha256}` })),
    empty: fresh.filter((n) => n.empty).map((n) => n.name),
    alreadyRead: all.length - fresh.length,
  };
}

export function mark(root, args, given) {
  const folder = folderOf(root, given);
  const ledger = readLedger(root);
  const here = new Map(notes(folder).map((n) => [n.name, n.sha256]));
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
  writeLedger(root, { version: 1, folder, read: [...ledger.read, ...added] });
  return { folder, marked: added.map((a) => a.name), alreadyRead: args.length - added.length };
}

// Every mention in dybs/ideas/*.md, with the problems found.
export function verify(root, given) {
  const folder = folderOf(root, given);
  const ledger = readLedger(root);
  const readNames = new Set(ledger.read.map((r) => r.name));
  const dir = join(root, 'dybs/ideas');
  const files = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.md')).sort() : [];
  const sources = new Map();
  const source = (name) => {
    if (!sources.has(name)) {
      const p = join(folder, name);
      let text = null;
      try { if (basename(name) === name && SUPPORTED.test(name) && lstatSync(p).isFile()) text = fold(readFileSync(p, 'utf8'), name); } catch { /* gone */ }
      sources.set(name, text);
    }
    return sources.get(name);
  };
  const problems = [];
  let checked = 0, unchecked = 0;
  for (const f of files) {
    const text = readFileSync(join(dir, f), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    const section = text.split(/^## Mentions[ \t]*$/m)[1];
    if (section === undefined) continue;
    const seen = new Set();
    for (const line of section.split(/^## /m)[0].split(/\r?\n/)) {
      if (!line.trim()) continue;
      const m = line.trim().match(MENTION);
      if (!m) { problems.push({ idea: f, problem: 'malformed', line: line.trim() }); continue; }
      const [, quote, , , name] = m;
      const key = `${name}\n${fold(quote)}`;
      if (seen.has(key)) { problems.push({ idea: f, problem: 'duplicate', line: line.trim() }); continue; }
      seen.add(key);
      const src = source(name);
      if (src === null) {
        // A source that was read and later removed cannot be checked again;
        // one that was never read is not a source.
        if (readNames.has(name)) unchecked++;
        else problems.push({ idea: f, problem: 'unknown source', line: line.trim() });
        continue;
      }
      checked++;
      if (!src.includes(fold(quote))) problems.push({ idea: f, problem: 'quote not in source', line: line.trim() });
    }
  }
  return { folder, ideas: files.length, checked, unchecked, problems };
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
    if (!existsSync(root) || !lstatSync(root).isDirectory()) throw new Stop(`${root} is not a folder.`);
    if (cmd === 'new') {
      const r = findNew(root, o.folder);
      if (o.json) out(JSON.stringify(r, null, 2));
      else {
        out(`Notes folder: ${r.folder}`);
        out(`New: ${r.new.length}, already read: ${r.alreadyRead}${r.empty.length ? `, empty: ${r.empty.length}` : ''}`);
        for (const n of r.new) out(`- ${n.mark}`);
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
    const r = verify(root, o.folder);
    if (o.json) out(JSON.stringify(r, null, 2));
    else {
      out(`Mentions checked: ${r.checked}, source gone: ${r.unchecked}, problems: ${r.problems.length}`);
      for (const p of r.problems) out(`- ${p.idea}: ${p.problem}: ${p.line}`);
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

#!/usr/bin/env node
// Computes the quality gate decision from a dybs/work/<task>/gate.md file.
// Usage: node dybs-gate.mjs <gate.md> [--json]
// Waivers are always judged against today's local date: there is no option to
// pick another date, so an expired waiver can never be made current again.
// Exit code 0 = PASS, CONCERNS or WAIVED; 1 = FAIL; 2 = usage or format problem.
//
// The rules live here, as code, so the decision is arithmetic rather than an
// agent's judgement. quality.md describes the same rules in words.

import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const COVERAGE = ['FULL', 'PARTIAL', 'NONE'];
export const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// A test location: a whole token `path:line`, line from 1 up. Evidence may
// list several, separated by spaces, commas or semicolons, in backticks or not.
const LOCATION_TOKEN = /^[^\s:`]+:[1-9]\d*$/;
export const hasLocation = (evidence) => (evidence || '').split(/[\s,;]+/)
  .map((t) => t.replace(/^`|`$/g, '')).some((t) => LOCATION_TOKEN.test(t));
// The risk categories quality.md defines.
export const CATEGORIES = ['security', 'data', 'business', 'performance', 'technical', 'operations'];

// What a reader of the rendered gate.md sees: HTML comments and fenced code
// are blanked out, so a hidden or example table never counts. Follows
// Markdown's rules rather than guessing: a comment or fence that is never
// closed runs to the end of the file, and a fence may be indented up to three
// spaces and closes only with the same character, at least as long.
export function visible(text) {
  const noComments = text.replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  const out = [];
  let fence = null;
  for (const line of noComments.split(/\r?\n/)) {
    const m = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (m && m[1][0] === fence.ch && m[1].length >= fence.len && m[2].trim() === '') fence = null;
      out.push('');
      continue;
    }
    // A backtick fence's info string may not contain a backtick.
    if (m && !(m[1][0] === '`' && m[2].includes('`'))) {
      fence = { ch: m[1][0], len: m[1].length };
      out.push('');
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

// "## <heading>" as Markdown renders it: indented four spaces or a tab, it
// is code, not a heading.
function isHeading(line, heading) {
  const m = line.match(/^ {0,3}##[ \t]+(.*?)[ \t]*$/);
  return Boolean(m) && m[1].toLowerCase() === heading.toLowerCase();
}

// How often "## <heading>" appears in what a reader sees.
export function headingCount(text, heading) {
  return visible(text).split(/\r?\n/).filter((l) => isHeading(l, heading)).length;
}

// The first Markdown table under "## <heading>": its lower-cased column
// names and its rows as objects keyed by them. null when the heading is
// missing or has no real table under it (a header line followed by a
// separator row). Indented lines are code, never a table.
export function tableAt(text, heading) {
  const lines = visible(text).split(/\r?\n/);
  const start = lines.findIndex((l) => isHeading(l, heading));
  if (start < 0) return null;
  // Split on unescaped pipes only; `\|` is a pipe inside a cell.
  const cellsOf = (line) => line.slice(1, /(?<!\\)\|$/.test(line) ? -1 : undefined)
    .split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
  const isSeparator = (cells) => cells.every((c) => /^:?-{3,}:?$/.test(c));
  const isIndented = (l) => /^( {4}|\t)/.test(l || '');
  const rows = [];
  let columns = null;
  let tables = 0;
  let inTable = false;
  for (let i = start + 1; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (/^ {0,3}##[ \t]/.test(raw)) break;
    const tableLine = line.startsWith('|') && !isIndented(raw);
    if (!tableLine) { inTable = false; continue; }
    if (!inTable) {
      // The start of a table: a header line followed by a separator row.
      const next = (lines[i + 1] || '').trim();
      if (isIndented(lines[i + 1]) || !next.startsWith('|') || !isSeparator(cellsOf(next))) return null;
      tables++;
      inTable = true;
      if (tables === 1) columns = cellsOf(line).map((c) => c.toLowerCase());
      i++;
      continue;
    }
    if (tables > 1) continue;
    const cells = cellsOf(line);
    if (cells.every((c) => c === '')) continue;
    rows.push(Object.fromEntries(columns.map((h, j) => [h, cells[j] ?? ''])));
  }
  return columns ? { columns, rows, tables } : null;
}

// Rows only, for callers that do not need the column names.
export function tableUnder(text, heading) {
  return tableAt(text, heading)?.rows ?? null;
}

// The columns each table must have, so a stray one-cell table is never
// read as "no rows".
export const COLUMNS = {
  Items: ['item', 'priority', 'coverage', 'evidence', 'security'],
  Risks: ['risk', 'category', 'p', 'i', 'score', 'status'],
  Waivers: ['item', 'reason', 'approved by', 'approved', 'expires'],
};

// A section that appears twice, or a column that appears twice, would let
// one copy silently override the other, so both are format problems.
function schemaProblems(text, table, heading) {
  const problems = [];
  if (headingCount(text, heading) > 1) problems.push(`"## ${heading}" appears more than once; keep one`);
  if (!table) return problems;
  if (table.tables > 1) problems.push(`the ${heading} section has more than one table; keep one`);
  const missing = COLUMNS[heading].filter((c) => !table.columns.includes(c));
  if (missing.length) problems.push(`the ${heading} table lacks column(s): ${missing.join(', ')}`);
  const twice = table.columns.filter((c, i) => c && table.columns.indexOf(c) !== i);
  if (twice.length) problems.push(`the ${heading} table has the column(s) ${[...new Set(twice)].join(', ')} more than once`);
  return problems;
}

// Security must be stated explicitly: a blank, a typo or an unfilled
// placeholder is a format problem, never a silent "no".
const SECURITY = { yes: true, y: true, true: true, no: false, n: false, false: false };
// For display only. Decisions compare whole counts, never rounded values.
const pct = (part, all) => (all === 0 ? 100 : Math.round((part / all) * 1000) / 10);
// part/all >= percent/100, in integers, so 79.95% never rounds up to 80%.
const atLeast = (part, all, percent) => part * 100 >= percent * all;

// A real calendar date in YYYY-MM-DD, not just the right shape.
export function isDate(v) {
  if (!DATE.test(v || '')) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function parseGate(text) {
  const problems = [];
  // Raw HTML can hide or show content in ways this parser does not follow
  // (<pre>, <details>, <table>). gate.md needs none, so any is refused.
  const html = visible(text).split(/\r?\n/).filter((l) => /^ {0,3}<[A-Za-z/!?]/.test(l));
  if (html.length) problems.push(`gate.md may not contain raw HTML (found: ${html[0].trim().slice(0, 40)})`);
  const itemTable = tableAt(text, 'Items');
  problems.push(...schemaProblems(text, itemTable, 'Items'));
  const itemRows = itemTable?.rows ?? null;
  if (!itemRows) problems.push('missing "## Items" table');
  else if (!itemRows.length) problems.push('the Items table is empty: a gate with nothing traced proves nothing');
  const items = (itemRows || []).map((r) => {
    const priority = (r.priority || '').toUpperCase();
    let coverage = (r.coverage || '').toUpperCase();
    const evidence = r.evidence || '';
    const notes = [];
    if (!r.item) problems.push('an item has no id');
    if (!PRIORITIES.includes(priority)) problems.push(`item ${r.item}: priority must be one of ${PRIORITIES.join('|')}`);
    if (!COVERAGE.includes(coverage)) problems.push(`item ${r.item}: coverage must be one of ${COVERAGE.join('|')}`);
    const sec = SECURITY[(r.security || '').trim().toLowerCase()];
    if (sec === undefined) problems.push(`item ${r.item}: security must be yes or no`);
    if (coverage === 'FULL' && !hasLocation(evidence)) {
      coverage = 'PARTIAL';
      notes.push('FULL without a test location (path:line) counts as PARTIAL');
    }
    return { id: r.item, priority, coverage, evidence, security: sec !== false, notes };
  });
  // The Risks table must be there, even when the analysis found no risks:
  // a missing table means the analysis is missing, not that risk is zero.
  const riskTable = tableAt(text, 'Risks');
  problems.push(...schemaProblems(text, riskTable, 'Risks'));
  const riskRows = riskTable?.rows ?? null;
  if (!riskRows) problems.push('missing "## Risks" table (keep it, with no rows, when there are no risks)');
  const risks = (riskRows || []).map((r) => {
    const score = Number(r.score);
    if (!r.risk) problems.push('a risk has no id');
    if (!Number.isInteger(score) || score < 1 || score > 9) problems.push(`risk ${r.risk}: score must be 1 to 9`);
    // The score is probability x impact (each 1 to 3); a mistyped score must
    // never turn a blocking risk into a concern.
    const p = Number(r.p);
    const im = Number(r.i);
    if (![p, im].every((n) => Number.isInteger(n) && n >= 1 && n <= 3)) problems.push(`risk ${r.risk}: P and I must each be 1 to 3`);
    else if (score !== p * im) problems.push(`risk ${r.risk}: score ${r.score} is not P x I = ${p * im}`);
    // An unknown category is a format problem and is treated as security,
    // so a typo can never make a security risk waivable.
    const category = (r.category || '').trim().toLowerCase();
    if (!CATEGORIES.includes(category)) problems.push(`risk ${r.risk}: category must be one of ${CATEGORIES.join('|')}`);
    return { id: r.risk, category: CATEGORIES.includes(category) ? category : 'security', score, open: !/^mitigated$/i.test(r.status || '') };
  });
  // Waivers are matched by id, so every id must name exactly one thing.
  const seen = new Set();
  for (const id of [...items.map((i) => i.id), ...risks.map((r) => r.id)]) {
    if (!id) continue;
    if (seen.has(id)) problems.push(`id ${id} is used more than once across items and risks; ids must be unique`);
    seen.add(id);
  }
  const waiverTable = tableAt(text, 'Waivers');
  problems.push(...schemaProblems(text, waiverTable, 'Waivers'));
  const waivers = (waiverTable?.rows || []).map((r) => ({
    id: r.item, reason: r.reason || '', by: r['approved by'] || '', approved: r.approved || '', expires: r.expires || '',
  }));
  return { items, risks, waivers, problems };
}

export function waiverIssue(w, today) {
  if (!w) return 'no waiver';
  if (!w.reason || !w.by) return 'waiver needs a reason and the name of the human who approved it';
  if (!isDate(w.approved) || !isDate(w.expires)) return 'waiver needs real approved and expires dates (YYYY-MM-DD)';
  if (w.approved > today) return `waiver approval is dated ${w.approved}, after today`;
  if (w.expires < today) return `waiver expired on ${w.expires}`;
  return null;
}

// Today as the person running the gate sees it (local time, not UTC), so a
// waiver that expires today is not already expired at 20:00 west of UTC.
export function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function decide({ items, risks, waivers }, today = localDate()) {
  const full = (list) => list.filter((i) => i.coverage === 'FULL').length;
  const p0 = items.filter((i) => i.priority === 'P0');
  const p1 = items.filter((i) => i.priority === 'P1');
  const stats = {
    items: items.length,
    overall: pct(full(items), items.length),
    p0: pct(full(p0), p0.length),
    p1: pct(full(p1), p1.length),
  };

  const fail = [];
  const concerns = [];
  const blocking = new Map(); // id -> { kind, security }
  // Security can only be added, never lost, if an id were ever blocked twice.
  const block = (x, kind) => {
    const security = x.security || x.category === 'security';
    const prev = blocking.get(x.id);
    blocking.set(x.id, { kind, security: security || Boolean(prev?.security) });
  };

  const p0Gaps = p0.filter((i) => i.coverage !== 'FULL');
  if (p0Gaps.length) {
    fail.push(`P0 not fully covered: ${p0Gaps.map((i) => i.id).join(', ')}`);
    p0Gaps.forEach((i) => block(i, 'item'));
  }
  const blockers = risks.filter((r) => r.open && r.score === 9);
  if (blockers.length) {
    fail.push(`open risk scored 9: ${blockers.map((r) => r.id).join(', ')}`);
    blockers.forEach((r) => block(r, 'risk'));
  }
  if (!atLeast(full(items), items.length, 80)) {
    fail.push(`only ${stats.overall}% of items fully covered (needs 80%)`);
    items.filter((i) => i.coverage !== 'FULL').forEach((i) => block(i, 'item'));
  }
  if (p1.length && !atLeast(full(p1), p1.length, 80)) {
    fail.push(`only ${stats.p1}% of P1 items fully covered (needs 80% to pass the floor)`);
    p1.filter((i) => i.coverage !== 'FULL').forEach((i) => block(i, 'item'));
  }
  if (p1.length && atLeast(full(p1), p1.length, 80) && !atLeast(full(p1), p1.length, 90)) concerns.push(`${stats.p1}% of P1 items fully covered (90% expected)`);
  const watch = risks.filter((r) => r.open && r.score >= 6 && r.score <= 8);
  if (watch.length) concerns.push(`open risk scored 6 to 8: ${watch.map((r) => r.id).join(', ')}`);

  const computed = fail.length ? 'FAIL' : concerns.length ? 'CONCERNS' : 'PASS';
  let decision = computed;
  const waiverProblems = [];
  if (computed === 'FAIL') {
    for (const [id, b] of blocking) {
      if (b.security) { waiverProblems.push(`${id}: security gaps are never waived`); continue; }
      // A renewal can sit below an expired waiver kept as history: the item is
      // waived when any of its rows is valid today. Otherwise report the latest.
      const rows = waivers.filter((w) => w.id === id);
      if (rows.some((w) => !waiverIssue(w, today))) continue;
      waiverProblems.push(`${id}: ${waiverIssue(rows.at(-1), today)}`);
    }
    if (!waiverProblems.length) decision = 'WAIVED';
  }
  return { decision, computed, fail, concerns, waiverProblems: computed === 'FAIL' ? waiverProblems : [], stats };
}

export function main(argv) {
  const args = argv.slice(2);
  const json = args.includes('--json');
  const unknown = args.filter((a) => a.startsWith('--') && a !== '--json');
  if (unknown.length) { console.error(`unknown option ${unknown.join(', ')}. Usage: dybs-gate.mjs <gate.md> [--json]`); return 2; }
  const today = localDate();
  const files = args.filter((a) => !a.startsWith('--'));
  if (files.length !== 1) { console.error('usage: dybs-gate.mjs <dybs/work/<task>/gate.md> [--json] (exactly one gate file)'); return 2; }
  const [file] = files;
  let text;
  try {
    text = readFileSync(resolve(file), 'utf8');
  } catch (err) {
    // Exit 1 means a computed FAIL; a gate that could not be read is not one.
    const problem = `cannot read ${file}: ${err.code || err.message}`;
    if (json) console.log(JSON.stringify({ schema: 1, decision: null, problems: [problem] }, null, 2));
    else console.error(problem);
    return 2;
  }
  const parsed = parseGate(text);
  if (parsed.problems.length) {
    if (json) console.log(JSON.stringify({ schema: 1, decision: null, problems: parsed.problems }, null, 2));
    else console.error(`gate.md has problems:\n  ${parsed.problems.join('\n  ')}`);
    return 2;
  }
  const r = decide(parsed, today);
  if (json) {
    console.log(JSON.stringify({ schema: 1, ...r, items: parsed.items }, null, 2));
  } else {
    console.log(`Decision: ${r.decision}${r.decision !== r.computed ? ` (computed ${r.computed}, waived by the human)` : ''}`);
    console.log(`Coverage: ${r.stats.overall}% overall, P0 ${r.stats.p0}%, P1 ${r.stats.p1}% (${r.stats.items} items)`);
    for (const f of r.fail) console.log(`  fail:     ${f}`);
    for (const c of r.concerns) console.log(`  concern:  ${c}`);
    for (const w of r.waiverProblems) console.log(`  waiver:   ${w}`);
    for (const i of parsed.items) for (const n of i.notes) console.log(`  note:     ${i.id}: ${n}`);
  }
  return r.decision === 'FAIL' ? 1 : 0;
}

// Run when called directly, also through a linked skill folder: Node gives
// import.meta.url as the real path, argv[1] as the path that was typed.
function calledDirectly() {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

if (calledDirectly()) {
  process.exitCode = main(process.argv);
}

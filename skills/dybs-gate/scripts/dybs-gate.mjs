#!/usr/bin/env node
// Computes the quality gate decision from a dybs/work/<task>/gate.md file.
// Usage: node dybs-gate.mjs <gate.md> [--json]
// Waivers are always judged against today's local date: there is no option to
// pick another date, so an expired waiver can never be made current again.
// Exit code 0 = PASS, CONCERNS or WAIVED; 1 = FAIL; 2 = usage or format problem;
// 3 = STALE: the evidence is not the committed state gate.md names (see
// `freshness`), so no decision is given.
//
// The rules live here, as code, so the decision is arithmetic rather than an
// agent's judgement. quality.md describes the same rules in words.

import { readFileSync, realpathSync, lstatSync, openSync, fstatSync, closeSync, constants as fsConstants } from 'node:fs';
import { resolve, dirname, relative, sep, join, basename, posix } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const COVERAGE = ['FULL', 'PARTIAL', 'NONE'];
export const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// A test location: a whole token `path:line`, line from 1 up. Evidence may
// list several, separated by spaces, commas or semicolons, in backticks or not.
// A Windows path may start with a drive (`C:\` or `C:/`).
const LOCATION_TOKEN = /^(?:[A-Za-z]:[\\/])?[^\s:`]+:[1-9]\d*$/;
export const hasLocation = (evidence) => (evidence || '').split(/[\s,;]+/)
  .map((t) => t.replace(/^`|`$/g, '')).some((t) => LOCATION_TOKEN.test(t));
// The risk categories quality.md defines.
export const CATEGORIES = ['security', 'data', 'business', 'performance', 'technical', 'operations'];

// What a reader of the rendered gate.md sees: HTML comments and fenced code
// are blanked out, so a hidden or example table never counts. Follows
// Markdown's rules rather than guessing: a comment or fence that is never
// closed runs to the end of the file, and a fence may be indented up to three
// spaces and closes only with the same character, at least as long. A
// comment counts only where it starts a line; anything else that looks like
// one (escaped, mid-line) is refused by markdownHazards(), not interpreted.
export function visible(text) {
  const out = [];
  let fence = null;
  let inComment = false;
  let inFront = false;
  const lines = text.split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    // The frontmatter block (`---` ... `---`) is not Markdown: nothing in it
    // is a heading or a table, whatever it looks like.
    // Only a delimiter at column zero is frontmatter: ` ---` is a thematic
    // break that a reader sees.
    if (n === 0 && /^---[ \t]*$/.test(line)) { inFront = true; out.push(''); continue; }
    if (inFront) { if (/^---[ \t]*$/.test(line)) inFront = false; out.push(''); continue; }
    if (inComment) {
      if (line.includes('-->')) inComment = false;
      out.push('');
      continue;
    }
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
    // Comments are judged outside code only: inside a fence `<!--` is text.
    const c = line.match(/^ {0,3}<!--/);
    if (c) {
      if (!line.slice(c[0].length).includes('-->')) inComment = true;
      out.push('');
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

// Markdown this parser does not model, refused rather than guessed at:
// a comment marker that does not start a line (escaped or inline), text
// after a comment's closing `-->`, and a fence opened inside a list item or
// a quote (its contents could still look like a table here).
export function markdownHazards(text) {
  const problems = [];
  const lines = text.split(/\r?\n/);
  let inComment = false;
  let fence = null;
  let inFront = false;
  // Whether the previous line was (part of) a real HTML comment: only then
  // is a line of = or - under it not an underline.
  let lastComment = false;
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    const prev = n ? lines[n - 1] : '';
    const prevComment = lastComment;
    lastComment = false;
    // The frontmatter block (`---` ... `---`) is not Markdown.
    if (n === 0 && /^---[ \t]*$/.test(line)) { inFront = true; continue; }
    if (inFront) { if (/^---[ \t]*$/.test(line)) inFront = false; continue; }
    if (!inComment) {
      const m = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (fence) {
        if (m && m[1][0] === fence.ch && m[1].length >= fence.len && m[2].trim() === '') fence = null;
        continue;
      }
      // An indented fence may belong to a list item (a continuation line),
      // and would then end with that item: refused rather than modelled.
      // Any depth: under `- item` four raw spaces are only two relative ones.
      if (/^[ \t]+(`{3,}|~{3,})/.test(line)) problems.push('code fences must start at the beginning of the line (no indentation)');
      if (m && !(m[1][0] === '`' && m[2].includes('`'))) { fence = { ch: m[1][0], len: m[1].length }; continue; }
    }
    if (inComment) {
      lastComment = true;
      const end = line.indexOf('-->');
      if (end < 0) continue;
      inComment = false;
      if (line.slice(end + 3).trim()) problems.push('put nothing after a comment\'s closing --> on the same line');
      continue;
    }
    // `<!-->` and `<!--->` are complete comments in CommonMark, while this
    // parser would read them as unclosed: refused rather than modelled.
    if (/<!---?>/.test(line)) problems.push('write HTML comments as <!-- ... -->, not <!--> or <!--->');
    const start = line.match(/^ {0,3}<!--/);
    if (start) {
      lastComment = true;
      const rest = line.slice(start[0].length);
      const end = rest.indexOf('-->');
      if (end < 0) { inComment = true; continue; }
      if (rest.slice(end + 3).trim()) problems.push('put nothing after a comment\'s closing --> on the same line');
      if (rest.slice(end + 3).includes('<!--')) problems.push('HTML comments must start a line of their own');
      continue;
    }
    if (line.includes('<!--')) problems.push('HTML comments must start a line of their own (no escaped or inline <!--)');
    // A heading inside a list item or quote (`- ## Archived`) still ends a
    // section on screen, so it is refused rather than modelled.
    if (/^\s*(?:(?:>|[-*+]|\d{1,9}[.)])[ \t]*)+#{1,6}([ \t]|$)/.test(line)) problems.push('headings may not sit inside a list item or a quote');
    // So does an indented one: under `10. item`, `    ## Archived` is a
    // heading inside the item. Indented headings are refused rather than
    // modelled (gate.md needs no indented code; fences are fine).
    // Measured in columns with tab stops every four: `   \t## x` reaches
    // column four just like four spaces do.
    const headLead = line.match(/^[ \t]*(?=#{1,6}([ \t]|$))/);
    if (headLead && [...headLead[0]].reduce((col, ch) => (ch === '\t' ? col + 4 - (col % 4) : col + 1), 0) >= 4) problems.push('headings may not be indented (under a list item they still render)');
    // `## **Items**` renders as Items too: headings must be plain text.
    if (/^ {0,3}#{1,6}[ \t]+.*[*_`[\]<>\\~]/.test(line)) problems.push('headings must be plain text (no *, _, `, [ ], < >, \\ or ~)');
    // `## I&#116;ems` renders as Items: a heading is matched as written, so
    // character references in one are refused rather than decoded.
    if (/^ {0,3}#{1,6}[ \t].*&[#A-Za-z0-9]+;/.test(line)) problems.push('headings may not contain character references such as &#116; or &amp;');
    // An underlined (Setext) heading ends a section on screen, so it is
    // refused rather than modelled: gate.md uses "#" and "##" headings only.
    // Only a real ATX heading or a fence line above is exempt (a real one:
    // ```` ```foo``` ```` is a code span, the line under it an underline): `#Archived`
    // (no space) is paragraph text and becomes a heading, and so does a
    // pipe line that is not a table header for a bare `---`.
    // At any indentation: under `10. item`, an indented underline still
    // makes the indented line above it a heading inside the item.
    if (/^[ \t]*(=+|-+)[ \t]*$/.test(line) && prev.trim() && !/^(#{1,6}([ \t]|$)|`{3,}[^`]*$|~{3,})/.test(prev.trimStart()) && !prevComment) {
      problems.push('use "##" headings, not underlined ones (a line of = or - under text)');
    }
    // The same inside a quote or list item (`> Archived` / `> ---`): it ends
    // the section on screen just the same, so it is refused too.
    // A list marker needs the space after it, or `> ---` would read as
    // three markers.
    const inner = (l) => l.replace(/^\s*(?:>[ \t]*|(?:[-*+]|\d{1,9}[.)])[ \t]+)+/, '');
    if (/^\s*(?:>|(?:[-*+]|\d{1,9}[.)])[ \t])/.test(line) && /^(=+|-+)[ \t]*$/.test(inner(line)) && inner(prev).trim() && !prevComment && !/^(#{1,6}([ \t]|$)|`{3,}[^`]*$|~{3,})/.test(inner(prev).trim())) {
      problems.push('use "##" headings, not underlined ones (a line of = or - under text)');
    }
    if (/^ {0,3}(?:>\s?|[-*+][ \t]+|\d{1,9}[.)][ \t]+)+(`{3,}|~{3,})/.test(line)) problems.push('gate.md may not open a code fence inside a list item or a quote');
  }
  return [...new Set(problems)];
}

// Cells of a table line, split the way Markdown does: a pipe is a cell
// boundary unless an odd number of backslashes precedes it.
export function cellsOf(line) {
  const cells = [];
  let cur = '';
  let slashes = 0;
  for (const ch of line) {
    if (ch === '|' && slashes % 2 === 0) { cells.push(cur); cur = ''; slashes = 0; continue; }
    if (ch === '|') { cur = cur.slice(0, -1) + '|'; slashes = 0; continue; }
    slashes = ch === '\\' ? slashes + 1 : 0;
    cur += ch;
  }
  cells.push(cur);
  // A leading and a trailing boundary pipe open and close the row.
  if (line.trim().startsWith('|')) cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === '' && /\|\s*$/.test(line) && !/(^|[^\\])(\\\\)*\\\|\s*$/.test(line)) cells.pop();
  return cells.map((c) => c.trim());
}

// "## <heading>" as Markdown renders it: indented four spaces or a tab, it
// is code, not a heading.
function isHeading(line, heading) {
  // An optional closing run of `#` (`## Items ##`) is not part of the text.
  const m = line.match(/^ {0,3}##[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/);
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
  const isSeparator = (cells) => cells.every((c) => /^:?-{3,}:?$/.test(c));
  const isIndented = (l) => /^( {4}|\t)/.test(l || '');
  const rows = [];
  let columns = null;
  let tables = 0;
  let inTable = false;
  let ragged = 0;
  for (let i = start + 1; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    // A section ends at the next heading of level 1 or 2: a table under a
    // new "# ..." is rendered in another section, not this one.
    if (/^ {0,3}#{1,2}([ \t]|$)/.test(raw)) break;
    const tableLine = line.startsWith('|') && !isIndented(raw);
    if (!tableLine) { inTable = false; continue; }
    if (!inTable) {
      // The start of a table: a header line followed by a separator row.
      const next = (lines[i + 1] || '').trim();
      // As in GitHub Markdown, the separator row must have exactly as many
      // cells as the header, or there is no table.
      if (isIndented(lines[i + 1]) || !next.startsWith('|') || !isSeparator(cellsOf(next))
        || cellsOf(next).length !== cellsOf(line).length) return null;
      tables++;
      inTable = true;
      if (tables === 1) columns = cellsOf(line).map((c) => c.toLowerCase());
      i++;
      continue;
    }
    if (tables > 1) continue;
    const cells = cellsOf(line);
    if (cells.every((c) => c === '')) continue;
    // Markdown drops extra cells and pads missing ones; a row that needs
    // either would be read differently here than on screen, so it is refused.
    if (cells.length !== columns.length) ragged++;
    rows.push(Object.fromEntries(columns.map((h, j) => [h, cells[j] ?? ''])));
  }
  return columns ? { columns, rows, tables, ragged } : null;
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
  if (table.ragged) problems.push(`the ${heading} table has ${table.ragged} row(s) with a different number of cells than its header`);
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

// A line with its code spans and backslash escapes removed, read the way
// CommonMark reads it, left to right: an escaped character is text, a
// backtick run opens a span only when a run of exactly the same length
// follows (`` `<x>`` `` is no span, so the tag stays raw), and inside a span
// a backslash is literal, so `` `x\` `` closes there.
export function textOutsideCodeSpans(line) {
  let out = '';
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === '\\' && /[!-\/:-@[-`{-~]/.test(line[i + 1] ?? '')) { out += 'x'; i += 2; continue; }
    if (c !== '`') { out += c; i += 1; continue; }
    let n = i;
    while (line[n] === '`') n += 1;
    const run = n - i;
    let close = -1;
    for (let j = n; j < line.length;) {
      if (line[j] !== '`') { j += 1; continue; }
      let k = j;
      while (line[k] === '`') k += 1;
      if (k - j === run) { close = k; break; }
      j = k;
    }
    if (close === -1) { out += line.slice(i, n); i = n; continue; }
    i = close;
  }
  return out;
}

export function parseGate(text) {
  const problems = [...markdownHazards(text)];
  // Raw HTML can hide or show content in ways this parser does not follow
  // (<pre>, <details>, <table>). gate.md needs none, so any is refused.
  // Also behind a list marker or a quote (`- <pre>`, `> <div>`): there it
  // still starts an HTML block that swallows what follows.
  // Anywhere in a line, not only at its start: inline HTML stays raw in
  // GFM, and `text <details>` ... `</details>` collapses what is between.
  // Code spans and escaped `\<` are text; autolinks (`<https://…>`) are not
  // tags.
  const html = visible(text).split(/\r?\n/).filter((l) => {
    const t = textOutsideCodeSpans(l);
    return /<\/?[A-Za-z][A-Za-z0-9-]*(?=[\s/>]|$)|<[!?]/.test(t);
  });
  if (html.length) problems.push(`gate.md may not contain raw HTML (found: ${html[0].trim().slice(0, 40)})`);
  // A code span that runs over a line break pairs its backticks across
  // lines, which this line-by-line reader does not follow: a backtick left
  // unpaired on a line is refused (escape a literal one as \`).
  const openSpan = visible(text).split(/\r?\n/).find((l) => textOutsideCodeSpans(l).includes('`'));
  if (openSpan !== undefined) problems.push(`code spans must open and close on the same line (found: ${openSpan.trim().slice(0, 40)})`);
  // GitHub also renders a table whose rows do not start with "|"; this parser
  // reads only rows that do. So any other visible line with an unescaped pipe
  // is refused, or a second table could be shown but never counted.
  const loose = visible(text).split(/\r?\n/)
    .filter((l) => !/^( {4}|\t)/.test(l) && !/^ {0,3}\|/.test(l) && /(^|[^\\])(\\\\)*\|/.test(l));
  if (loose.length) problems.push(`every table row must start with "|" (found: ${loose[0].trim().slice(0, 40)})`);
  // An indented row is not code everywhere: under a list item (`10. x`) it
  // still renders as a table. Indented rows are refused rather than modelled.
  const indentedRow = visible(text).split(/\r?\n/).find((l) => /^( {4,}|\t)[ \t]*\|/.test(l));
  if (indentedRow !== undefined) problems.push(`table rows may not be indented (found: ${indentedRow.trim().slice(0, 40)})`);
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
    else if (idIssue(r.item)) problems.push(`item ${r.item}: ${idIssue(r.item)}`);
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
    else if (idIssue(r.risk)) problems.push(`risk ${r.risk}: ${idIssue(r.risk)}`);
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

// An id is matched as written and shown to readers, so it must render as
// exactly its source: plain letters, digits and punctuation, no entity
// (`&nbsp;` renders blank), no Markdown or HTML (`*A1*` renders as A1 and
// would slip past the uniqueness check).
export function idIssue(v) {
  if (/&[#A-Za-z0-9]+;|[[\]<>`*~\\]|^_|_$/.test(v) || !/[\p{L}\p{N}]/u.test(v)) {
    return 'an id must be plain text with a letter or digit (no entities such as &nbsp;, no Markdown or HTML)';
  }
  return null;
}

export function waiverIssue(w, today) {
  if (!w) return 'no waiver';
  // An unfilled template value (`{{reason}}`, TODO, TBD) is no reason and no
  // name: the waiver is incomplete, so the FAIL stands.
  // Bounded by letters and digits, not \b: `_TODO_` renders as TODO, and
  // `_` is a word character to \b.
  // Checked as written and as rendered: emphasis (`T**O**DO`) and escapes
  // (`\{\{x\}\}`) split a placeholder that still reads whole.
  const placeholder = (v) => /\{\{[^}]*\}\}|(?<![\p{L}\p{N}])(?:TODO|TBD)(?![\p{L}\p{N}])/iu.test(v);
  const unfilled = (v) => placeholder(v) || placeholder(v.replace(/\\([!-/:-@[-`{-~])/g, '$1').replace(/[*_~]/g, ''));
  // Something a reader can see: an entity such as `&nbsp;` or `&#32;` is a
  // non-empty source string that renders as nothing.
  // Plain text only: Markdown or HTML can render as nothing (`[](alice)`,
  // `<span hidden>`), so a field using it is not a visible reason or name.
  const blank = (v) => /[[\]<>`]|&[#A-Za-z0-9]+;/.test(v) || !/[\p{L}\p{N}]/u.test(v);
  if (!w.reason || !w.by || unfilled(w.reason) || unfilled(w.by) || blank(w.reason) || blank(w.by)) return 'waiver needs a real reason and the name of the human who approved it';
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

// Whether gate.md's evidence is the committed state it names. Inside a git
// repository the gate decides only when nothing but this task's gate.md and
// pr.md is uncommitted, and when its `commit:` names the last commit that
// changed anything else: committing those two outputs moves HEAD but no
// evidence. Outside git nothing can be checked, and the result says so.
// Whether a `.git` entry (folder or file) sits in `dir` or above it.
function insideGitFolder(dir) {
  for (let d = resolve(dir); ; d = dirname(d)) {
    try { lstatSync(join(d, '.git')); return true; } catch { /* keep looking */ }
    if (dirname(d) === d) return false;
  }
}

export function freshness(gatePath, text) {
  const abs = resolve(gatePath);
  const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  let top;
  // Only Git's own "not a git repository" answer means there is nothing to
  // check. Git missing, or refusing the repository (safe.directory, a broken
  // .git), is never taken for that: inside a repository it is refused.
  try {
    top = execFileSync('git', ['-C', dirname(abs), 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    const said = String(e.stderr || '').trim().split('\n')[0];
    // "Not a repository" with a .git above the gate is a damaged repository.
    if (e.code !== 'ENOENT' && /not a git repository/i.test(said) && !insideGitFolder(dirname(abs))) return { status: 'unchecked', reason: 'not inside a git repository' };
    if (e.code === 'ENOENT' && !insideGitFolder(dirname(abs))) return { status: 'unchecked', reason: 'git is not installed and no .git folder is above the gate' };
    return { status: 'stale', reason: e.code === 'ENOENT'
      ? 'git is not available, so the committed evidence cannot be checked. Install git and run the gate again'
      : `git refused the repository (${said || e.message}). Fix that and run the gate again` };
  }
  const rel = (p) => relative(realpathSync(top), realpathSync(p)).split(sep).join('/');
  // The gate is a real file inside the repository: a link (to a file
  // outside, or anywhere Git does not track it as itself) can change
  // without Git noticing, so it is refused, never left unchecked.
  let isLink = false;
  try { isLink = lstatSync(abs).isSymbolicLink(); } catch { isLink = false; }
  if (isLink) return { status: 'stale', reason: 'gate.md is a symbolic link. Keep the gate as a real file in the repository' };
  let gateRel;
  try { gateRel = rel(abs); } catch (e) {
    return { status: 'stale', reason: `gate.md could not be resolved while it was checked (${e.code || e.message}). Run the gate again` };
  }
  if (gateRel === '..' || gateRel.startsWith('../') || resolve(gateRel) === gateRel) {
    return { status: 'stale', reason: 'gate.md resolves outside the repository. Keep the gate as a real file in the repository' };
  }
  // Only the task's own gate is exempt from the dirty check below, so any
  // other file (an audit.md, a gate.md elsewhere) is refused, not judged.
  if (!/(^|\/)dybs\/work\/[^/]+\/gate\.md$/.test(gateRel)) {
    return { status: 'stale', reason: `${gateRel} is not a task gate. The gate is dybs/work/<task>/gate.md` };
  }
  const prRel = `${gateRel.slice(0, gateRel.lastIndexOf('/') + 1)}pr.md`;
  // The tests cited as FULL evidence, as repository paths: the project
  // root is the folder holding dybs/, and evidence is relative to it.
  const rootRel = gateRel.slice(0, gateRel.lastIndexOf('dybs/work/'));
  const cited = [];
  for (const item of parseGate(text).items) {
    if (item.coverage !== 'FULL') continue;
    for (const t of item.evidence.split(/[\s,;]+/).map((x) => x.replace(/^`|`$/g, ''))) {
      if (!LOCATION_TOKEN.test(t)) continue;
      const file = t.slice(0, t.lastIndexOf(':')).replace(/\\/g, '/');
      const inRepo = posix.normalize(`${rootRel}${file}`);
      if (/^[A-Za-z]:\//.test(file) || file.startsWith('/') || inRepo === '..' || inRepo.startsWith('../')) {
        return { status: 'stale', reason: `cited evidence ${file} is outside the repository, so no commit holds it. Cite tests inside the repository and run the gate again` };
      }
      cited.push(inRepo);
    }
  }
  // NUL-separated porcelain: paths come unquoted (no C escapes for
  // non-ASCII names), and a rename lists both of its paths. Submodules are
  // always looked into: `ignore = all` in .gitmodules or config must not
  // hide changed evidence inside one.
  const dirty = () => {
    let raw;
    try {
      raw = execFileSync('git', ['-C', top, 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      const said = String(e.stderr || '').trim().split('\n')[0];
      return { status: 'stale', reason: `git could not read the working tree (${said || e.message}). Fix the repository and run the gate again` };
    }
    const entries = raw.split('\0');
    const paths = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!e) continue;
      paths.push(e.slice(3));
      if (e[0] === 'R' || e[0] === 'C') paths.push(entries[++i]);
    }
    const changed = paths.filter((f) => f && f !== gateRel && f !== prRel);
    if (changed.length) return { status: 'stale', reason: `uncommitted changes besides gate.md and pr.md: ${changed.slice(0, 5).join(', ')}${changed.length > 5 ? ', …' : ''}. Commit the evidence first` };
    // `git status` is blind to a tracked file flagged assume-unchanged or
    // skip-worktree: its edits never show above. Such a file cannot be
    // vouched for, so it makes the evidence stale (a lowercase tag from
    // `ls-files -v` is assume-unchanged, `S` is skip-worktree).
    let listed;
    try {
      listed = execFileSync('git', ['-C', top, 'ls-files', '-v', '-z'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      const said = String(e.stderr || '').trim().split('\n')[0];
      return { status: 'stale', reason: `git could not list the tracked files (${said || e.message}). Fix the repository and run the gate again` };
    }
    const hidden = listed.split('\0').filter((e) => e && (/^[a-z]/.test(e) || e[0] === 'S')).map((e) => e.slice(2)).filter((f) => f !== gateRel && f !== prRel);
    if (hidden.length) return { status: 'stale', reason: `tracked files git status cannot see changes in (assume-unchanged or skip-worktree): ${hidden.slice(0, 5).join(', ')}${hidden.length > 5 ? ', …' : ''}. Clear those flags (git update-index --no-assume-unchanged --no-skip-worktree) and run the gate again` };
    // An ignored file never shows in `git status` and, untracked, not in
    // `ls-files` either: a test cited as FULL evidence that Git ignores is
    // not in any commit, so it is refused (check-ignore skips tracked files).
    if (cited.length) {
      let ignored = '';
      try {
        ignored = execFileSync('git', ['-C', top, 'check-ignore', '-z', '--stdin'], { encoding: 'utf8', input: cited.join('\0'), stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (e) {
        if (e.status !== 1) {
          const said = String(e.stderr || '').trim().split('\n')[0];
          const linked = said.match(/pathspec '(.*)' is beyond a symbolic link/);
          if (linked) return { status: 'stale', reason: `cited evidence reached through a link, so no commit holds the test itself: ${linked[1]}. Cite the test file in its real folder and run the gate again` };
          return { status: 'stale', reason: `git could not check the cited evidence (${said || e.message}). Fix the repository and run the gate again` };
        }
      }
      const which = ignored.split('\0').filter(Boolean);
      if (which.length) return { status: 'stale', reason: `cited evidence that git ignores, so no commit holds it: ${which.slice(0, 5).join(', ')}${which.length > 5 ? ', …' : ''}. Commit the tests (or stop ignoring them) and run the gate again` };
    }
    return null;
  };
  const before = dirty();
  if (before) return before;
  let head;
  // Literal: a task folder named with `*` or `?` must exclude only its own
  // gate.md and pr.md, never other tasks' (pathspec magic would match them).
  const evidenceHead = () => git(top, ['log', '-1', '--format=%H', '--', '.', `:(exclude,literal)${gateRel}`, `:(exclude,literal)${prRel}`]);
  // Git failing here is never "nothing to check": it is refused.
  try { head = evidenceHead(); } catch {
    return { status: 'stale', reason: 'git could not read the history of the evidence. Fix the repository and run the gate again' };
  }
  // Inside a repository the gate needs committed evidence: with nothing
  // but gate.md and pr.md ever committed, there is nothing to decide on.
  if (!head) return { status: 'stale', reason: 'no commit holds the evidence yet. Commit the work, set commit: to that commit, and run the gate again' };
  // `commit:` counts only in the opening frontmatter, never in the body.
  const fm = (text.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/) || [])[1] ?? '';
  // Exactly one: with two, readers disagree on which evidence is named.
  const commits = [...fm.matchAll(/^commit:[ \t]*(.*?)[ \t]*$/gm)];
  if (commits.length > 1) return { status: 'stale', reason: 'gate.md names commit: more than once. Keep one, set to the evidence commit, and run the gate again' };
  const field = (commits[0] || [])[1] || '';
  let named = '';
  // Up to 64 hex digits: a SHA-256 repository names commits that long.
  if (/^[0-9a-f]{4,64}$/i.test(field)) {
    try { named = git(top, ['rev-parse', '--verify', '--quiet', `${field}^{commit}`]); } catch { named = ''; }
  }
  const short = head.slice(0, 7);
  if (named !== head) {
    return { status: 'stale', head: short, reason: `gate.md says commit: ${field || '(not set)'}, but the evidence is at ${short}. Check the tables against ${short}, set commit: ${short}, and run the gate again` };
  }
  // Every test cited as FULL evidence must be in the evidence commit
  // itself, as a regular file: a path the commit lacks proves nothing, and
  // a link stores only where it points, not the tests that were reviewed
  // (a folder on the way that is a link leaves the path missing too).
  if (cited.length) {
    let listed;
    try {
      listed = execFileSync('git', ['--literal-pathspecs', '-C', top, 'ls-tree', '-z', '--full-tree', head, '--', ...new Set(cited)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      const said = String(e.stderr || '').trim().split('\n')[0];
      return { status: 'stale', head: short, reason: `git could not list the cited evidence in ${short} (${said || e.message}). Fix the repository and run the gate again` };
    }
    const files = new Map();
    for (const entry of listed.split('\0')) {
      const tab = entry.indexOf('\t');
      if (tab > 0) files.set(entry.slice(tab + 1), entry.slice(0, entry.indexOf(' ')));
    }
    const missing = [...new Set(cited)].filter((f) => !files.has(f));
    if (missing.length) return { status: 'stale', head: short, reason: `cited evidence not in commit ${short}: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''}. Commit the tests, or cite the tests that prove the item, and run the gate again` };
    const notFiles = [...new Set(cited)].filter((f) => !['100644', '100755'].includes(files.get(f)));
    if (notFiles.length) return { status: 'stale', head: short, reason: `cited evidence that is not a regular file in commit ${short} (a link or a folder): ${notFiles.slice(0, 5).join(', ')}${notFiles.length > 5 ? ', …' : ''}. Cite the test file itself and run the gate again` };
  }
  // Checked once more: a file saved or a commit made while git ran above
  // would otherwise go unseen. The history query cannot see the tree, so
  // the tree is checked after it, last of all. What is left is the instant
  // between that and the decision, which then describes the tree as it was.
  const after = dirty();
  if (after) return after;
  let again = null;
  try { again = evidenceHead(); } catch { again = null; }
  if (again !== head) return { status: 'stale', head: short, reason: 'the evidence changed while the gate was checking it. Run the gate again' };
  const last = dirty();
  if (last) return last;
  // `git status` compares with HEAD, so a commit made while it ran leaves
  // it clean. Last of all, the tracked tree is compared with the fixed
  // evidence commit itself: an edit or a commit since shows either way.
  let since;
  try {
    since = execFileSync('git', ['-C', top, 'diff', '--name-only', '-z', '--no-ext-diff', '--ignore-submodules=none', head, '--', '.', `:(exclude,literal)${gateRel}`, `:(exclude,literal)${prRel}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const said = String(e.stderr || '').trim().split('\n')[0];
    return { status: 'stale', reason: `git could not compare the tree with the evidence commit (${said || e.message}). Fix the repository and run the gate again` };
  }
  if (since.split('\0').some(Boolean)) return { status: 'stale', head: short, reason: 'the evidence changed while the gate was checking it. Run the gate again' };
  return { status: 'fresh', head: short };
}

// Reads gate.md without blocking on a FIFO or a device: opened non-blocking
// and judged on the open descriptor, so only a regular file is read.
// Never through a link at its own name (O_NOFOLLOW), and only while the
// opened file is what the name itself is (no link followed, same device
// and inode): a gate swapped for a link mid-check is no input at all.
// With `id` (from pinPath), only that very file is read: O_NOFOLLOW guards
// the name alone, so a folder on the way swapped for a link during the open
// would hand over another file, which the descriptor's identity shows.
function readGate(p, id) {
  const fd = gateFs.open(p, fsConstants.O_RDONLY | (fsConstants.O_NONBLOCK ?? 0) | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const st = fstatSync(fd, { bigint: true });
    if (!st.isFile()) throw Object.assign(new Error('not a regular file'), { code: 'not a regular file' });
    const own = lstatSync(p, { bigint: true });
    if (own.isSymbolicLink() || own.dev !== st.dev || own.ino !== st.ino) throw Object.assign(new Error('not a regular file'), { code: 'not a regular file' });
    if (id !== undefined && `${st.dev}:${st.ino}:${st.birthtimeNs}` !== id) throw Object.assign(new Error('a folder on the way changed'), { code: 'a folder on the way changed' });
    return readFileSync(fd, 'utf8');
  } finally { closeSync(fd); }
}

// Where the gate really is, and the identity of every folder on the way
// from the filesystem root, none of them a link. Taken at the first read and
// required again at the last: a task folder reached through a link and
// retargeted meanwhile (to a copy with the same bytes) gets no decision.
// A folder removed and recreated can get the very same inode back, so each
// identity carries its birth time too (nanoseconds, where the filesystem
// records one).
export const gateFs = { lstat: lstatSync, open: openSync, realpath: realpathSync };
function pinPath(p) {
  const real = gateFs.realpath(p);
  const ids = [];
  for (let cur = real; dirname(cur) !== cur;) {
    cur = dirname(cur);
    const st = gateFs.lstat(cur, { bigint: true });
    if (st.isSymbolicLink() || !st.isDirectory()) return null;
    ids.push(`${st.dev}:${st.ino}:${st.birthtimeNs}`);
  }
  // The gate itself too: every read must be this very file.
  const own = gateFs.lstat(real, { bigint: true });
  if (own.isSymbolicLink() || !own.isFile()) throw Object.assign(new Error('not a regular file'), { code: 'not a regular file' });
  return { real, chain: ids.join('/'), id: `${own.dev}:${own.ino}:${own.birthtimeNs}` };
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
  if (basename(file) !== 'gate.md') { console.error(`${file} is not a gate. Usage: dybs-gate.mjs <dybs/work/<task>/gate.md> [--json]`); return 2; }
  let text;
  let pin;
  try {
    // Pinned first, then read only as the pinned file, then pinned again:
    // checks around a read alone would pass a read made through a folder
    // swapped for a link and back in between.
    pin = pinPath(resolve(file));
    if (!pin) throw Object.assign(new Error('a folder on the way changed'), { code: 'a folder on the way changed' });
    text = readGate(resolve(file), pin.id);
    const again = pinPath(resolve(file));
    if (!again || again.real !== pin.real || again.chain !== pin.chain || again.id !== pin.id) throw Object.assign(new Error('a folder on the way changed'), { code: 'a folder on the way changed' });
  } catch (err) {
    // A link at the gate's name is the freshness rule's to explain: Git
    // cannot see the file it points to change.
    let link = false;
    try { link = lstatSync(resolve(file)).isSymbolicLink(); } catch { link = false; }
    if (link) {
      const reason = 'gate.md is a symbolic link. Keep the gate as a real file in the repository';
      if (json) console.log(JSON.stringify({ schema: 1, decision: null, stale: reason, problems: [] }, null, 2));
      else console.error(`STALE: ${reason}.`);
      return 3;
    }
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
  // No decision on evidence that is not the committed state gate.md names.
  let fresh;
  try { fresh = freshness(file, text); } catch (err) {
    // Exit 1 is a computed FAIL; a check that could not run is no decision.
    const problem = `the freshness check could not run: ${err.code || err.message}`;
    if (json) console.log(JSON.stringify({ schema: 1, decision: null, problems: [problem] }, null, 2));
    else console.error(problem);
    return 2;
  }
  if (fresh.status === 'stale') {
    if (json) console.log(JSON.stringify({ schema: 1, decision: null, stale: fresh.reason, problems: [] }, null, 2));
    else console.error(`STALE: ${fresh.reason}.`);
    return 3;
  }
  // gate.md itself is exempt from the dirty check, so an edit saved while
  // git ran would go unseen: the decision is only for the bytes still there.
  let after = null;
  const same = () => { const now = pinPath(resolve(file)); return Boolean(now) && now.real === pin.real && now.chain === pin.chain && now.id === pin.id; };
  try { after = same() ? readGate(pin.real, pin.id) : null; if (!same()) after = null; } catch { after = null; }
  if (after !== text) {
    const problem = `${file} changed while it was being checked; run the gate again`;
    if (json) console.log(JSON.stringify({ schema: 1, decision: null, problems: [problem] }, null, 2));
    else console.error(problem);
    return 2;
  }
  const r = decide(parsed, today);
  if (json) {
    console.log(JSON.stringify({ schema: 1, ...r, freshness: fresh, items: parsed.items }, null, 2));
  } else {
    console.log(`Decision: ${r.decision}${r.decision !== r.computed ? ` (computed ${r.computed}, waived by the human)` : ''}`);
    console.log(`Coverage: ${r.stats.overall}% overall, P0 ${r.stats.p0}%, P1 ${r.stats.p1}% (${r.stats.items} items)`);
    for (const f of r.fail) console.log(`  fail:     ${f}`);
    for (const c of r.concerns) console.log(`  concern:  ${c}`);
    for (const w of r.waiverProblems) console.log(`  waiver:   ${w}`);
    for (const i of parsed.items) for (const n of i.notes) console.log(`  note:     ${i.id}: ${n}`);
    if (fresh.status === 'unchecked') console.log(`  note:     freshness not checked (${fresh.reason})`);
    else console.log(`  evidence: commit ${fresh.head}`);
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

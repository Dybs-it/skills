#!/usr/bin/env node
// Validates a project's dybs/ folder against the Getting Started contract.
// Usage: node dybs-validate.mjs [projectRoot] [--doc <name>] [--json]
// Exit code 0 = no errors (warnings allowed), 1 = errors, 2 = usage problem.
//
// This file is the single home for the doc contract (required sections and
// length caps). Templates and skills must agree with DOCS below.

import { readFileSync, existsSync, statSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DOCS = {
  project: {
    file: 'project.md',
    maxWords: 250,
    sections: ['Why', 'Who', 'Now'],
  },
  prd: {
    file: 'context/prd.md',
    maxWords: 900,
    sections: ['Problem', 'Users', 'Goals', 'Requirements', 'Success measures', 'Open questions'],
  },
  scope: {
    file: 'context/scope.md',
    maxWords: 450,
    sections: ['In', 'Out', 'Later', 'Constraints'],
  },
  domain: {
    file: 'context/domain.md',
    maxWords: 700,
    sections: ['Glossary', 'Rules'],
  },
  architecture: {
    file: 'context/architecture.md',
    maxWords: 900,
    sections: ['Shape', 'Decisions', 'Boundaries', 'Quality bars'],
  },
  ux: {
    file: 'context/ux.md',
    maxWords: 700,
    sections: ['Principles', 'Key flows', 'Behaviour rules', 'Accessibility'],
  },
  ui: {
    file: 'context/ui.md',
    maxWords: 700,
    sections: ['Tone', 'Tokens', 'Components', 'Do and don\'t'],
  },
};

export const ORDER = ['project', 'prd', 'scope', 'domain', 'architecture', 'ux', 'ui'];
export const STATUSES = ['draft', 'accepted'];
// The same rules in words, for an agent checking a doc by hand when the
// validator is not installed. Every id here is enforced in validateDoc, and
// tests keep the skills' standalone sections in step with this list.
export const MANUAL_RULES = [
  { id: 'frontmatter', text: 'The doc starts with a frontmatter block between two `---` lines.' },
  { id: 'doc-name', text: 'Frontmatter `doc` is exactly this doc\'s name (for example `doc: prd`).' },
  { id: 'status', text: 'Frontmatter `status` is `draft` or `accepted`, nothing else.' },
  { id: 'updated', text: 'Frontmatter `updated` is a date written as YYYY-MM-DD.' },
  { id: 'accepted-date', text: 'An `accepted` doc also has `accepted: YYYY-MM-DD`, set only on the human\'s word.' },
  { id: 'sections', text: 'Every required `##` section is present (see the template or the doc contract).' },
  { id: 'cap', text: 'The doc is under its word cap, not counting HTML comments and code blocks.' },
  { id: 'html', text: 'No raw HTML blocks (a line outside code that starts with an HTML tag such as `<pre>` or `<div>`, or with `<?`, `<!` or `<![CDATA[`): they change what renders in ways a reader of the source cannot see. HTML comments are fine.' },
  { id: 'placeholder', text: 'No `{{...}}`, TODO or TBD outside HTML comments. In a draft this is a warning; in an accepted doc it is an error.' },
];

const PLACEHOLDER = /\{\{[^}]*\}\}|\bTODO\b|\bTBD\b/;

export function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: null, body: text };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (kv) data[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return { data, body: text.slice(m[0].length) };
}

// A real calendar date in YYYY-MM-DD, not just the right shape.
export function isDate(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

// A closing backtick run of exactly `run`'s length.
const closer = (run) => new RegExp(`(?<!\`)${run}(?!\`)`);

// One line with HTML comments removed, except inside inline code spans,
// where `<!--` is literal text. A code span may continue onto later lines of
// the same paragraph: `st.span` carries its open run from line to line, and
// `closesLater(run)` says whether a later line of the paragraph closes it
// (an opener that is never closed is a literal backtick, not a span). `open`
// is true when a comment starts here and does not close on this line.
function stripComments(line, st, closesLater) {
  let out = '';
  let i = 0;
  if (st.span) {
    const close = line.search(closer(st.span));
    if (close < 0) return { text: line, open: false };
    i = close + st.span.length;
    out = line.slice(0, i);
    st.span = null;
  }
  while (i < line.length) {
    if (line[i] === '`') {
      const run = line.slice(i).match(/^`+/)[0];
      const close = line.slice(i + run.length).search(closer(run));
      if (close >= 0) {
        const endAt = i + run.length + close + run.length;
        out += line.slice(i, endAt);
        i = endAt;
      } else if (closesLater(run)) {
        st.span = run;
        return { text: out + line.slice(i), open: false };
      } else {
        out += run;
        i += run.length;
      }
      continue;
    }
    // `\<!--` is an escaped `<`: literal text, not a comment.
    if (line[i] === '\\') {
      out += line.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (line.startsWith('<!--', i)) {
      const end = line.indexOf('-->', i + 4);
      if (end < 0) return { text: out, open: true };
      i = end + 3;
      continue;
    }
    out += line[i++];
  }
  return { text: out, open: false };
}

// How many block quotes a line sits in (`> > x` is two).
function quoteDepth(line) {
  const prefix = line.match(/^(?: {0,3}>[ \t]?)+/);
  return prefix ? (prefix[0].match(/>/g) || []).length : 0;
}

// What a reader sees: HTML comments and code blocks dropped, by Markdown's
// rules, in one pass so each construct is judged where it actually occurs:
// `<!--` inside a fence, an indented block or a code span is text, not a
// comment. A fence closes only with the same character, at least as long as
// it opened, so a ```` block may hold ``` lines; an unclosed comment or fence
// runs to the end. An indented code block (four spaces or a tab) starts only
// after a blank line and outside a list, since an indented line there
// continues a paragraph or a list item instead.
// With `keepCode`, code stays in (only comments are dropped): placeholders in
// code still count, as the rule exempts HTML comments alone.
export function visibleText(body, { keepCode = false } = {}) {
  const out = [];
  let fence = null;
  let indented = false;
  let inList = false;
  // Where a list item's content starts (2 under `- `, 4 under `10. `): an
  // indented code block inside it sits four columns past that.
  let listIndent = 0;
  let prevBlank = true;
  let inComment = false;
  const st = { span: null };
  const lines = body.split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    let line = lines[n];
    // A code span stays inside its paragraph: a blank line, a fence, a
    // heading, a list item or a deeper block quote ends the paragraph, and
    // with it any chance to close. Each is judged after the line's `>`
    // markers, so a quoted heading ends it too.
    const closesLater = (run) => {
      const depth = quoteDepth(lines[n]);
      for (let k = n + 1; k < lines.length; k++) {
        const rest = lines[k].replace(/^(?: {0,3}>[ \t]?)+/, '');
        if (rest.trim() === '' || quoteDepth(lines[k]) > depth) return false;
        if (/^ {0,3}(`{3,}|~{3,}|#{1,6}([ \t]|$)|[-*+][ \t]+\S|\d{1,9}[.)][ \t]+\S)/.test(rest)) return false;
        if (closer(run).test(lines[k])) return true;
      }
      return false;
    };
    if (inComment) {
      const end = line.indexOf('-->');
      if (end < 0) continue;
      inComment = false;
      line = line.slice(end + 3);
    }
    // Inside a block quote, blankness and indentation are judged after the
    // `>` markers: `>` alone is a blank line, `>     x` is indented code.
    const inner = line.replace(/^(?: {0,3}>[ \t]?)+/, '');
    const blank = inner.trim() === '';
    if (blank) st.span = null;
    const isIndented = /^( {4}|\t)/.test(inner);
    if (indented) {
      if (blank || isIndented) { prevBlank = blank; if (keepCode) out.push(line); continue; }
      indented = false;
    }
    // A fence may sit in a block quote or start a list item (`> ```` or
    // `- ```js`); the container prefix does not hide it.
    // Inside a list item, the item's content indent comes first (four
    // spaces under `10. `), then the usual up-to-three.
    const lead0 = line.match(/^ */)[0].length;
    const body0 = inList ? line.slice(Math.min(lead0, listIndent)) : line;
    // After each quote or list marker the fence may again be indented up
    // to three spaces (`>  ```` is a fence inside a quote).
    const m = body0.match(/^ {0,3}(?:(?:>[ \t]?|[-*+][ \t]+|\d{1,9}[.)][ \t]+) {0,3})*(`{3,}|~{3,})(.*)$/);
    // A fence lives in the container it opened in: a line outside that
    // block quote or list item ends the container, and the fence with it
    // (no lazy continuation for code), so the line is read afresh: a bare
    // ``` after `> ```` opens a new fence rather than closing the quoted one.
    if (fence && !blank && (quoteDepth(line) < fence.quote || inner.match(/^ */)[0].length < fence.col)) fence = null;
    if (fence) {
      // Inside a list item the closing fence sits at the item's content
      // indent (four spaces under `10. `), so it may be indented up to three
      // spaces past where the opening fence started.
      const c = line.match(/^( *)((?:>[ \t]?)*) {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (c && c[1].length <= fence.indent + 3 && quoteDepth(line) === fence.quote && c[3][0] === fence.ch && c[3].length >= fence.len) fence = null;
      if (keepCode) out.push(line);
      continue;
    }
    if (m && !(m[1][0] === '`' && m[2].includes('`'))) {
      const at = line.length - m[1].length - m[2].length;
      // The column where the fence's list item content starts, past its
      // quote markers: the last list marker before the fence, or the
      // current item's indent when the fence continues one.
      const pre = line.slice(0, at).replace(/^(?: {0,3}>[ \t]?)+/, '');
      const marks = [...pre.matchAll(/(?:[-*+]|\d{1,9}[.)])[ \t]+/g)];
      const col = marks.length ? marks.at(-1).index + marks.at(-1)[0].length : inList && at >= listIndent ? listIndent : 0;
      fence = { ch: m[1][0], len: m[1].length, indent: at, quote: quoteDepth(line), col };
      prevBlank = false;
      if (keepCode) out.push(line);
      continue;
    }
    const lead = line.match(/^ */)[0].length;
    const codeAt = inList ? listIndent + 4 : 4;
    if (!blank && (isIndented && !inList || inList && lead >= codeAt) && prevBlank) {
      indented = true;
      prevBlank = false;
      if (keepCode) out.push(line);
      continue;
    }
    const stripped = stripComments(line, st, closesLater);
    inComment = stripped.open;
    line = stripped.text;
    const nowBlank = line.replace(/^(?: {0,3}>[ \t]?)+/, '').trim() === '';
    if (!nowBlank && !/^( {4}|\t)/.test(line)) {
      const item = line.match(/^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$)/);
      if (item) listIndent = item[0].length;
      inList = Boolean(item) || (inList && !prevBlank);
    }
    prevBlank = nowBlank;
    out.push(line);
  }
  return out.join('\n');
}

// Headings a reader sees: none inside HTML comments or fenced examples.
// An optional closing run of `#` (`## Goals ##`) is not part of the text.
export function headings(body) {
  return [...visibleText(body).matchAll(/^ {0,3}##[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/gm)].map((h) => h.at(1));
}

export function wordCount(body) {
  // Count prose only: what a reader sees, without HTML comments (template
  // guidance) or fenced code (``` or ~~~), by the same rules as headings.
  const prose = visibleText(body);
  return (prose.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
}

function skipped(projectData) {
  // project.md may declare `skip: ui, ux` for docs that do not apply.
  const raw = projectData?.skip || '';
  return new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
}

export function validateDoc(name, text) {
  const spec = DOCS[name];
  const errors = [];
  const warnings = [];
  const rules = new Set();
  const fail = (id, msg) => { rules.add(id); errors.push(msg); };
  const { data, body } = parseFrontmatter(text);

  if (!data) {
    fail('frontmatter', 'missing frontmatter (--- block at the top)');
  } else {
    if (data.doc !== name) fail('doc-name', `frontmatter "doc" must be "${name}" (found "${data.doc ?? ''}")`);
    if (!STATUSES.includes(data.status)) fail('status', `frontmatter "status" must be one of ${STATUSES.join('|')}`);
    if (!isDate(data.updated)) fail('updated', 'frontmatter "updated" must be a real date, YYYY-MM-DD');
    if (data.status === 'accepted' && !isDate(data.accepted)) {
      fail('accepted-date', 'accepted docs need frontmatter "accepted: YYYY-MM-DD" (set only on the human\'s word)');
    }
  }

  // Raw HTML blocks hide or show Markdown (a heading inside <pre> is not a
  // heading), so they are refused rather than interpreted.
  // Every CommonMark raw-block opener: a tag, a processing instruction
  // (`<?`), a declaration (`<!DOCTYPE`) or CDATA. Comments are already gone.
  // A block quote or list item does not hide one (`> <div>`, `- <pre>`), and
  // neither does the indentation of a list item's content.
  const html = visibleText(body).split('\n').find((l) => /^\s*(?:(?:>|[-*+]|\d{1,9}[.)])[ \t]*)*(?:<\/?[A-Za-z][A-Za-z0-9-]*(?:[\s/>]|$)|<\?|<![A-Za-z]|<!\[CDATA\[)/.test(l));
  if (html !== undefined) fail('html', `raw HTML is not allowed (found: ${html.trim().slice(0, 40)}); use Markdown`);

  const found = headings(body);
  const missing = spec.sections.filter((s) => !found.some((h) => h.toLowerCase() === s.toLowerCase()));
  for (const s of missing) fail('sections', `missing section "## ${s}"`);

  const words = wordCount(body);
  if (words > spec.maxWords) {
    fail('cap', `${words} words, cap is ${spec.maxWords}. Cut, or move detail to context/decisions/`);
  } else if (words > spec.maxWords * 0.9) {
    warnings.push(`${words} words, close to the cap of ${spec.maxWords}`);
  }

  if (PLACEHOLDER.test(visibleText(body, { keepCode: true }))) {
    const msg = 'unfilled placeholder ({{...}}, TODO or TBD)';
    if (data?.status === 'accepted') fail('placeholder', msg);
    else warnings.push(msg);
  }

  return { name, file: spec.file, status: data?.status ?? null, words, errors, warnings, rules: [...rules] };
}

export function validateProject(root, only) {
  const dir = join(root, 'dybs');
  const results = [];
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return { ok: false, complete: false, accepted: false, fatal: `no dybs/ folder in ${root}. Run the dybs-start skill first.`, results };
  }
  if (!existsSync(join(dir, 'README.md'))) {
    results.push({ name: 'readme', file: 'README.md', status: null, words: 0,
      errors: ['missing dybs/README.md (the method rules). Run dybs-start to restore it.'], warnings: [] });
  }

  const projectPath = join(dir, DOCS.project.file);
  const projectData = existsSync(projectPath) ? parseFrontmatter(readFileSync(projectPath, 'utf8')).data : null;
  const skip = skipped(projectData);

  for (const name of ORDER) {
    // project.md is always loaded: it holds the settings every other doc is
    // checked against, so `--doc <other>` checks it too.
    if (only && name !== only && name !== 'project') continue;
    const spec = DOCS[name];
    const path = join(dir, spec.file);
    // project.md holds the settings, so it can never skip itself.
    if (skip.has(name) && name !== 'project') {
      results.push({ name, file: spec.file, status: 'skipped', words: 0, errors: [], warnings: [] });
      continue;
    }
    if (!existsSync(path)) {
      // A doc asked for by name must exist: `--doc` passing is the check
      // before a check-in, and "it is not there" is not a pass.
      const errors = only && (only === name || name === 'project') ? [`${spec.file} does not exist yet`] : [];
      results.push({ name, file: spec.file, status: 'missing', words: 0, errors, warnings: [] });
      continue;
    }
    results.push(validateDoc(name, readFileSync(path, 'utf8')));
  }
  // ok: no rule is broken (missing and draft docs are allowed).
  // complete: every doc that is not skipped exists and is ok.
  // accepted: complete, and the human accepted every doc.
  const ok = results.every((r) => r.errors.length === 0);
  const docs = results.filter((r) => r.status !== 'skipped' && r.name !== 'readme');
  const complete = ok && !only && docs.every((r) => r.status !== 'missing');
  const accepted = complete && docs.every((r) => r.status === 'accepted');
  return { ok, complete, accepted, results };
}

function nextStep(results) {
  const pending = results.find((r) => r.status === 'missing' || r.status === 'draft' || r.errors.length);
  return pending ? pending.name : null;
}

export function main(argv) {
  const args = argv.slice(2);
  const json = args.includes('--json');
  const docIdx = args.indexOf('--doc');
  const only = docIdx >= 0 ? args[docIdx + 1] : undefined;
  if (only && !DOCS[only]) {
    console.error(`unknown doc "${only}". Known: ${ORDER.join(', ')}`);
    return 2;
  }
  const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--doc');
  const root = resolve(positional[0] || '.');
  let report;
  try {
    report = validateProject(root, only);
  } catch (err) {
    // A read failure (a folder where a doc should be, permissions) is still
    // reported in the requested format, never as a bare exception.
    if (!json) throw err;
    report = { ok: false, complete: false, accepted: false, fatal: `could not read the project: ${err.message}`, results: [] };
  }

  if (json) {
    console.log(JSON.stringify({ schema: 1, ...report, next: nextStep(report.results) }, null, 2));
    return report.ok ? 0 : 1;
  }
  if (report.fatal) {
    console.error(report.fatal);
    return 1;
  }
  for (const r of report.results) {
    const tag = r.errors.length ? 'FAIL' : r.status === 'missing' || r.status === 'skipped' ? r.status.toUpperCase() : r.status?.toUpperCase();
    console.log(`${tag.padEnd(9)} ${r.file}${r.words ? `  (${r.words} words)` : ''}`);
    for (const e of r.errors) console.log(`          error: ${e}`);
    for (const w of r.warnings) console.log(`          warn:  ${w}`);
  }
  const next = nextStep(report.results);
  console.log(next ? `\nNext: ${next}` : '\nAll Getting Started docs accepted.');
  return report.ok ? 0 : 1;
}

// Run when called directly, also through a linked skill folder: Node gives
// import.meta.url as the real path, argv[1] as the path that was typed.
function calledDirectly() {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

if (calledDirectly()) {
  process.exit(main(process.argv));
}

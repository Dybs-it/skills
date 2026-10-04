#!/usr/bin/env node
// Validates a project's dybs/ folder against the Getting Started contract.
// Usage: node dybs-validate.mjs [projectRoot] [--doc <name>] [--json]
// Exit code 0 = no errors (warnings allowed), 1 = errors, 2 = usage problem.
//
// This file is the single home for the doc contract (required sections and
// length caps). Templates and skills must agree with DOCS below.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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

// One line with HTML comments removed, except inside inline code spans,
// where `<!--` is literal text. `open` is true when a comment starts here and
// does not close on this line.
function stripComments(line) {
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (line[i] === '`') {
      const run = line.slice(i).match(/^`+/)[0];
      const close = line.slice(i + run.length).search(new RegExp(`(?<!\`)${run}(?!\`)`));
      if (close >= 0) {
        const endAt = i + run.length + close + run.length;
        out += line.slice(i, endAt);
        i = endAt;
      } else {
        out += run;
        i += run.length;
      }
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
  let prevBlank = true;
  let inComment = false;
  for (const raw of body.split(/\r?\n/)) {
    let line = raw;
    if (inComment) {
      const end = line.indexOf('-->');
      if (end < 0) continue;
      inComment = false;
      line = line.slice(end + 3);
    }
    const blank = line.trim() === '';
    const isIndented = /^( {4}|\t)/.test(line);
    if (indented) {
      if (blank || isIndented) { prevBlank = blank; if (keepCode) out.push(line); continue; }
      indented = false;
    }
    // A fence may sit in a block quote or start a list item (`> ```` or
    // `- ```js`); the container prefix does not hide it.
    const m = line.match(/^ {0,3}(?:>[ \t]?|[-*+][ \t]+|\d{1,9}[.)][ \t]+)*(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (m && m[1][0] === fence.ch && m[1].length >= fence.len && m[2].trim() === '') fence = null;
      if (keepCode) out.push(line);
      continue;
    }
    if (m && !(m[1][0] === '`' && m[2].includes('`'))) { fence = { ch: m[1][0], len: m[1].length }; prevBlank = false; if (keepCode) out.push(line); continue; }
    if (!blank && isIndented && prevBlank && !inList) { indented = true; prevBlank = false; if (keepCode) out.push(line); continue; }
    const stripped = stripComments(line);
    inComment = stripped.open;
    line = stripped.text;
    const nowBlank = line.trim() === '';
    if (!nowBlank && !/^( {4}|\t)/.test(line)) inList = /^ {0,3}([-*+]|\d{1,9}[.)])(\s|$)/.test(line) || (inList && !prevBlank);
    prevBlank = nowBlank;
    out.push(line);
  }
  return out.join('\n');
}

// Headings a reader sees: none inside HTML comments or fenced examples.
export function headings(body) {
  return [...visibleText(body).matchAll(/^ {0,3}##\s+(.+?)\s*$/gm)].map((h) => h.at(1));
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
    if (only && name !== only) continue;
    const spec = DOCS[name];
    const path = join(dir, spec.file);
    // project.md holds the settings, so it can never skip itself.
    if (skip.has(name) && name !== 'project') {
      results.push({ name, file: spec.file, status: 'skipped', words: 0, errors: [], warnings: [] });
      continue;
    }
    if (!existsSync(path)) {
      results.push({ name, file: spec.file, status: 'missing', words: 0, errors: [], warnings: [] });
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
  const report = validateProject(root, only);

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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(main(process.argv));
}

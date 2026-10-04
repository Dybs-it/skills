#!/usr/bin/env node
// Validates a project's dybs/ folder against the Getting Started contract.
// Usage: node dybs-validate.mjs [projectRoot] [--doc <name>] [--json]
// Exit code 0 = no errors (warnings allowed), 1 = errors, 2 = usage problem.
//
// This file is the single home for the doc contract (required sections and
// length caps). Templates and skills must agree with DOCS below.

import { readFileSync, writeFileSync, existsSync, statSync, lstatSync, renameSync, rmSync, realpathSync, linkSync, copyFileSync, openSync, closeSync, fstatSync, fchmodSync, constants as fsConstants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DOCS = {
  project: {
    file: 'project.md',
    maxWords: { quick: 250, thorough: 350 },
    sections: ['Why', 'Who', 'Now'],
  },
  prd: {
    file: 'context/prd.md',
    maxWords: { quick: 900, thorough: 1800 },
    sections: ['Problem', 'Users', 'Goals', 'Requirements', 'Success measures', 'Open questions'],
  },
  scope: {
    file: 'context/scope.md',
    maxWords: { quick: 450, thorough: 800 },
    sections: ['In', 'Out', 'Later', 'Constraints'],
  },
  domain: {
    file: 'context/domain.md',
    maxWords: { quick: 700, thorough: 1500 },
    sections: ['Glossary', 'Rules'],
  },
  architecture: {
    file: 'context/architecture.md',
    maxWords: { quick: 900, thorough: 1800 },
    sections: ['Shape', 'Decisions', 'Boundaries', 'Quality bars'],
  },
  ux: {
    file: 'context/ux.md',
    maxWords: { quick: 700, thorough: 1400 },
    sections: ['Principles', 'Key flows', 'Behaviour rules', 'Accessibility'],
  },
  ui: {
    file: 'context/ui.md',
    maxWords: { quick: 700, thorough: 1400 },
    sections: ['Tone', 'Tokens', 'Components', 'Do and don\'t'],
  },
};

export const ORDER = ['project', 'prd', 'scope', 'domain', 'architecture', 'ux', 'ui'];
export const STATUSES = ['draft', 'accepted'];
export const DEPTHS = ['quick', 'thorough'];
export const CHECKINS = ['each-doc', 'end', 'none'];
// The same rules in words, for an agent checking a doc by hand when the
// validator is not installed. Every id here is enforced in validateDoc, and
// tests keep the skills' standalone sections in step with this list.
export const MANUAL_RULES = [
  { id: 'frontmatter', text: 'The doc starts with a frontmatter block between two `---` lines; every line in it is one `key: value`, and no key appears twice.' },
  { id: 'doc-name', text: 'Frontmatter `doc` is exactly this doc\'s name (for example `doc: prd`).' },
  { id: 'status', text: 'Frontmatter `status` is `draft` or `accepted`, nothing else.' },
  { id: 'updated', text: 'Frontmatter `updated` is a date written as YYYY-MM-DD.' },
  { id: 'accepted-date', text: 'An `accepted` doc also has `accepted: YYYY-MM-DD`, set only on the human\'s word.' },
  { id: 'sections', text: 'Every required `##` section is present (see the template or the doc contract).' },
  { id: 'depth', text: 'Frontmatter `depth`, when present, is `quick` or `thorough`.' },
  { id: 'cap', text: 'The doc is under the word cap for the depth it was written at (its own `depth`; quick when it has none), not counting HTML comments and code blocks.' },
  { id: 'accepted-hash', text: 'An accepted doc is not changed, neither its content nor its frontmatter settings (anything but `status`, `updated`, `accepted` and `accepted-hash`), not even for a typo. Any change sets `status: draft` and removes `accepted` and `accepted-hash`, and the human accepts again. (`accepted-hash` is written by the validator\'s `--accept` and lets it detect a change. Checking by hand cannot recompute it: report such a doc as accepted but not verified, and a doc accepted without `accepted-hash` the same way.)' },
  { id: 'doc-lists', text: 'In project.md, `quick:`, `thorough:` and `skip:` name only known docs (prd, scope, domain, architecture, ux, ui), no doc is both `quick` and `thorough`, and `skip:` keeps what a remaining doc needs (scope, domain, architecture and ux need prd; ui needs ux).' },
  { id: 'checkins', text: 'In project.md, `checkins`, when present, is `each-doc`, `end` or `none`. With `none`, every doc that is not skipped is quick (no `depth: thorough` that applies, nothing under `thorough:`): thorough needs answers.' },
  { id: 'html', text: 'No raw HTML blocks (a line outside code that starts with an HTML tag such as `<pre>` or `<div>`, or with `<?`, `<!` or `<![CDATA[`): they change what renders in ways a reader of the source cannot see. HTML comments are fine.' },
  { id: 'placeholder', text: 'No `{{...}}`, TODO or TBD outside HTML comments. In a draft this is a warning; in an accepted doc it is an error.' },
];

const PLACEHOLDER = /\{\{[^}]*\}\}|\bTODO\b|\bTBD\b/;

export function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: null, body: text };
  const data = {};
  const duplicates = [];
  const unparsed = [];
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    // Every setting is one `key: value` line. Anything else (an indented
    // continuation, a list) would be invisible to the checks and the
    // acceptance fingerprint, so it is reported rather than skipped.
    if (!kv) { if (line.trim()) unparsed.push(line.trim()); continue; }
    if (kv[1] in data) duplicates.push(kv[1]);
    // Quotes count only as a matching pair around the whole value; a lone or
    // mismatched quote (`"draft'`) is malformed, never quietly stripped.
    const raw = kv[2].trim();
    const quoted = raw.match(/^(["'])(.*)\1$/);
    if (!quoted && /^["']|["']$/.test(raw)) { unparsed.push(line.trim()); continue; }
    data[kv[1]] = quoted ? quoted[2] : raw;
  }
  return { data, body: text.slice(m[0].length), duplicates, unparsed };
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
    // A code span stays inside its paragraph: a blank line, a fence or a
    // heading ends the paragraph, and with it any chance to close.
    const closesLater = (run) => {
      for (let k = n + 1; k < lines.length; k++) {
        if (lines[k].trim() === '' || /^ {0,3}(`{3,}|~{3,}|#{1,6}([ \t]|$))/.test(lines[k])) return false;
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
    if (fence) {
      // Inside a list item the closing fence sits at the item's content
      // indent (four spaces under `10. `), so it may be indented up to three
      // spaces past where the opening fence started.
      const c = line.match(/^( *)((?:>[ \t]?)*) {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (c && c[1].length <= fence.indent + 3 && c[3][0] === fence.ch && c[3].length >= fence.len) fence = null;
      if (keepCode) out.push(line);
      continue;
    }
    if (m && !(m[1][0] === '`' && m[2].includes('`'))) {
      fence = { ch: m[1][0], len: m[1].length, indent: line.length - m[1].length - m[2].length };
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

function list(raw) {
  return new Set((raw || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
}

// What each doc cannot be written without. A doc that something still in
// the route requires cannot be skipped; other inputs are optional (a skill
// works without a skipped one and notes what it would have answered).
export const REQUIRES = { scope: ['prd'], domain: ['prd'], architecture: ['prd'], ux: ['prd'], ui: ['ux'] };

// Docs that project.md's `quick:`, `thorough:` and `skip:` may name.
export const LISTABLE = ORDER.filter((n) => n !== 'project');

// project.md sets `depth: quick|thorough` for every doc; `quick:` and
// `thorough:` list docs that differ from it. Unset means quick.
export function depthFor(name, projectData) {
  if (list(projectData?.thorough).has(name)) return 'thorough';
  if (list(projectData?.quick).has(name)) return 'quick';
  return DEPTHS.includes(projectData?.depth) ? projectData.depth : 'quick';
}

function skipped(projectData) {
  // project.md may declare `skip: ui, ux` for docs that do not apply.
  return list(projectData?.skip);
}

// Frontmatter that records the acceptance itself rather than the content.
const BOOKKEEPING = new Set(['status', 'updated', 'accepted', 'accepted-hash']);

// Fingerprint of what the human accepted: the content plus every frontmatter
// setting (depth, and in project.md the routing: checkins, skip, quick,
// thorough, kind...). Only the bookkeeping fields are left out. Stored as
// `accepted-hash` when the human accepts, so a later edit is detectable.
export function acceptedHash(data, body) {
  const meaning = Object.keys(data || {}).filter((k) => !BOOKKEEPING.has(k)).sort()
    .map((k) => `${k}:${data[k]}\n`).join('');
  // Only line endings are normalised: leading or trailing whitespace can
  // change what Markdown shows (an indented title becomes code).
  return createHash('sha256').update(meaning + body.replace(/\r\n/g, '\n')).digest('hex').slice(0, 12);
}

// requestedDepth is what project.md asks for this doc; documentDepth is what
// the doc says it was written at. The cap follows the doc. A doc written at
// quick depth where thorough is requested needs deepening; it is never
// reported as thorough just because the project setting changed.
export function validateDoc(name, text, requestedDepth = 'quick') {
  const spec = DOCS[name];
  const errors = [];
  const warnings = [];
  const rules = new Set();
  const fail = (id, msg) => { rules.add(id); errors.push(msg); };
  const { data, body, duplicates = [], unparsed = [] } = parseFrontmatter(text);

  if (!data) {
    fail('frontmatter', 'missing frontmatter (--- block at the top)');
  } else {
    // One key, one value: a second `status:` would make tools disagree on
    // which one counts.
    if (unparsed.length) fail('frontmatter', `frontmatter lines must be "key: value"; not understood: ${unparsed[0]}`);
    if (duplicates.length) fail('frontmatter', `frontmatter key(s) ${[...new Set(duplicates)].join(', ')} appear more than once`);
    if (data.doc !== name) fail('doc-name', `frontmatter "doc" must be "${name}" (found "${data.doc ?? ''}")`);
    if (!STATUSES.includes(data.status)) fail('status', `frontmatter "status" must be one of ${STATUSES.join('|')}`);
    if (!isDate(data.updated)) fail('updated', 'frontmatter "updated" must be a real date, YYYY-MM-DD');
    if (data.depth !== undefined && !DEPTHS.includes(data.depth)) {
      fail('depth', `frontmatter "depth" must be one of ${DEPTHS.join('|')}`);
    }
    if (data.status === 'accepted' && !isDate(data.accepted)) {
      fail('accepted-date', 'accepted docs need frontmatter "accepted: YYYY-MM-DD" (set only on the human\'s word)');
    }
    if (name === 'project') {
      for (const key of ['quick', 'thorough', 'skip']) {
        const unknown = [...list(data[key])].filter((n) => !LISTABLE.includes(n));
        if (unknown.length) fail('doc-lists', `"${key}:" names unknown doc(s) ${unknown.join(', ')}. Known: ${LISTABLE.join(', ')}`);
      }
      const skipList = list(data.skip);
      for (const [doc, needs] of Object.entries(REQUIRES)) {
        if (skipList.has(doc)) continue;
        for (const n of needs) if (skipList.has(n)) fail('doc-lists', `"skip:" lists ${n}, but ${doc} needs it; skip ${doc} too or keep ${n}`);
      }
      const both = [...list(data.quick)].filter((n) => list(data.thorough).has(n));
      if (both.length) fail('doc-lists', `${both.join(', ')} listed under both "quick:" and "thorough:"`);
      if (data.checkins !== undefined && !CHECKINS.includes(data.checkins)) {
        fail('checkins', `"checkins" must be one of ${CHECKINS.join('|')} (found "${data.checkins}")`);
      }
      // No questions means no thorough docs: thorough needs answers.
      if (data.checkins === 'none') {
        const thorough = LISTABLE.filter((n) => !skipList.has(n) && depthFor(n, data) === 'thorough');
        if (thorough.length) fail('checkins', `"checkins: none" asks nothing, so every doc must be quick; thorough here: ${thorough.join(', ')}`);
      }
    }
    // A draft keeps no trace of an earlier acceptance: that acceptance was
    // for another version.
    if (data.status === 'draft' && (data.accepted !== undefined || data['accepted-hash'] !== undefined)) {
      fail('accepted-hash', 'a draft must not keep accepted or accepted-hash: remove them (the acceptance was for an earlier version)');
    }
    if (data.status === 'accepted' && !data['accepted-hash']) {
      warnings.push('accepted without a fingerprint, so a later change cannot be detected: run --accept again to record it');
    }
    if (data.status === 'accepted' && data['accepted-hash'] && data['accepted-hash'] !== acceptedHash(data, body)) {
      fail('accepted-hash', 'changed after it was accepted: set status: draft, remove accepted and accepted-hash, and ask the human to accept again');
    }
  }
  // In project.md, `depth` is the project's setting, not how deep project.md
  // itself was written, so project.md never needs deepening.
  const documentDepth = name !== 'project' && DEPTHS.includes(data?.depth) ? data.depth : null;
  // A doc that does not say how deep it was written gets the quick cap: a
  // project setting alone never raises a doc's allowance.
  const depth = name === 'project' ? requestedDepth : documentDepth ?? 'quick';
  const needsDeepening = name !== 'project' && requestedDepth === 'thorough' && documentDepth !== 'thorough';

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
  const cap = spec.maxWords[depth];
  if (words > cap) {
    fail('cap', `${words} words, ${depth} cap is ${cap}. Cut, or move the why to dybs/log.md or context/decisions/`);
  } else if (words > cap * 0.9) {
    warnings.push(`${words} words, close to the ${depth} cap of ${cap}`);
  }

  const frontmatterValues = Object.values(data || {}).join('\n');
  if (PLACEHOLDER.test(visibleText(body, { keepCode: true })) || PLACEHOLDER.test(frontmatterValues)) {
    const msg = 'unfilled placeholder ({{...}}, TODO or TBD)';
    if (data?.status === 'accepted') fail('placeholder', msg);
    else warnings.push(msg);
  }

  return {
    name, file: spec.file, status: data?.status ?? null,
    requestedDepth, documentDepth, needsDeepening,
    words, errors, warnings, rules: [...rules],
  };
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
    // project.md holds the settings every doc is checked against, so it is
    // validated with any single doc too.
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
      const errors = only === name ? [`${spec.file} does not exist yet`] : [];
      results.push({ name, file: spec.file, status: 'missing', words: 0, errors, warnings: [] });
      continue;
    }
    results.push(validateDoc(name, readFileSync(path, 'utf8'), depthFor(name, projectData)));
  }
  // ok: no rule is broken (missing and draft docs are allowed).
  // complete: every doc that is not skipped exists and is ok.
  // atRequestedDepth: no doc still needs deepening.
  // accepted: complete, and the human accepted every doc.
  // None of these says the interview was good; only a human can judge that.
  const ok = results.every((r) => r.errors.length === 0);
  const docs = results.filter((r) => r.status !== 'skipped' && r.name !== 'readme');
  const complete = ok && !only && docs.every((r) => r.status !== 'missing');
  const atRequestedDepth = docs.every((r) => !r.needsDeepening);
  const accepted = complete && docs.every((r) => r.status === 'accepted');
  const deepen = docs.filter((r) => r.needsDeepening && r.status !== 'missing').map((r) => r.name);
  const checkins = CHECKINS.includes(projectData?.checkins) ? projectData.checkins : 'each-doc';
  // `kickoff: parked` means the human parked the kickoff before choosing a
  // route: nothing is routed until they choose (dybs-start, step 3).
  const parked = projectData?.kickoff === 'parked';
  return { ok, complete, atRequestedDepth, accepted, deepen, checkins, parked, results };
}

// With `checkins: end` or `none` a draft waits for the review point the
// human chose, so it does not stop the route. With `none` nothing is asked,
// so a doc that needs deepening waits too; the final report lists it.
export function nextStep(results, checkins = 'each-doc') {
  const draftsWait = checkins === 'end' || checkins === 'none';
  const deepeningWaits = checkins === 'none';
  // A missing dybs/README.md is repaired by dybs-start, not by a doc skill.
  if (results.some((r) => r.name === 'readme' && r.errors.length)) return 'dybs-start';
  const pending = results.find((r) => r.status === 'missing' || r.errors.length
    || (r.needsDeepening && !deepeningWaits)
    || (r.status === 'draft' && !draftsWait));
  // project.md has no skill of its own: dybs-start writes, repairs and
  // checks in on it.
  if (pending?.name === 'project') return 'dybs-start';
  return pending ? pending.name : null;
}

// Sets frontmatter keys in place (null removes a key), leaving every other
// line as it was.
export function setFrontmatter(text, updates) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) throw new Error('no frontmatter');
  const lines = m[1].split(/\r?\n/);
  for (const [key, value] of Object.entries(updates)) {
    const i = lines.findIndex((l) => l.startsWith(`${key}:`));
    if (value === null) { if (i >= 0) lines.splice(i, 1); continue; }
    if (i >= 0) lines[i] = `${key}: ${value}`;
    else lines.push(`${key}: ${value}`);
  }
  return `---\n${lines.join('\n')}\n---` + text.slice(m[0].length);
}

// Why `root/rel` is not a regular file reached through real folders, or null.
// Nothing below the project root is followed: accepting a doc must never
// write through a link to a file somewhere else.
export function unsafePath(root, rel) {
  const parts = rel.split('/');
  let p = root;
  for (let i = 0; i < parts.length; i++) {
    p = join(p, parts[i]);
    let st;
    try { st = lstatSync(p); } catch { return `${parts.slice(0, i + 1).join('/')} does not exist`; }
    if (st.isSymbolicLink()) return `${parts.slice(0, i + 1).join('/')} is a symbolic link`;
    if (i < parts.length - 1 && !st.isDirectory()) return `${parts.slice(0, i + 1).join('/')} is not a folder`;
    if (i === parts.length - 1 && !st.isFile()) return `${rel} is not a regular file`;
  }
  return null;
}

// Device and inode of each folder from the project root down to `rel`'s
// folder, all real folders (not links); null when one is not.
function folderChain(root, rel) {
  const ids = [];
  let p = root;
  for (const part of ['', ...rel.split('/').slice(0, -1)]) {
    p = part ? join(p, part) : p;
    let st;
    try { st = part ? lstatSync(p) : statSync(p); } catch { return null; }
    if (!st.isDirectory()) return null;
    ids.push(idOf(st));
  }
  return ids.join('/');
}

const idOf = (st) => `${st.dev}:${st.ino}`;
function pathId(p) {
  try { return idOf(lstatSync(p)); } catch { return null; }
}

// Removes `p` only while it is still the file we created.
function rmIfOurs(p, id) {
  if (id && pathId(p) === id) fsOps.rm(p);
}

// Today as the person running the command sees it (local time, not UTC), so
// an acceptance at 23:30 is not stamped with tomorrow's date.
export function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Marks a doc accepted on the human's word: status, date and a fingerprint of
// its content. Refuses a doc that would not validate as accepted.
// Filesystem calls acceptDoc uses for no-clobber placement; a test swaps
// `link` to act like a filesystem without hard links.
export const fsOps = { link: linkSync, copyFile: copyFileSync, rm: rmSync };

// Puts `from` at `to` without overwriting anything there: link() where the
// filesystem has hard links, an exclusive copy (COPYFILE_EXCL, O_EXCL) where
// it does not. Either refuses a file or link that appears at `to` at any
// moment; a check followed by rename() would replace one that appeared in
// between.
// `from` is left in place: the caller records the placement first and only
// then removes it, so a failure in that removal is still undone.
export function placeNoClobber(from, to) {
  try {
    fsOps.link(from, to);
    return 'link';
  } catch (err) {
    if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EMLINK', 'ENOSYS', 'EXDEV'].includes(err.code)) throw err;
    fsOps.copyFile(from, to, fsConstants.COPYFILE_EXCL);
    return 'copy';
  }
}

// `beforeReplace` is a test hook: it runs after validation, just before the
// doc is replaced, so a test can act like a concurrent editor.
export function acceptDoc(root, name, today = localDate(), { beforeReplace, beforePlace, beforeCleanup } = {}) {
  const rel = `dybs/${DOCS[name].file}`;
  const unsafe = unsafePath(root, rel);
  if (unsafe) return { ok: false, errors: [`refusing to accept: ${unsafe}`] };
  // A doc is accepted under project.md's settings (its depth and cap), so
  // those settings must themselves be valid first.
  if (name !== 'project') {
    const projectPath = join(root, 'dybs', DOCS.project.file);
    if (!existsSync(projectPath)) return { ok: false, errors: ['dybs/project.md is missing: its depth and settings decide how this doc is accepted. Run dybs-start first.'] };
    {
      const projectText = readFileSync(projectPath, 'utf8');
      const project = validateDoc('project', projectText, depthFor('project', parseFrontmatter(projectText).data));
      if (project.errors.length) return { ok: false, errors: project.errors.map((e) => `project.md: ${e}`) };
      // A doc is never accepted without the docs it cannot be written
      // without: each must exist and validate.
      const projectData = parseFrontmatter(projectText).data;
      for (const dep of REQUIRES[name] || []) {
        const depRel = `dybs/${DOCS[dep].file}`;
        const depPath = join(root, depRel);
        if (!existsSync(depPath)) return { ok: false, errors: [`${depRel} is missing: ${name} cannot be written without it. Write ${dep} first.`] };
        const depUnsafe = unsafePath(root, depRel);
        if (depUnsafe) return { ok: false, errors: [`refusing to accept: ${depUnsafe}`] };
        const r = validateDoc(dep, readFileSync(depPath, 'utf8'), depthFor(dep, projectData));
        if (r.errors.length) return { ok: false, errors: r.errors.map((e) => `${DOCS[dep].file}: ${e}`) };
      }
    }
  }
  const path = join(root, rel);
  const text = readFileSync(path, 'utf8');
  const { data, body } = parseFrontmatter(text);
  if (!data) return { ok: false, errors: validateDoc(name, text).errors };
  const next = setFrontmatter(text, { status: 'accepted', updated: today, accepted: today, 'accepted-hash': acceptedHash(data, body) });
  const projectPath = join(root, 'dybs', DOCS.project.file);
  const projectData = existsSync(projectPath) ? parseFrontmatter(readFileSync(projectPath, 'utf8')).data : null;
  const check = validateDoc(name, next, depthFor(name, projectData));
  if (check.errors.length) return { ok: false, errors: check.errors };
  // Write beside it and rename into place: rename replaces whatever is at
  // the path, it never follows a link that appeared in the meantime.
  // Keep the doc's permissions: a 0600 doc must not come back as 0644.
  // The doc is moved aside first and compared with what was validated: an
  // edit saved meanwhile is never replaced by the stale accepted version.
  // The folders on the way are pinned by identity and checked again around
  // every write and rename, so a folder swapped for a link after the checks
  // above is noticed and undone rather than written through. (Node has no
  // directory-relative calls, so this detects a swap; it cannot prevent one.)
  const dirs = folderChain(root, rel);
  const pinned = () => {
    if (!dirs || folderChain(root, rel) !== dirs) throw new Error(`a folder on the way to ${rel} changed while it was being accepted; run --accept again`);
  };
  // Names unique to this run: a kept `.old` from an earlier run (or a
  // reused process id) is never overwritten.
  const run = `${process.pid}-${randomUUID()}`;
  const tmp = `${path}.dybs-${run}.tmp`;
  const old = `${path}.dybs-${run}.old`;
  const mode = lstatSync(path).mode & 0o7777;
  let tmpId = null;
  let moved = false;
  let placed = false;
  let placedId = null;
  let oldId = null;
  try {
    const fd = openSync(tmp, 'wx', mode);
    try {
      tmpId = idOf(fstatSync(fd));
      writeFileSync(fd, next);
      fchmodSync(fd, mode);
    } finally { closeSync(fd); }
    beforeReplace?.();
    pinned();
    if (pathId(tmp) !== tmpId) throw new Error(`the temporary copy of ${rel} is not where it was written; run --accept again`);
    renameSync(path, old);
    moved = true;
    pinned();
    oldId = pathId(old);
    if (readFileSync(old, 'utf8') !== text) {
      placeNoClobber(old, path);
      moved = false;
      rmSync(old);
      rmIfOurs(tmp, tmpId);
      return { ok: false, errors: ['the doc changed while it was being accepted; nothing was written, run --accept again'] };
    }
    // Identity cannot show an edit made in place, so the bytes are checked
    // too, right before the copy is placed.
    beforePlace?.(tmp);
    if (pathId(tmp) !== tmpId || readFileSync(tmp, 'utf8') !== next) {
      throw new Error(`the temporary copy of ${rel} changed before it was placed; nothing was kept, run --accept again`);
    }
    const how = placeNoClobber(tmp, path);
    placed = true;
    placedId = how === 'link' ? tmpId : pathId(path);
    pinned();
    rmIfOurs(tmp, tmpId);
    // The original is deleted only while it is provably ours: reached
    // through the pinned folders, the very file we moved aside, and still
    // holding what was validated. Otherwise it is kept and reported.
    beforeCleanup?.(old);
    let ours = false;
    try { ours = folderChain(root, rel) === dirs && pathId(old) === oldId && readFileSync(old, 'utf8') === text; } catch { ours = false; }
    if (ours) rmSync(old);
    else return { ok: true, warnings: [`the previous version changed or could not be confirmed during acceptance; kept at ${old}`] };
  } catch (err) {
    // Undo through the same paths: a file that went through a swapped link
    // comes back the same way. Only what is provably ours is removed.
    if (placed) {
      let ours = false;
      try {
        ours = folderChain(root, rel) === dirs && pathId(path) === placedId && readFileSync(path, 'utf8') === next;
      } catch { ours = false; }
      if (ours) { try { rmSync(path); } catch { /* reported below */ } }
    }
    try { rmIfOurs(tmp, tmpId); } catch { /* reported below */ }
    // Never leave the doc stranded under its temporary name.
    // lstat, not exists: a dangling link that appeared at the doc's path is
    // someone's entry too, and is never replaced. Then the original stays
    // at its temporary name, and the error says where.
    const taken = (p) => { try { lstatSync(p); return true; } catch { return false; } };
    // Restored with the same no-clobber placement as everything else: a
    // save that lands at the path in the meantime is never overwritten.
    if (moved && taken(old)) {
      let restored = false;
      try {
        try { placeNoClobber(old, path); } catch (e) {
          // The failure that brought us here may be the link itself: fall
          // back to an exclusive copy, still never over an existing entry.
          if (e.code === 'EEXIST') throw e;
          fsOps.copyFile(old, path, fsConstants.COPYFILE_EXCL);
        }
        restored = true;
      } catch { restored = false; }
      if (restored) rmSync(old);
      else err.message += `; something appeared at ${rel} meanwhile, the original is kept at ${old}`;
    }
    throw err;
  }
  return { ok: true };
}

export function main(argv) {
  const args = argv.slice(2);
  // Unknown options and a second folder are refused: a misspelled
  // `--accpet prd` must not quietly run a plain validation that exits 0.
  {
    const positionals = [];
    const seenFlags = new Set();
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '--doc' || a === '--accept') {
        // Each at most once, and not together: a second one would be
        // silently ignored, and automation would believe it ran.
        if (seenFlags.has(a)) { console.error(`${a} given more than once; run one doc at a time`); return 2; }
        seenFlags.add(a);
        i++;
        continue;
      }
      if (a === '--json') continue;
      if (a.startsWith('-') && a !== '-') { console.error(`unknown option ${a}. Options: --doc <name>, --accept <doc>, --json`); return 2; }
      positionals.push(a);
    }
    if (positionals.length > 1) { console.error(`one project folder at most, got: ${positionals.join(' ')}`); return 2; }
    if (seenFlags.size > 1) { console.error('use --doc or --accept, not both'); return 2; }
  }
  const json = args.includes('--json');
  // A flag that takes a doc name must get one: a bare `--accept` that
  // silently ran a plain validation would look like it had accepted.
  const operand = (flag) => {
    const i = args.indexOf(flag);
    if (i < 0) return { given: false };
    const v = args[i + 1];
    return { given: true, value: v && !v.startsWith('--') ? v : undefined };
  };
  const doc = operand('--doc');
  const acc = operand('--accept');
  for (const [flag, o] of [['--doc', doc], ['--accept', acc]]) {
    if (o.given && !o.value) { console.error(`${flag} needs a doc name. Known: ${ORDER.join(', ')}`); return 2; }
  }
  const only = doc.value;
  if (only && !DOCS[only]) {
    console.error(`unknown doc "${only}". Known: ${ORDER.join(', ')}`);
    return 2;
  }
  const accept = acc.value;
  const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--doc' && args[i - 1] !== '--accept');
  const root = resolve(positional[0] || '.');
  if (accept) {
    if (!DOCS[accept]) { console.error(`unknown doc "${accept}". Known: ${ORDER.join(', ')}`); return 2; }
    let r;
    try {
      r = acceptDoc(root, accept);
    } catch (err) {
      // An operational failure (a leftover temp file, permissions) is still
      // reported in the requested format, never as a bare exception.
      if (!json) throw err;
      r = { ok: false, errors: [err.message] };
    }
    if (json) {
      console.log(JSON.stringify({ schema: 2, accept, ok: r.ok, errors: r.errors || [], warnings: r.warnings || [] }, null, 2));
      return r.ok ? 0 : 1;
    }
    if (!r.ok) { console.error(`not accepted, fix first:\n  ${r.errors.join('\n  ')}`); return 1; }
    console.log(`${accept} accepted.`);
    for (const w of r.warnings || []) console.log(`warn: ${w}`);
    return 0;
  }
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
    // schema 2: depth split into requestedDepth/documentDepth/needsDeepening.
    // With --doc only that doc (and project.md) was read, so there is no
    // project-wide next step to give.
    // Same next step as the text output: once every doc is written but not
    // all are accepted at the requested depth, the next step is the check.
    let next = only ? null : report.parked ? 'kickoff' : nextStep(report.results, report.checkins);
    if (!only && !report.parked && !report.fatal && !next && !(report.accepted && report.atRequestedDepth)) next = 'check';
    console.log(JSON.stringify({ schema: 2, ...report, next }, null, 2));
    return report.ok ? 0 : 1;
  }
  if (report.fatal) {
    console.error(report.fatal);
    return 1;
  }
  for (const r of report.results) {
    const tag = r.errors.length ? 'FAIL' : r.status === 'missing' || r.status === 'skipped' ? r.status.toUpperCase() : r.status?.toUpperCase();
    const depthNote = r.name === 'project' ? `, project depth ${r.requestedDepth}`
      : r.requestedDepth ? `, ${r.documentDepth ?? 'depth not set'}${r.needsDeepening ? `, needs ${r.requestedDepth}` : ''}`
      : '';
    console.log(`${tag.padEnd(9)} ${r.file}${r.words ? `  (${r.words} words${depthNote})` : ''}`);
    for (const e of r.errors) console.log(`          error: ${e}`);
    for (const w of r.warnings) console.log(`          warn:  ${w}`);
  }
  if (only) return report.ok ? 0 : 1;
  const next = report.parked ? 'kickoff' : nextStep(report.results, report.checkins);
  const docs = report.results.filter((r) => r.status !== 'skipped' && r.name !== 'readme');
  const waiting = docs.filter((r) => r.status === 'draft').map((r) => r.name);
  if (report.parked) console.log('\nKickoff parked: say "dybs start" to choose a route.');
  else if (next) console.log(`\nNext: ${next}`);
  else if (report.accepted && report.atRequestedDepth) console.log('\nAll Getting Started docs accepted at the requested depth.');
  else {
    console.log(`\nAll docs written (checkins: ${report.checkins}), not all accepted yet.`);
    if (waiting.length) console.log(`Awaiting acceptance: ${waiting.join(', ')}`);
    if (report.deepen.length) console.log(`Needs thorough depth: ${report.deepen.join(', ')}`);
    console.log('Next: check (dybs-check reviews them with you).');
  }
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

#!/usr/bin/env node
// Validates a project's dybs/ folder against the Getting Started contract.
// Usage: node dybs-validate.mjs [projectRoot] [--doc <name>] [--json]
// Exit code 0 = no errors (warnings allowed), 1 = errors, 2 = usage problem.
//
// This file is the single home for the doc contract (required sections and
// length caps). Templates and skills must agree with DOCS below.

import { readFileSync, writeFileSync, existsSync, statSync, lstatSync, renameSync, rmSync, realpathSync, linkSync, copyFileSync, openSync, closeSync, fstatSync, fchmodSync, constants as fsConstants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve, basename } from 'node:path';
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
  { id: 'html', text: 'No raw HTML outside code: no HTML tag such as `<pre>`, `<div>` or `<details>` anywhere in a line, and nothing starting with `<?`, `<!` or `<![CDATA[`. It changes what renders in ways a reader of the source cannot see. HTML comments and autolinks (`<https://…>`) are fine.' },
  { id: 'placeholder', text: 'No `{{...}}`, TODO or TBD outside HTML comments. In a draft this is a warning; in an accepted doc it is an error.' },
];

// Bounded by letters and digits, not by \b: `_TODO_` renders as an
// emphasized TODO, and `_` is a word character to \b.
// A line with its code spans and backslash escapes removed, read the way
// CommonMark reads it, left to right: an escaped character is text, a
// backtick run opens a span only when a run of exactly the same length
// follows, and inside a span a backslash is literal. A span that continues
// onto another line is not followed: its tag is then judged as raw, which
// can only refuse more.
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

// A line with `fn` applied only outside its code spans, which render as
// written (`[a][b]`, `](url)` and `&amp;` inside code are text). Escaped
// punctuation is protected from `fn` and comes back as written. null when a
// backtick run stays open: the span may go on to the next line, so nothing
// on it can be judged as outside code.
function outsideCode(line, fn) {
  let out = '';
  let text = '';
  const flush = () => {
    out += fn(text).replace(/[\ue000-\ue07f]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xe000));
    text = '';
  };
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === '\\' && /[!-\/:-@[-`{-~]/.test(line[i + 1] ?? '')) { text += c + String.fromCharCode(0xe000 + line.charCodeAt(i + 1)); i += 2; continue; }
    if (c !== '`') { text += c; i += 1; continue; }
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
    if (close === -1) return null;
    flush();
    out += line.slice(i, close);
    i = close;
  }
  flush();
  return out;
}

// Character references decoded the way a reader sees them, for the
// placeholder check: `T&#79;DO` renders as TODO. Numeric references are
// decoded in full; of the named ones, those that can spell a placeholder
// (the braces, and any letter or digit written as a reference). Decoding
// inside code too can only find more, never less.
// Of the named ones: the braces, and the common ones a doc may use in a
// heading or prose (`&apos;`, `&nbsp;`, dashes, quotes). The full HTML5
// table is not carried; an unknown name stays as written (counts more).
const NAMED = {
  lbrace: '{', lcub: '{', rbrace: '}', rcub: '}', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  nbsp: '\u00a0', ndash: '\u2013', mdash: '\u2014', hellip: '\u2026', lsquo: '\u2018', rsquo: '\u2019',
  ldquo: '\u201c', rdquo: '\u201d', copy: '\u00a9', reg: '\u00ae', trade: '\u2122', middot: '\u00b7', bull: '\u2022',
};
export function decodeReferences(text) {
  return text.replace(/&(?:#(\d{1,7})|#[xX]([0-9A-Fa-f]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/g, (m, dec, hex, name) => {
    if (dec || hex) {
      const cp = dec ? Number(dec) : parseInt(hex, 16);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '\uFFFD';
    }
    return NAMED[name] ?? m;
  });
}

const PLACEHOLDER = /\{\{[^}]*\}\}|(?<![\p{L}\p{N}])(?:TODO|TBD)(?![\p{L}\p{N}])/u;

export function parseFrontmatter(text) {
  // The block ends at the first line that starts with `---`, and that line
  // must be exactly `---`: `---oops` is not a closer, and the block is then
  // not frontmatter at all (never extended to a later `---`).
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n(---[^\r\n]*)(?:\r?\n|$)/);
  if (!m || m[2].trim() !== '---') return { data: null, body: text };
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
// An unclosed `<!--` hides what follows only where CommonMark lets it: as
// the opener of an HTML block (`block`, a line that starts with it), or as
// an inline comment that a later line of the same paragraph closes
// (`commentClosesLater`). Anywhere else it is literal text.
// With `hideUnclosed`, every unclosed opener hides the rest (the reading
// that can only hide more): used where showing too much is the unsafe error,
// such as finding the required headings.
function stripComments(line, st, closesLater, block = false, commentClosesLater = () => false, hideUnclosed = false) {
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
        st.spanAt = out.length;
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
    // `<!-->` and `<!--->` are complete comments in CommonMark.
    if (line.startsWith('<!-->', i)) { i += 5; continue; }
    if (line.startsWith('<!--->', i)) { i += 6; continue; }
    if (line.startsWith('<!--', i)) {
      const end = line.indexOf('-->', i + 4);
      // Only container markers (`>`, `-`, `1.`) may precede a block opener.
      const opensBlock = block && /^(?:[ \t]|>|[-*+](?=[ \t])|\d{1,9}[.)](?=[ \t]))*$/.test(out);
      // Inside a paragraph, renderers on the older grammar (GitHub's among
      // them) refuse a comment whose text holds `--` and show it literally,
      // so it is read as visible: that can only find more, never less.
      if (!opensBlock && line.slice(i + 4, end < 0 ? line.length : end).includes('--')) {
        out += '<!--';
        i += 4;
        continue;
      }
      if (end < 0) {
        if (opensBlock || hideUnclosed || commentClosesLater()) return { text: out, open: true };
        out += '<!--';
        i += 4;
        continue;
      }
      i = end + 3;
      continue;
    }
    out += line[i++];
  }
  return { text: out, open: false };
}

// The HTML blocks that may interrupt a paragraph (CommonMark types 1 to 6):
// a code span never reaches past one of these.
const HTML_BLOCK_TAGS = 'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul';
const HTML_INTERRUPT = new RegExp(`^ {0,3}(?:<(?:script|pre|style|textarea)(?:[\\s>]|$)|<!--|<\\?|<![A-Za-z]|<!\\[CDATA\\[|</?(?:${HTML_BLOCK_TAGS})(?:[\\s/>]|$))`, 'i');

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
// The quote and list markers that open a line, with each list marker
// replaced by spaces of its width, so a list item's first line and its
// continuation lines compare equal.
function containerPrefix(line) {
  const m = line.match(/^(?:[ \t]|>|[-*+](?=[ \t])|\d{1,9}[.)](?=[ \t]))*/)[0];
  return m.replace(/[-*+]|\d{1,9}[.)]/g, (x) => ' '.repeat(x.length));
}

// The content column of every list item a line opens, outermost first:
// `- - item` opens two, at columns 2 and 4.
function markerCols(line, first) {
  // A marker with nothing after it (`-` alone) still takes its one space:
  // its content column is two, as if the space were there.
  const cols = [first[0].length + (/[ \t]$/.test(first[0]) ? 0 : 1)];
  let rest = line.slice(first[0].length);
  let m;
  while ((m = rest.match(/^ {0,3}(?:[-*+]|\d{1,9}[.)])(?: {1,4}(?! )| )(?=\S)/))) {
    cols.push(cols.at(-1) + m[0].length);
    rest = rest.slice(m[0].length);
  }
  return cols;
}

function expandTabs(line) {
  if (!line.includes('\t')) return line;
  let out = '';
  for (const ch of line) out += ch === '\t' ? ' '.repeat(4 - (out.length % 4)) : ch;
  return out;
}

// Code that is not kept leaves an empty line, never nothing: it still ends
// the block before it (a definition right after a fence starts a block).
export function visibleText(body, { keepCode = false, hideSpanLines = false, hideUnclosed = false } = {}) {
  const out = [];
  let fence = null;
  let indented = false;
  let inList = false;
  // Where a list item's content starts (2 under `- `, 4 under `10. `): an
  // indented code block inside it sits four columns past that.
  let listIndent = 0;
  // The content column of every open list item, outermost first: a nested
  // item (`    - x` under `10. `) is tracked too, so a fence opened in it
  // ends where that item ends, not where the outer one does.
  const items = [];
  // The quote depth the current list sits in: a line outside that quote
  // is measured from the margin, not from the list's items.
  let listQuote = 0;
  // An item opened with nothing on its line (`-` alone) ends at a blank
  // line that comes before any content: it can start with one blank line
  // at most, so what follows is outside it.
  let emptyItem = false;
  let prevBlank = true;
  // The deepest quote the open paragraph has reached: a line that drops out
  // of the quote lazily continues that paragraph, so re-entering the quote
  // afterwards does not start a new block (and so no indented code).
  let paraQuote = 0;
  // Whether the line before was paragraph text: only paragraph text takes a
  // setext underline, and only then can `2. ` fail to interrupt it. In
  // doubt this is false, which can only count more words, never fewer.
  let para = false;
  let paraPrefix = '';
  // A heading, a thematic break or a closed fence is not a paragraph, so an
  // indented code block may follow it with no blank line in between. So may
  // the first line of a new block quote, which interrupts a paragraph.
  let afterBlock = false;
  let inComment = false;
  const st = { span: null };
  // Block structure is measured in columns, with tab stops every four
  // (CommonMark): `-\titem` puts the content at column four, not two.
  const lines = body.split(/\r?\n/).map(expandTabs);
  for (let n = 0; n < lines.length; n++) {
    let line = lines[n];
    // A code span stays inside its paragraph: a blank line, a fence, a
    // heading, a list item or a deeper block quote ends the paragraph, and
    // with it any chance to close. Each is judged after the line's `>`
    // markers, so a quoted heading ends it too.
    const laterInParagraph = (found) => {
      const depth = quoteDepth(lines[n]);
      for (let k = n + 1; k < lines.length; k++) {
        const rest = lines[k].replace(/^(?: {0,3}>[ \t]?)+/, '');
        // A deeper quote ends the paragraph; a shallower line is a lazy
        // continuation of it (CommonMark), unless it starts a block, such
        // as an HTML comment, a heading or a list item, checked below.
        if (rest.trim() === '' || quoteDepth(lines[k]) > depth) return false;
        // Inside a list item, a block starts at the item's content column
        // (`    <!--` under `- a` opens an HTML block in the item).
        const ind = rest.match(/^ */)[0].length;
        const rel = rest.slice(inList && quoteDepth(lines[k]) >= listQuote ? (items.filter((c) => c <= ind).at(-1) ?? 0) : 0);
        if (HTML_INTERRUPT.test(rest) || HTML_INTERRUPT.test(rel)) return false;
        if (/^ {0,3}(<!--|`{3,}[^`]*$|~{3,}|#{1,6}([ \t]|$)|[-*+][ \t]+\S|1[.)][ \t]+\S|([-*_=])([ \t]*\3){2,}[ \t]*$|=+[ \t]*$|-+[ \t]*$)/.test(rest)) return false;
        if (/^ {0,3}(<!--|`{3,}[^`]*$|~{3,}|#{1,6}([ \t]|$)|[-*+][ \t]+\S|1[.)][ \t]+\S)/.test(rel)) return false;
        if (found(lines[k])) return true;
      }
      return false;
    };
    const closesLater = (run) => laterInParagraph((l) => closer(run).test(l));
    // The same older grammar for a comment that closes on a later line: any
    // `--` before its `-->` leaves it visible text.
    const commentClosesLater = () => {
      let dashes = false;
      const closes = laterInParagraph((l) => {
        const e = l.indexOf('-->');
        if (l.slice(0, e < 0 ? l.length : e).includes('--')) dashes = true;
        return e >= 0;
      });
      return closes && !dashes;
    };
    // A comment opened in a block quote or list item ends with it: a line
    // outside that container (a blank line ends a quote) is read afresh.
    if (inComment && (quoteDepth(line) < inComment.quote || (line.trim() !== '' && line.replace(/^(?: {0,3}>[ \t]?)+/, '').match(/^ */)[0].length < inComment.col))) inComment = false;
    // Text on the line a comment ends is never block Markdown: after a
    // block comment it is the rest of that HTML block (CommonMark), and
    // after an inline one it continues a paragraph.
    let htmlTail = false;
    // After an inline comment the line goes on with the paragraph.
    let inlineTail = false;
    if (inComment) {
      const end = line.indexOf('-->');
      if (end < 0) { para = false; continue; }
      inlineTail = !inComment.block;
      inComment = false;
      line = line.slice(end + 3);
      htmlTail = true;
    }
    // Inside a block quote, blankness and indentation are judged after the
    // `>` markers: `>` alone is a blank line, `>     x` is indented code.
    const inner = line.replace(/^(?: {0,3}>[ \t]?)+/, '');
    const blank = inner.trim() === '';
    if (blank) st.span = null;
    const isIndented = /^( {4}|\t)/.test(inner);
    // An indented block continues only at its own code column: inside a
    // list item that is four past the item's content (`listIndent + 4`).
    if (indented) {
      if (blank || inner.match(/^ */)[0].length >= indented || /^\t/.test(inner)) { prevBlank = blank; para = false; out.push(keepCode ? line : ''); continue; }
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
    let m = body0.match(/^ {0,3}(?:(?:>[ \t]?|[-*+][ \t]+|\d{1,9}[.)][ \t]+) {0,3})*(`{3,}|~{3,})(.*)$/);
    // Only an ordered list starting at 1 may interrupt a paragraph: after
    // paragraph text, `2. ```` is more of that paragraph, not a fence.
    const ordered = body0.match(/^ {0,3}(?:>[ \t]?)*\s*(\d{1,9})[.)][ \t]/);
    // Inside a list item too: `  2. ` at the item's content continues its
    // paragraph (`- ordinary` / `  2. x`); only left of it is a new item.
    const inItemText = inList && line.replace(/^(?: {0,3}>[ \t]?)+/, '').match(/^ */)[0].length >= (items.at(-1) ?? listIndent);
    if (m && !fence && ordered && Number(ordered[1]) !== 1 && !prevBlank && !afterBlock && (!inList || inItemText)) m = null;
    // A fence lives in the container it opened in: a line outside that
    // block quote or list item ends the container, and the fence with it
    // (no lazy continuation for code), so the line is read afresh: a bare
    // ``` after `> ```` opens a new fence rather than closing the quoted one.
    // When the list item holds the quote (`- > ````), the item's column is
    // measured before the `>` markers and the quote depth after it.
    // A blank line without the `>` markers ends a block quote, and a fence
    // inside it: `> ```` / (blank) / `> text` is a second quote, not code.
    if (fence && blank && quoteDepth(line) < fence.quote) fence = null;
    // In a list item a bare `>` is not blank: left of the item's content it
    // ends the item (`- > ```` / `>`), and the fence with it.
    if (fence && (!blank || (fence.listFirst && line.trim() !== ''))) {
      const rawLead = line.match(/^ */)[0].length;
      const depth = fence.listFirst ? quoteDepth(line.slice(Math.min(rawLead, fence.col))) : quoteDepth(line);
      const lead = fence.listFirst ? rawLead : inner.match(/^ */)[0].length;
      if (depth < fence.quote || lead < fence.col) fence = null;
    }
    if (fence) {
      // Inside a list item the closing fence sits at the item's content
      // indent (four spaces under `10. `), so it may be indented up to three
      // spaces past where the opening fence started.
      // Each quote marker may be followed by up to three spaces before the
      // next one, as for the opener (`>  > ````).
      const c = line.match(/^( *)((?:>[ \t]?(?: {0,3}(?=>))?)*) {0,3}(`{3,}|~{3,})[ \t]*$/);
      // A closer may be indented at most three spaces past its container's
      // content column, not past the opener's own indentation.
      if (c && c[1].length <= (fence.listFirst ? fence.col : 0) + 3 && (fence.listFirst ? quoteDepth(line.slice(Math.min(c[1].length, fence.col))) : quoteDepth(line)) === fence.quote && c[3][0] === fence.ch && c[3].length >= fence.len) { fence = null; afterBlock = true; }
      para = false;
      out.push(keepCode ? line : '');
      continue;
    }
    if (m && !(m[1][0] === '`' && m[2].includes('`'))) {
      const at = line.length - m[1].length - m[2].length;
      // The column where the fence's list item content starts, past its
      // quote markers: the last list marker before the fence, or the
      // current item's indent when the fence continues one.
      const pre = line.slice(0, at).replace(/^(?: {0,3}>[ \t]?)+/, '');
      const marks = [...pre.matchAll(/(?:[-*+]|\d{1,9}[.)])[ \t]+/g)];
      const col = marks.length ? marks.at(-1).index + marks.at(-1)[0].length : inList && quoteDepth(line) >= listQuote ? (items.filter((c) => c <= at).at(-1) ?? 0) : 0;
      const prefix = line.slice(0, at);
      fence = { ch: m[1][0], len: m[1].length, quote: (prefix.match(/>/g) || []).length, col, listFirst: /^\s*(?:[-*+]|\d{1,9}[.)])[ \t]/.test(prefix) || (inList && quoteDepth(line) >= listQuote && !/^ {0,3}>/.test(line) && col > 0) };
      prevBlank = false;
      para = false;
      out.push(keepCode ? line : '');
      continue;
    }
    // Measured after the `>` markers, where a quoted list item's content is.
    const lead = inner.match(/^ */)[0].length;
    // Left of the outermost item's content, a line that is not a lazy
    // paragraph continuation has left the list, indented or not: after
    // `-    <!-- x`, `    <!-- TODO` is indented code outside the item.
    if (inList && !blank && !para && (lead < (items[0] ?? listIndent) || quoteDepth(line) < listQuote) && !/^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/.test(inner)) { inList = false; items.length = 0; }
    const codeAt = inList ? (items.at(-1) ?? listIndent) + 4 : 4;
    if (!blank && (isIndented && !inList || inList && lead >= codeAt) && (prevBlank || afterBlock || !para || quoteDepth(line) > paraQuote)) {
      indented = codeAt;
      paraQuote = 0;
      prevBlank = false;
      para = false;
      out.push(keepCode ? line : '');
      continue;
    }
    // A line that starts inside a code span continued from the line above
    // is code at its start: with `hideSpanLines` it is left out, so a tag
    // there is never read as raw HTML.
    const inSpan = Boolean(st.span);
    const spanRun = st.span;
    // A line that starts with a comment is an HTML block to its end, also
    // as the first block of a list item (`- <!--`) or at a list item's
    // content column.
    // A marker followed by five or more spaces opens its item with one:
    // the rest is indented code there (`-     <!--` is code, not a comment).
    const afterMarkers = line.replace(/^(?:(?: {0,3}>[ \t]?)|(?: {0,3}(?:[-*+]|\d{1,9}[.)])(?: {1,4}(?! )| )))+/, '');
    const markerLead = afterMarkers.match(/^ */)[0].length;
    // As for a fence, `2. <!--` after paragraph text is more of that
    // paragraph: only a list starting at 1 may interrupt one.
    const lateOrdered = /^ {0,3}(?:>[ \t]?)*\s*(\d{1,9})[.)][ \t]/.exec(line);
    // A paragraph inside a quote is not continued by a line outside it.
    const interrupts = !(lateOrdered && Number(lateOrdered[1]) !== 1 && para && (!inList || inItemText) && quoteDepth(line) >= paraQuote);
    const blockComment = !st.span && interrupts && /^ *<!--/.test(afterMarkers) && (afterMarkers !== line.replace(/^(?: {0,3}>[ \t]?)+/, '') ? markerLead < 4 : markerLead - (inList && quoteDepth(line) >= listQuote ? (items.filter((c) => c <= markerLead).at(-1) ?? 0) : 0) < 4);
    // Where the comment itself starts: after `- > ` it is inside the item.
    const commentLead = Math.max(0, line.replace(/^(?: {0,3}>[ \t]?)+/, '').indexOf('<!--'));
    if (blockComment) htmlTail = true;
    // `-     x` opens its item with indented code: no comment starts there,
    // and no paragraph that a later line could continue.
    const codeItem = interrupts && !st.span && afterMarkers !== inner && markerLead >= 4 && afterMarkers.trim() !== '';
    const stripped = codeItem ? { text: line, open: false } : stripComments(line, st, closesLater, blockComment, commentClosesLater, hideUnclosed);
    // Remember the container the comment opened in (see above).
    if (stripped.open) {
      const q = line.replace(/^(?: {0,3}>[ \t]?)+/, '');
      // Every marker on the line counts: `- - <!--` sits in the inner item.
      const mk = q.match(/^ *(?:(?:[-*+]|\d{1,9}[.)])(?: {1,4}(?! )| ))+/);
      const itemCol = inList && quoteDepth(line) >= listQuote ? (items.filter((c) => c <= q.match(/^ */)[0].length).at(-1) ?? 0) : 0;
      // Quotes after a list marker count too (`- > <!--`): the comment
      // ends where a line leaves that quote, as in CommonMark.
      const pre = line.slice(0, Math.max(0, line.indexOf('<!--')));
      const quote = /^[ \t>*+\-\d.)]*$/.test(pre) ? (pre.match(/>/g) || []).length : quoteDepth(line);
      inComment = { quote, col: mk ? mk[0].length : itemCol, block: blockComment };
    } else inComment = false;
    line = stripped.text;
    // A span that opens here and continues: with `hideSpanLines`, only the
    // text before its opening run is judged (what follows is code).
    if (hideSpanLines && !inSpan && st.span) line = line.slice(0, st.spanAt);
    // Marked so it is still counted as text but never read as a heading,
    // a list item or a fence. U+0001 is not a word character.
    // Placed after any list markers too, so `- <!--` still opens its item.
    if (htmlTail && line.replace(/^(?: {0,3}>[ \t]?)+/, '').trim() !== '') line = line.replace(/^((?: {0,3}>[ \t]?| {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+)*)/, '$1\u0001');
    // List markers are read after the `>` markers too (`> 10. item`).
    const qline = line.replace(/^(?: {0,3}>[ \t]?)+/, '');
    // An empty item (`-` alone) cannot interrupt a paragraph: right after
    // paragraph text, in the same container, it is more of that paragraph
    // or its setext underline. Left of a list item's content it is a new item.
    const bareAfterText = para && !prevBlank && (!inList || inItemText) && /^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]*$/.test(qline);
    const nowBlank = qline.trim() === '' && !inlineTail;
    // The list item the previous line belonged to, before this line can end it.
    const itemColBefore = inList ? (items.at(-1) ?? listIndent) : 0;
    let newItem = false;
    // A heading or a thematic break interrupts a list, blank line or not.
    // So does a block quote that starts left of the item's content.
    // Only left of the item's content: `  ## Details` under `- item` is a
    // heading inside the item, and the item goes on.
    const breaksList = (/^ {0,3}(#{1,6}([ \t]|$)|([-*_])([ \t]*\3){2,}[ \t]*$)/.test(qline)
        && !(inList && qline.match(/^ */)[0].length >= (items.at(-1) ?? listIndent)))
      || (inList && /^ {0,3}>/.test(line) && line.match(/^ */)[0].length < (items.at(-1) ?? listIndent));
    if (!nowBlank && !/^( {4}|\t)/.test(qline)) {
      // `2. x` after paragraph text continues the paragraph: no list starts.
      const item = breaksList || !interrupts || bareAfterText ? null : qline.match(/^ {0,3}(?:[-*+]|\d{1,9}[.)])(?: {1,4}(?! )| |$)/);
      if (item) listIndent = markerCols(qline, item).at(-1);
      // A line left of the item's content stays in it only as a lazy
      // continuation of a paragraph: after a comment block or code it is
      // outside the list.
      // After a blank line, only a line at the item's content column
      // continues it.
      const at = Math.max(line.match(/^ */)[0].length, qline.match(/^ */)[0].length);
      inList = Boolean(item) || (inList && !breaksList && (prevBlank ? at >= itemColBefore : (para || at >= itemColBefore)));
      newItem = Boolean(item);
    }
    if (!nowBlank) {
      const at = qline.match(/^ */)[0].length;
      const marker = breaksList || !interrupts || bareAfterText ? null : qline.match(/^ *(?:[-*+]|\d{1,9}[.)])(?: {1,4}(?! )| |$)/);
      if (marker && at < (items.at(-1) ?? 0) + 4) {
        while (items.length && items.at(-1) > at) items.pop();
        const cols = markerCols(qline, marker);
        items.push(...cols);
        listQuote = quoteDepth(line);
        emptyItem = qline.slice(cols.at(-1)).trim() === '';
      } else if (prevBlank) {
        // After a blank line, a less indented line has left those items.
        while (items.length && items.at(-1) > at) items.pop();
      }
    }
    // A comment block left of the list's content ends the list (an HTML
    // block interrupts it, blank line or not).
    if (blockComment && inList && commentLead < listIndent) inList = false;
    if (!nowBlank && !(inList && items.length && emptyItem && newItem)) emptyItem = false;
    if (nowBlank && emptyItem && inList) {
      emptyItem = false;
      items.pop();
      if (items.length) listIndent = items.at(-1); else inList = false;
    }
    if (!inList) items.length = 0;
    const wasBlank = prevBlank;
    prevBlank = nowBlank;
    // The quote depth of the paragraph this line may underline, before
    // this line updates it: a deeper quote starts a new paragraph.
    const prevParaQuote = paraQuote;
    paraQuote = nowBlank ? 0 : Math.max(wasBlank ? 0 : paraQuote, quoteDepth(lines[n]));
    // Judged after the `>` markers, like blankness and indentation.
    // Only the part inside the span is hidden: when it closes on this line,
    // what follows the closing run is ordinary text and is still judged.
    if (hideSpanLines && inSpan) {
      afterBlock = false;
      const at = st.span ? -1 : line.search(closer(spanRun));
      out.push(at >= 0 ? line.slice(at + spanRun.length) : '');
      continue;
    }
    // A setext underline (`===` or `---` under paragraph text) completes a
    // heading too.
    // A heading that opens a list item (`- ## Example`) counts as well.
    // Not after `2. ` that continues a paragraph: `2. ## x` is paragraph text.
    const block = interrupts ? qline.replace(/^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+(?=#)/, '') : qline;
    afterBlock = /^ {0,3}(#{1,6}([ \t]|$)|([-*_])([ \t]*\3){2,}[ \t]*$)/.test(block)
      || (!wasBlank && para && /^ {0,3}(=+|-+)[ \t]*$/.test(qline)
        // A setext underline is never a lazy line: outside the quote or the
        // list item that holds the paragraph, it is paragraph text.
        && quoteDepth(lines[n]) === prevParaQuote
        // And under exactly the containers of the line above (list markers
        // read as their width): `  > more` / `> ===` are not one paragraph.
        // In doubt this is no underline, which can only count more words.
        // (A bare `-` here is no marker: see bareAfterText.)
        && (bareAfterText || containerPrefix(lines[n]) === paraPrefix)
        && !(inList && qline.match(/^ */)[0].length < (items.at(-1) ?? listIndent)));
    // The containers a paragraph opened in, from its first line: a lazy
    // line after it does not move the paragraph.
    const wasPara = para;
    para = !nowBlank && !afterBlock && (!htmlTail || inlineTail);
    // A marker with nothing after it (`-` alone) opens no paragraph.
    if (newItem && emptyItem) para = false;
    // A new list item starts a new paragraph too, in its own containers.
    if (para && (!wasPara || newItem)) {
      paraPrefix = containerPrefix(lines[n]);
      paraQuote = quoteDepth(lines[n]);
    }
    if (codeItem) {
      para = false;
      indented = inner.length - afterMarkers.length + 4;
      // The code is shown only where code is kept, as for any code block.
      if (!keepCode) line = line.slice(0, line.length - afterMarkers.length);
    }
    out.push(line);
  }
  return out.join('\n');
}

// Headings a reader sees: none inside HTML comments or fenced examples.
// An optional closing run of `#` (`## Goals ##`) is not part of the text.
// An H2, also inside block quotes and list items in any nesting (`> ## X`,
// `- ## X`, `- > ## X`). After
// a list marker the heading starts within four spaces (five make indented
// code), and an ordered item other than `1.` cannot interrupt a paragraph,
// so it needs a blank line (or a block quote line) before it.
const ATX_H2 = /^((?: {0,3}>[ \t]?| {0,3}(?:[-*+]|\d{1,9}[.)]) {1,4})*)( {0,3})##[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
export function headings(body) {
  // A heading counts only if no reading of an unclosed comment hides it.
  const lines = visibleText(body, { hideUnclosed: true }).split('\n');
  const found = [];
  lines.forEach((l, i) => {
    const m = ATX_H2.exec(l);
    if (!m) return;
    const [, prefix, indent, text] = m;
    // Right after a list marker the heading starts within its four spaces.
    if (/(?:[-*+]|\d[.)]) {1,4}$/.test(prefix) && indent) return;
    const markers = prefix;
    // Only the outermost list marker can interrupt the paragraph before it;
    // a list nested in that new item is its first block and may start at 2.
    const first = /(?:^|[ \t>])(?:[-*+]|(\d{1,9})[.)]) /.exec(markers);
    // Inside the same block quotes: the line before, read without its `>`.
    const before = i === 0 ? '' : lines[i - 1].replace(/^(?: {0,3}>[ \t]?)*/, '');
    // A blank line, a heading or a thematic break (`---`, `***`, `___`; as a
    // setext underline it ends a paragraph just the same) ends the block.
    const afterBlank = i === 0 || /^[ \t]*$/.test(before) || /^ {0,3}#{1,6}(?:[ \t]|$)/.test(before) || /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(before);
    if (first?.[1] !== undefined && Number(first[1]) !== 1 && !afterBlank) return;
    found.push(text);
  });
  return found;
}

export function wordCount(body) {
  // Count prose only: what a reader sees, without HTML comments (template
  // guidance) or fenced code (``` or ~~~), by the same rules as headings.
  // Link destinations and titles, and reference definitions (`[x]: url`),
  // are never shown either (see definitions()).
  const lines = visibleText(body).split('\n');
  const defs = definitions(lines);
  // A full reference link (`[shown][label]`) with a defined label shows
  // only its text; after an escaped opener the label is a link of its own.
  const labels = new Set([...defs.values()].filter(Boolean));
  const dropLabels = (l) => l.replace(/(?<!\\)(\[(?:[^\[\]\\\n]|\\.)*\])\[((?:[^\[\]\\\n]|\\.)+)\]/g, (m, text, l2) => (labels.has(label(l2)) ? text : m));
  // Link targets, defined labels and references are read as rendered, but
  // only outside code spans; in a paragraph where a code span may be open
  // across lines the raw text is counted (more).
  let openSpan = false;
  const prose = lines.map((l, i) => {
    if (/^(?: {0,3}>[ \t]?)*[ \t]*$/.test(l)) openSpan = false;
    if (defs.has(i)) return '';
    const shown = openSpan ? null : outsideCode(l, (t) => decodeReferences(dropLabels(dropValidLinkTargets(t))));
    if (shown === null) { openSpan = true; return l; }
    return shown;
  }).join('\n');
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

// For counting, only a well-formed inline destination is left out
// (`](url)`, `](<a b>)`, `](url "title")`): `[b](c d e)` is no link and its
// words are shown. Leaving a malformed one in can only count more.
// Parentheses in a bare destination nest when balanced (`foo(bar(baz))`):
// up to eight levels are read, a deeper one is left as text (counts more).
// A backslash escapes only ASCII punctuation: `foo\ <x>` is no destination.
const ESCAPED = String.raw`\\[!-\/:-@\[-\`{-~]`;
const BALANCED = (depth) => (depth === 0
  ? String.raw`(?:[^\s()\\]|${ESCAPED})*`
  : String.raw`(?:[^\s()\\]|${ESCAPED}|\(${BALANCED(depth - 1)}\))*`);
const LINK_DEST = String.raw`(?:<[^<>\n]*>|${BALANCED(8)})`;
const LINK_TITLE = String.raw`(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\((?:[^()\\\n]|\\.)*\))`;
// Up to one line ending is allowed in each gap (`](\nurl)`), as CommonMark does.
const GAP = String.raw`[ \t]*(?:\n[ \t]*)?`;
const INLINE_TARGET = String.raw`\(${GAP}${LINK_DEST}(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)${LINK_TITLE})?${GAP}\)`;
// Only after an unescaped `[` opener, with no brackets in the link text: a
// bare `](x)` is text, and so is `[a [b](c)](x)`'s outer part (a link holds
// no link). One pass only, so a stripped link never forms a new one.
const INLINE_LINK = String.raw`(?<!\\)\[((?:[^\[\]\\\n]|\\.)*)\]${INLINE_TARGET}`;
function dropValidLinkTargets(text) {
  return text.replace(new RegExp(INLINE_LINK, 'g'), '[$1]');
}

// A reference definition (`[x]: url "title"`) is never shown. Only a whole
// well-formed line counts (`[x]: <details> garbage` is a paragraph), it
// cannot interrupt a paragraph (so only after a blank line or another
// definition), and its title may sit alone on the next line. Returns line
// index -> normalized label (null for a title line). Missing a definition
// only counts more words and refuses more HTML.
const DEF_DEST = String.raw`(?:<[^<>\n]*>|(?:[^\s()\\<]|${ESCAPED}|\(${BALANCED(7)}\))${BALANCED(8)})`;
// A label may hold escaped brackets (`[a\]b]`), never a bare one, and
// needs one character that is not a space.
const LABEL_CHAR = String.raw`(?:[^\[\]\\\n]|${ESCAPED}|\\(?![!-\/:-@\[-\`{-~]))`;
const LABEL = String.raw`\[(${LABEL_CHAR}*(?:[^\s\[\]\\]|${ESCAPED})${LABEL_CHAR}*)\]`;
// Block quotes and list items in any order (`- > [r]: /url`); right after a
// list marker the content starts at once, else up to three spaces.
const CONTAINERS = String.raw`(?: {0,3}>[ \t]?| {0,3}(?:[-*+]|\d{1,9}[.)]) {1,4})*(?<![-*+.)] {1,4})(?: {0,3})|(?: {0,3}>[ \t]?| {0,3}(?:[-*+]|\d{1,9}[.)]) {1,4})*(?<=[-*+.)] {1,4})`;
const DEF_LINE = new RegExp(String.raw`^(?:${CONTAINERS})${LABEL}:[ \t]*${DEF_DEST}([ \t]+${LINK_TITLE})?[ \t]*$`);
const DEF_TITLE_LINE = new RegExp(String.raw`^(?: {0,3}>[ \t]?)*[ \t]*${LINK_TITLE}[ \t]*$`);
// A label alone (`[r]:`), its destination on the next line. That line is
// never a setext underline or a thematic break, which end the paragraph.
const DEF_OPEN = new RegExp(String.raw`^(?:${CONTAINERS})${LABEL}:[ \t]*$`);
const DEF_REST = new RegExp(String.raw`^(?: {0,3}>[ \t]?)*[ \t]*${DEF_DEST}([ \t]+${LINK_TITLE})?[ \t]*$`);
const BLOCK_END = /^(?: {0,3}>[ \t]?)* {0,3}(?:=+|-+|(?:([-*_])(?:[ \t]*\1){2,}))[ \t]*$/;
// Labels match case-insensitively by Unicode case folding: `ẞ` matches
// `ss`. Lower then upper case, as commonmark.js does it.
const label = (l) => l.trim().replace(/\s+/g, ' ').toLowerCase().toUpperCase();
// A label may span lines (`[foo` / `bar]: /url`): its first line, a middle
// line, and the line that closes it with the destination.
const LABEL_OPEN = new RegExp(String.raw`^(?:${CONTAINERS})\[(${LABEL_CHAR}*)$`);
const LABEL_MID = new RegExp(String.raw`^(?: {0,3}>[ \t]?)*[ \t]*(${LABEL_CHAR}*)$`);
const LABEL_TAIL = new RegExp(String.raw`^(?: {0,3}>[ \t]?)*[ \t]*(${LABEL_CHAR}*)\]:[ \t]*${DEF_DEST}([ \t]+${LINK_TITLE})?[ \t]*$`);
// A line that ends a paragraph instead of continuing a label.
const INTERRUPTS = /^ {0,3}(?:#{1,6}(?:[ \t]|$)|`{3,}|~{3,}|[-*+][ \t]|1[.)][ \t]|([-*_])(?:[ \t]*\1){2,}[ \t]*$)/;

// How many block quotes a line opens, counting `>` markers among list
// markers too (`- > x` is one; quoteDepth() reads leading quotes only). A
// definition's title or destination on the next line belongs to it only
// within the same quotes or fewer (a lazy line): one more `>` opens a new
// block quote instead.
const containerQuotes = (l) => (/^(?: {0,3}>[ \t]?| {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+)*/.exec(l)[0].match(/>/g) || []).length;
function definitions(lines) {
  const defs = new Map();
  // Each label as written, for text that is read with its references
  // decoded (`[f&#111;o]` is matched as written, and shows as `foo`).
  const raw = [];
  defs.raw = raw;
  let titleMayFollow = false;
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (titleMayFollow && containerQuotes(l) <= depth && DEF_TITLE_LINE.test(l)) {
      defs.set(i, null);
      titleMayFollow = false;
      continue;
    }
    // A list item opens a new block even right after prose: a bullet, or an
    // ordered item starting at 1 (others cannot interrupt a paragraph).
    const opensItem = /^(?: {0,3}>[ \t]?)* {0,3}(?:[-*+]|1[.)]) {1,4}\S/.test(l);
    // So does anything after a line that always ends its block: an ATX
    // heading or a thematic break. (`===` or `--` is text where no paragraph
    // stands above it, so a setext underline is not counted: missing a
    // definition only counts more.)
    const ended = i > 0 && /^(?: {0,3}>[ \t]?)* {0,3}(?:#{1,6}(?:[ \t].*)?|([-*_])(?:[ \t]*\1){2,}[ \t]*)$/.test(lines[i - 1]);
    // After a definition the paragraph goes on: an ordered item that cannot
    // interrupt one (`2.`) is text there, not a new block.
    const continues = !opensItem && /^(?: {0,3}>[ \t]?)* {0,3}\d{1,9}[.)]/.test(l);
    const blockStart = i === 0 || (defs.has(i - 1) && !continues) || opensItem || ended || /^(?: {0,3}>[ \t]?)*[ \t]*$/.test(lines[i - 1]);
    // A label holds at most 999 characters; a longer one is no label, and
    // the line is ordinary text.
    const m = DEF_LINE.exec(l);
    if (m && blockStart && m[1].length <= 999) {
      defs.set(i, label(m[1]));
      raw.push(m[1]);
      titleMayFollow = !m[2];
      depth = containerQuotes(l);
      continue;
    }
    const open = DEF_OPEN.exec(l);
    const rest = open && open[1].length <= 999 && blockStart && i + 1 < lines.length && !BLOCK_END.test(lines[i + 1]) && containerQuotes(lines[i + 1]) <= containerQuotes(l)
      // An HTML block start (`<details>`) interrupts the paragraph: it is never
      // the destination, however much it looks like `<url>`.
      && !HTML_INTERRUPT.test(lines[i + 1].replace(/^(?: {0,3}>[ \t]?)*/, '')) ? DEF_REST.exec(lines[i + 1]) : null;
    if (rest) {
      defs.set(i, label(open[1]));
      raw.push(open[1]);
      defs.set(i + 1, null);
      titleMayFollow = !rest[1];
      depth = containerQuotes(l);
      i += 1;
      continue;
    }
    const head = blockStart ? LABEL_OPEN.exec(l) : null;
    if (head) {
      const parts = [head[1]];
      let tail = null;
      let j = i + 1;
      for (; j < lines.length; j++) {
        const ln = lines[j];
        const inner = ln.replace(/^(?: {0,3}>[ \t]?)*/, '');
        if (inner.trim() === '' || containerQuotes(ln) > containerQuotes(l) || INTERRUPTS.test(inner) || HTML_INTERRUPT.test(inner)) break;
        tail = LABEL_TAIL.exec(ln);
        if (tail) break;
        const mid = LABEL_MID.exec(ln);
        if (!mid) break;
        parts.push(mid[1]);
      }
      const whole = tail ? [...parts, tail[1]].join('\n') : '';
      if (tail && whole.length <= 999 && /\S/.test(whole)) {
        for (let k = i + 1; k <= j; k++) defs.set(k, null);
        defs.set(i, label(whole));
        raw.push(whole);
        titleMayFollow = !tail[2];
        depth = containerQuotes(l);
        i = j;
        continue;
      }
    }
    titleMayFollow = false;
  }
  return defs;
}

// requestedDepth is what project.md asks for this doc; documentDepth is what
// the doc says it was written at. The cap follows the doc. A doc written at
// quick depth where thorough is requested needs deepening; it is never
// reported as thorough just because the project setting changed.
export function validateDoc(name, text, requestedDepth = 'quick', checkins = undefined) {
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
  // With `checkins: none` nothing is asked, so no doc can have been written
  // thorough, whatever its own frontmatter claims.
  if (checkins === 'none' && documentDepth === 'thorough') {
    fail('checkins', '"checkins: none" in project.md asks nothing, so this doc must be quick: set depth: quick');
  }
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
  // Anywhere in a line, not only at its start: inline HTML stays raw, and
  // `intro <details>` ... `</details>` collapses the sections between.
  // A link destination (`[x](<details>)`) is never raw HTML: it is left out.
  // A well-formed reference definition (`[x]: <details>`) is no HTML either.
  const htmlLines = visibleText(body, { hideSpanLines: true }).split('\n');
  const htmlDefs = definitions(htmlLines);
  const html = htmlLines.find((l, i) => !htmlDefs.has(i) && /<\/?[A-Za-z][A-Za-z0-9-]*(?=[\s/>]|$)|<\?|<![A-Za-z]|<!\[CDATA\[/.test(dropValidLinkTargets(textOutsideCodeSpans(l))));
  if (html !== undefined) fail('html', `raw HTML is not allowed (found: ${html.trim().slice(0, 40)}); use Markdown`);

  const found = headings(body);
  // `## **Goals**` and `## `Goals`` render as Goals: inline markup is
  // read through when matching a required section, but only paired markup
  // that forms emphasis or code (`_` not inside a word). A lone or unpaired
  // marker, and `~` (CommonMark has no strikethrough), is text.
  // A link shows its text only when it is one: a well-formed inline
  // destination, or a reference whose label is defined.
  const defined = definitions(visibleText(body).split('\n'));
  const labels = new Set([...defined.values()].filter(Boolean));
  // The placeholder check reads text with its references already decoded,
  // so a label written with one (`[f&#111;o]`) is looked up decoded there.
  const shownLabels = new Set([...labels, ...defined.raw.map((l) => label(decodeReferences(l)))]);
  // `## Wh&#121;` renders as Why: references are decoded last, as text.
  // `don\'t` renders as don't, and an escaped marker (`\*`) stays literal:
  // escapes are set aside first and put back as the bare character.
  const ESC = 0xe000;
  const CODE = 0xe100;
  // A label is matched as written, its escapes included.
  const raw = (l) => l.replace(/[-]/g, (c) => `\\${String.fromCharCode(c.charCodeAt(0) - ESC)}`);
  const plain = (h) => {
    // Code spans first: their content is literal (no escapes, emphasis or
    // links inside), so it is set aside whole and put back last. An opener
    // after a backslash is no opener.
    const code = [];
    let t = h.replace(/(?<![`\\])(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g, (m, ticks, c) => {
      code.push(/^ [\s\S]* $/.test(c) && /[^ ]/.test(c) ? c.slice(1, -1) : c);
      return String.fromCharCode(CODE + code.length - 1);
    });
    t = t.replace(/\\([!-/:-@[-`{-~])/g, (m, c) => String.fromCharCode(ESC + c.charCodeAt(0)))
      .replace(new RegExp(INLINE_LINK, 'g'), '$1')
      .replace(/\[([^\[\]\n]*)\]\[([^\[\]\n]*)\]/g, (m, x, l) => (labels.has(label(raw(l || x))) ? x : m))
      .replace(/\[([^\[\]\n]+)\](?!\[)/g, (m, x) => (labels.has(label(raw(x))) ? x : m))
      .replace(/(\*+)(?![\s*])([^*]+?)(?<![\s*])\1/g, '$2')
      .replace(/(?<![\p{L}\p{N}_])(_+)(?![\s_])([^_]+?)(?<![\s_])\1(?![\p{L}\p{N}_])/gu, '$2');
    return decodeReferences(t)
      .replace(/[-]/g, (c) => String.fromCharCode(c.charCodeAt(0) - ESC))
      .replace(/[-]/g, (c) => code[c.charCodeAt(0) - CODE] ?? c)
      .trim();
  };
  const missing = spec.sections.filter((s) => !found.some((h) => h.toLowerCase() === s.toLowerCase() || plain(h).toLowerCase() === s.toLowerCase()));
  for (const s of missing) fail('sections', `missing section "## ${s}"`);

  const words = wordCount(body);
  const cap = spec.maxWords[depth];
  if (words > cap) {
    fail('cap', `${words} words, ${depth} cap is ${cap}. Cut, or move the why to dybs/log.md or context/decisions/`);
  } else if (words > cap * 0.9) {
    warnings.push(`${words} words, close to the ${depth} cap of ${cap}`);
  }

  // Inline formatting can split a placeholder that still reads whole
  // (`T**O**DO`, `[TO](x)DO`), so it is also checked with emphasis, code
  // and link markup removed. That can only find more, never fewer.
  const shown = decodeReferences(visibleText(body, { keepCode: true }));
  // Backslash escapes of punctuation (`\{\{x\}\}`) render as the bare character.
  // An escaped marker (`T\*O\*DO`) is text, not formatting: escapes are set
  // aside before the markup is removed and come back as the bare character.
  // Only a well-formed link loses its destination: `T[O](bad destination)DO`
  // is no link, and shows no TODO.
  // A full or collapsed reference link with a defined label shows its text
  // only: `T[O][r]DO` reads TODO.
  // Only brackets of a link that resolves go (marked here, dropped below):
  // `T[O]DO` with no destination and no defined label shows its brackets.
  const LINK = (t) => `\ue0f0${t}\ue0f1`;
  const flatMarked = shown
    .replace(new RegExp(INLINE_LINK, 'g'), (m, t) => LINK(t))
    .replace(/(?<!\\)(\[(?:[^\[\]\\\n]|\\.)*\])\[((?:[^\[\]\\\n]|\\.)*)\]/g, (m, t, l) => (shownLabels.has(label(l || t.slice(1, -1))) ? LINK(t.slice(1, -1)) : m))
    .replace(/(?<!\\)\[((?:[^\[\]\\\n]|\\.)+)\](?!\[(?:[^\[\]\\\n]|\\.)*\])/g, (m, x) => (shownLabels.has(label(x)) ? LINK(x) : m))
    .replace(/\\([!-/:-@[-`{-~])/g, (m, c) => String.fromCharCode(0xe000 + c.charCodeAt(0)))
    // Only markup that renders as such is read through: code spans, paired
    // `*` emphasis, and `_` emphasis at word boundaries (`T_O_DO` stays as
    // written). Resolved link brackets go; `~` is text in CommonMark.
    .replace(/(`+)([^`]+?)\1/g, '$2')
    .replace(/(\*+)(?![\s*])([^*]+?)(?<![\s*])\1/g, '$2')
    .replace(/(?<![\p{L}\p{N}_])(_+)(?![\s_])([^_]+?)(?<![\s_])\1(?![\p{L}\p{N}_])/gu, '$2')
    .replace(/[\ue0f0\ue0f1]/g, '');
  const unescape = (t) => t.replace(/[\ue000-\ue07f]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xe000));
  const flat = unescape(flatMarked);
  // Delimiter runs that overlap (`*T**O***DO` is emphasis around strong
  // emphasis) are not paired above; with every unescaped `*` gone, such a
  // placeholder still shows. A literal `*` inside a placeholder word is
  // all this could misread, which no doc writes.
  const loose = unescape(flatMarked.replace(/\*+/g, ''));
  const frontmatterValues = Object.values(data || {}).join('\n');
  if (PLACEHOLDER.test(shown) || PLACEHOLDER.test(flat) || PLACEHOLDER.test(loose) || PLACEHOLDER.test(decodeReferences(frontmatterValues))) {
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

// The method rules must be a readable file: a folder (or anything else) at
// that name is present but holds no rules for the skills to follow. One
// home for the check, used by validation and by acceptance alike.
function readmeProblem(root) {
  const readme = join(root, 'dybs', 'README.md');
  if (!existsSync(readme)) return 'missing dybs/README.md (the method rules). Run dybs-start to restore it.';
  if (!statSync(readme).isFile()) return 'dybs/README.md is not a file, so the method rules cannot be read. Move it aside and run dybs-start to restore it.';
  // Never read through a link on the way (`dybs/` itself included): asked
  // before the read and again after it, as for the docs.
  const linked = () => {
    const unsafe = unsafePath(root, 'dybs/README.md');
    return unsafe ? `${unsafe}: keep dybs/ and its method rules as real files, then run dybs-start to restore them` : null;
  };
  const before = linked();
  if (before) return before;
  // A file the skills cannot read is as good as missing.
  try { if (readRegular(readme) === null) return 'dybs/README.md is not a file, so the method rules cannot be read. Move it aside and run dybs-start to restore it.'; } catch (e) {
    return `dybs/README.md cannot be read (${e.code || e.message}), so the method rules are unavailable. Fix its permissions.`;
  }
  return linked();
}

// Reads a file only if it is a regular file. Opened without blocking, so a
// FIFO or a device at a doc's name never hangs the check, and judged on the
// open descriptor, not on a separate look at the name. Never through a
// link at its own name (O_NOFOLLOW), and only while the opened file is what
// the name itself is (same device and inode, not a link). null otherwise.
function readRegular(p) {
  let fd;
  try { fd = openSync(p, fsConstants.O_RDONLY | (fsConstants.O_NONBLOCK ?? 0) | (fsConstants.O_NOFOLLOW ?? 0)); } catch (e) {
    if (e.code === 'ELOOP' || e.code === 'EMLINK') return null;
    throw e;
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) return null;
    const own = lstatSync(p);
    if (own.isSymbolicLink() || own.dev !== st.dev || own.ino !== st.ino) return null;
    return readFileSync(fd, 'utf8');
  } finally { closeSync(fd); }
}
// The same for a doc that was already checked to be a regular file: one
// swapped since is an error, never a read that can hang.
function readDoc(p) {
  const t = readRegular(p);
  if (t === null) throw new Error(`${p} is not a regular file`);
  return t;
}

// Whether a path is there: only ENOENT and ENOTDIR mean "missing". Any
// other failure (a folder that cannot be searched, an I/O error) is
// returned as its code, so an unreadable tree is never a passing "missing".
function lookup(p) {
  try { statSync(p); return 'present'; } catch (e) {
    return e.code === 'ENOENT' || e.code === 'ENOTDIR' ? 'missing' : (e.code || e.message);
  }
}

// Test seams: right after project.md is read for its settings, and right
// before each doc is read.
export const validateHooks = { afterSettings: null, beforeRead: null };

export function validateProject(root, only) {
  const dir = join(root, 'dybs');
  const results = [];
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return { ok: false, complete: false, accepted: false, fatal: `no dybs/ folder in ${root}. Run the dybs-start skill first.`, results };
  }
  const readme = readmeProblem(root);
  if (readme) results.push({ name: 'readme', file: 'README.md', status: null, words: 0, errors: [readme], warnings: [] });

  const projectPath = join(dir, DOCS.project.file);
  // A linked project.md is never opened: the loop below reports it.
  const projectText = lookup(projectPath) === 'present' && !unsafePath(root, `dybs/${DOCS.project.file}`) ? readRegular(projectPath) : null;
  const projectData = projectText === null ? null : parseFrontmatter(projectText).data;
  validateHooks.afterSettings?.();
  const skip = skipped(projectData);

  for (const name of ORDER) {
    // project.md holds the settings every doc is checked against, so it is
    // validated with any single doc too.
    // So are the docs it cannot be written without: `--doc ui` must not pass
    // a doc that `--accept ui` would then refuse for a missing ux.md.
    const required = only && (REQUIRES[only] || []).includes(name);
    if (only && name !== only && name !== 'project' && !required) continue;
    const spec = DOCS[name];
    const path = join(dir, spec.file);
    // project.md holds the settings, so it can never skip itself.
    if (skip.has(name) && name !== 'project') {
      // A doc asked for by name is never reported as passing unchecked.
      const errors = only === name ? [`${spec.file} is under skip: in project.md, so it is not validated; remove it from skip: to check it`] : [];
      results.push({ name, file: spec.file, status: 'skipped', words: 0, errors, warnings: [] });
      continue;
    }
    const where = lookup(path);
    if (where !== 'present' && where !== 'missing') {
      results.push({ name, file: spec.file, status: null, words: 0, errors: [`${spec.file} cannot be reached (${where}): fix the permissions of dybs/ and its folders`], warnings: [] });
      continue;
    }
    if (where === 'missing') {
      // A doc asked for by name must exist: `--doc` passing is the check
      // before a check-in, and "it is not there" is not a pass.
      const errors = only && (only === name || name === 'project') ? [`${spec.file} does not exist yet`]
        : required ? [`${spec.file} does not exist yet: ${only} cannot be written without it`] : [];
      results.push({ name, file: spec.file, status: 'missing', words: 0, errors, warnings: [] });
      continue;
    }
    // Judged by the rules --accept uses: a doc reached through a link (at
    // its name or a folder on the way) never passes, or --doc would pass a
    // doc that cannot be accepted.
    const unsafe = unsafePath(root, `dybs/${spec.file}`);
    if (unsafe) {
      results.push({ name, file: spec.file, status: null, words: 0, errors: [`${unsafe}: keep the docs as real files in dybs/`], warnings: [] });
      continue;
    }
    // project.md is validated from the very bytes its settings came from:
    // a save in between would otherwise mix two versions in one result.
    if (!(name === 'project' && projectText !== null)) validateHooks.beforeRead?.(path);
    const text = name === 'project' && projectText !== null ? projectText : readRegular(path);
    // The name itself is read without following a link; a folder on the way
    // swapped for one around the read is caught by asking again after it.
    const swapped = text !== null && unsafePath(root, `dybs/${spec.file}`);
    if (swapped) {
      results.push({ name, file: spec.file, status: null, words: 0, errors: [`${swapped}: keep the docs as real files in dybs/`], warnings: [] });
      continue;
    }
    if (text === null) {
      results.push({ name, file: spec.file, status: null, words: 0, errors: [`${spec.file} is not a regular file, so it cannot be read`], warnings: [] });
      continue;
    }
    results.push(validateDoc(name, text, depthFor(name, projectData), projectData?.checkins));
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
  // The same block parseFrontmatter reads, or none at all.
  if (!m || !parseFrontmatter(text).data) throw new Error('no frontmatter');
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
    try { st = part ? lstatSync(p, BIG) : statSync(p, BIG); } catch { return null; }
    if (!st.isDirectory()) return null;
    ids.push(idOf(st));
  }
  return ids.join('/');
}

// Device, inode and birth time, from a bigint stat: a freed inode number is
// reused at once (ext4), so device and inode alone can make a later file
// look like one this run created and removed.
const idOf = (st) => `${st.dev}:${st.ino}:${st.birthtimeNs ?? ''}`;
const BIG = { bigint: true };
function isRegularFile(p) {
  try { return lstatSync(p).isFile(); } catch { return false; }
}
function pathId(p) {
  try { return idOf(lstatSync(p, BIG)); } catch { return null; }
}
// The text of exactly the file `id` at `p`, or null: opened without
// following a link at the name, type and identity checked on the open
// descriptor, and that descriptor read. A check of the name followed by a
// read of the name could read whatever replaced it in between.
function readById(p, id) {
  let fd;
  try { fd = fsOps.open(p); } catch (e) {
    if (['ELOOP', 'EMLINK', 'ENOENT', 'ENOTDIR'].includes(e.code)) return null;
    throw e;
  }
  try {
    const st = fstatSync(fd, BIG);
    return st.isFile() && idOf(st) === id && stillAtName(p, st) ? readFileSync(fd, 'utf8') : null;
  } finally { closeSync(fd); }
}
// Where open() has no O_NOFOLLOW (Windows), a link at the name is followed.
// So the opened file must also be what the name itself is (no link
// followed): the same identity, and not a link.
function stillAtName(p, st) {
  try {
    const own = fsOps.lstat(p, BIG);
    return !own.isSymbolicLink() && idOf(own) === idOf(st);
  } catch { return false; }
}

// Removes `p` only while it is still the file we created.
// Moved first to a name only this run knows, then checked there: what is
// verified is exactly what gets deleted, even if something replaces `p` in
// between. One that is not ours goes back, never over anything.
// With `sole`, the file must also have no other name: one this run created
// but someone has since linked elsewhere is not removed. With `expect` (the
// text it must hold), it must also still hold it once under its private
// name: an editor writing through an open file keeps the identity, so only
// the content can tell, and an edited file is put back, not removed.
export const testHooks = { afterLook: null, beforeMove: null, beforePutBack: null };
function rmIfOurs(p, id, check, { sole = false, expect = null } = {}) {
  // Gone is gone; a lookup that fails for another reason (a folder that
  // became unsearchable, I/O) is an error, never "already removed".
  try { fsOps.lstat(p); } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return; throw e; }
  if (!id) return;
  // Another file at the name is not ours: it stays, and the caller learns of
  // it (a temporary name someone replaced is never silently left behind).
  const at = pathId(p);
  if (at === null) return;
  if (at !== id) throw Object.assign(new Error(`${p} is not the file this run wrote; it was left in place`), { keptAt: p, notOurs: true });
  testHooks.afterLook?.(p);
  check?.();
  testHooks.beforeMove?.(p);
  const aside = `${p}.${randomUUID()}.rm`;
  // Only a name that is already gone counts as removed; any other failure
  // (permissions, a lock) is the caller's to report or roll back.
  try { fsOps.rename(p, aside); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  let st = null;
  try { st = fsOps.lstat(aside, BIG); } catch { st = null; }
  let disposable = Boolean(st) && idOf(st) === id && (!sole || st.nlink === 1n);
  if (disposable && expect !== null) {
    let x = null;
    try { x = readById(aside, id); } catch { x = null; }
    disposable = x === expect;
  }
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
      fsOps.rename(aside, p);
    } catch {
      throw Object.assign(new Error(`${p} changed while it was being removed; it is kept at ${aside}`), { keptAt: aside });
    }
    throw new Error(`${p} changed while it was being removed; left in place`);
  }
  // Put back without overwriting anything: by link where the filesystem
  // has them, else as an exclusive copy (a snapshot, so the file itself is
  // then kept aside too, and named).
  // Pinned right before the put-back and checked right after: through a
  // folder swapped in between, the name would land somewhere else, and is
  // then removed again when provably the same file (or the copy just made).
  const theirs = pathId(aside);
  let how;
  const copied = {};
  try { check?.(); how = placeNoClobber(aside, p, check, theirs, copied); } catch {
    throw Object.assign(new Error(`${p} changed while it was being removed; it is kept at ${aside}`), { keptAt: aside });
  }
  try { check?.(); } catch {
    const now = pathId(p);
    if (now !== null && now === (how === 'copy' ? copied.id : pathId(aside))) { try { rmIfOurs(p, now); } catch { /* named below */ } }
    throw Object.assign(new Error(`${p} changed while it was being removed, and a folder on the way changed while it was put back; it is kept at ${aside}`), { keptAt: aside });
  }
  // The name must now be the very file put back (or the copy just made): a
  // folder swapped for a link and restored around the link passes the pins
  // while the name landed outside. Then the private name is all that is
  // left inside, and it stays.
  if (pathId(p) !== (how === 'copy' ? copied.id : theirs)) {
    throw Object.assign(new Error(`${p} changed while it was being removed, and it could not be put back at its name; it is kept at ${aside}`), { keptAt: aside });
  }
  if (how === 'copy') throw Object.assign(new Error(`${p} changed while it was being removed; it was put back as a copy, the file itself is kept at ${aside}`), { keptAt: aside });
  // The private name goes only as the very file just put back: one that
  // replaced it in the meantime is someone's and stays.
  try { rmIfOurs(aside, theirs, check); } catch {
    throw Object.assign(new Error(`${p} changed while it was being removed; it is back, and also kept at ${aside}`), { keptAt: aside });
  }
  // Back at its name: the caller learns it was not removed, and reports it.
  throw Object.assign(new Error(`${p} changed while it was being removed; it is kept there`), { keptAt: p });
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
export const fsOps = { lstat: lstatSync, open: (p) => openSync(p, fsConstants.O_RDONLY | (fsConstants.O_NONBLOCK ?? 0) | (fsConstants.O_NOFOLLOW ?? 0)), link: linkSync, copyFile: copyFileSync, rm: rmSync, rename: renameSync, write: writeFileSync };

// Puts `from` at `to` without overwriting anything there: link() where the
// filesystem has hard links, an exclusive copy (COPYFILE_EXCL, O_EXCL) where
// it does not. Either refuses a file or link that appears at `to` at any
// moment; a check followed by rename() would replace one that appeared in
// between.
// `from` is left in place: the caller records the placement first and only
// then removes it, so a failure in that removal is still undone.
// `out.id`, when `out` is given, is set to a copy's identity: the only
// proof afterwards that a file at `to` is the one this call created.
// The errors a filesystem without hard links answers link() with. Windows
// exFAT reports EISDIR (nodejs/node#65817).
const NO_HARD_LINKS = ['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EMLINK', 'ENOSYS', 'EXDEV', 'EISDIR'];

export function placeNoClobber(from, to, check, fromId, out) {
  try {
    fsOps.link(from, to);
    return 'link';
  } catch (err) {
    if (!NO_HARD_LINKS.includes(err.code)) throw err;
    const id = copyExclusive(from, to, check, fromId);
    if (out) out.id = id;
    return 'copy';
  }
}

// Copies `from` to a new file `to`, created exclusively (O_EXCL, so nothing
// already there is ever replaced) and identified before any byte goes in. A
// copy that fails halfway (disk full) leaves a partial file only this call
// can prove is its own, so it is removed here, by identity and after
// `check`, and never blocks putting the original back. Returns its identity.
function copyExclusive(from, to, check, fromId) {
  // The folders are checked before anything is read or created, not only
  // when a partial copy has to be cleaned up.
  check?.();
  // The source is opened without following a link at its name, and only
  // the very file expected (`fromId`, when given) is copied.
  let src;
  try { src = fsOps.open(from); } catch (e) {
    if (e.code === 'ELOOP' || e.code === 'EMLINK') throw new Error(`${from} is no longer a regular file; nothing was copied`);
    throw e;
  }
  let data;
  let mode;
  try {
    const st = fstatSync(src, BIG);
    if (!st.isFile() || (fromId && idOf(st) !== fromId) || !stillAtName(from, st)) throw new Error(`${from} changed before it was copied; nothing was copied`);
    mode = Number(st.mode) & 0o7777;
    data = readFileSync(src);
  } finally { closeSync(src); }
  let id = null;
  try {
    const fd = openSync(to, 'wx', mode);
    try {
      id = idOf(fstatSync(fd, BIG));
      fsOps.write(fd, data);
      // The mode exactly as the source had it: open() applies the umask.
      fchmodSync(fd, mode);
    } finally { closeSync(fd); }
  } catch (e) {
    if (id) {
      try { rmIfOurs(to, id, check); } catch (e2) { e.message += `; the partial copy is kept: ${e2.message}`; }
    }
    throw e;
  }
  return id;
}

// `beforeReplace` is a test hook: it runs after validation, just before the
// doc is replaced, so a test can act like a concurrent editor.
export function acceptDoc(root, name, today = localDate(), { beforeWrite, beforeReplace, beforeMoveAside, beforeAside, beforePlace, afterPlace, beforePlacedCheck, beforeCleanup } = {}) {
  const rel = `dybs/${DOCS[name].file}`;
  const unsafe = unsafePath(root, rel);
  if (unsafe) return { ok: false, errors: [`refusing to accept: ${unsafe}`] };
  // No acceptance without the method rules: every skill stops here too.
  const readme = readmeProblem(root);
  if (readme) return { ok: false, errors: [readme] };
  // What this acceptance was validated against (project.md and the required
  // docs), checked again right before and right after the doc is placed: an
  // input edited meanwhile undoes the acceptance instead of standing behind it.
  const inputs = [];
  // The method rules are an input too: removed or made unreadable meanwhile,
  // the acceptance is undone rather than left standing without them.
  try { inputs.push(['dybs/README.md', readDoc(join(root, 'dybs', 'README.md'))]); } catch (e) {
    return { ok: false, errors: [`dybs/README.md cannot be read (${e.code || e.message}), so the method rules are unavailable. Fix it and run --accept again.`] };
  }
  const inputsUnchanged = () => {
    for (const [r, t] of inputs) {
      let same = false;
      try { same = !unsafePath(root, r) && readDoc(join(root, r)) === t; } catch { same = false; }
      if (!same) throw new Error(`${r} changed while ${rel} was being accepted; run --accept again`);
    }
  };
  // A doc is accepted under project.md's settings (its depth and cap), so
  // those settings must themselves be valid first. They are read once: the
  // validated bytes decide, never a second read a concurrent edit could
  // change and restore before the inputs are checked again.
  let settings = null;
  if (name !== 'project') {
    const projectPath = join(root, 'dybs', DOCS.project.file);
    if (!existsSync(projectPath)) return { ok: false, errors: ['dybs/project.md is missing: its depth and settings decide how this doc is accepted. Run dybs-start first.'] };
    // The settings come from the project's own file, never through a link.
    const projectUnsafe = unsafePath(root, 'dybs/project.md');
    if (projectUnsafe) return { ok: false, errors: [`refusing to accept: ${projectUnsafe}`] };
    {
      const projectText = readDoc(projectPath);
      inputs.push(['dybs/project.md', projectText]);
      const project = validateDoc('project', projectText, depthFor('project', parseFrontmatter(projectText).data));
      if (project.errors.length) return { ok: false, errors: project.errors.map((e) => `project.md: ${e}`) };
      // A doc is never accepted without the docs it cannot be written
      // without: each must exist and validate.
      const projectData = parseFrontmatter(projectText).data;
      settings = projectData;
      // A doc the project skips is not accepted: its skill stops, and
      // `--doc` refuses it too.
      if (skipped(projectData).has(name)) return { ok: false, errors: [`${DOCS[name].file} is under skip: in project.md; remove it from skip: before accepting it`] };
      for (const dep of REQUIRES[name] || []) {
        const depRel = `dybs/${DOCS[dep].file}`;
        const depPath = join(root, depRel);
        if (!existsSync(depPath)) return { ok: false, errors: [`${depRel} is missing: ${name} cannot be written without it. Write ${dep} first.`] };
        const depUnsafe = unsafePath(root, depRel);
        if (depUnsafe) return { ok: false, errors: [`refusing to accept: ${depUnsafe}`] };
        const depText = readDoc(depPath);
        const r = validateDoc(dep, depText, depthFor(dep, projectData), projectData?.checkins);
        if (r.errors.length) return { ok: false, errors: r.errors.map((e) => `${DOCS[dep].file}: ${e}`) };
        inputs.push([depRel, depText]);
      }
    }
  }
  const path = join(root, rel);
  const text = readDoc(path);
  const { data, body } = parseFrontmatter(text);
  if (!data) return { ok: false, errors: validateDoc(name, text).errors };
  // project.md's check-ins bind the other docs too: `checkins: none` is not
  // accepted while a doc that is not skipped was written thorough (whole-
  // project validation would fail at once). Those docs are inputs as well.
  if (name === 'project' && data.checkins === 'none') {
    const skip = skipped(data);
    for (const other of LISTABLE) {
      if (skip.has(other)) continue;
      const otherRel = `dybs/${DOCS[other].file}`;
      // Only a doc that is provably not there is skipped: a folder that
      // cannot be searched never passes as "no such doc".
      const there = lookup(join(root, otherRel));
      if (there === 'missing') continue;
      if (there !== 'present') return { ok: false, errors: [`${otherRel} cannot be checked (${there}), so "checkins: none" cannot be confirmed for it. Fix its permissions and run --accept again.`] };
      const otherUnsafe = unsafePath(root, otherRel);
      if (otherUnsafe) return { ok: false, errors: [`refusing to accept: ${otherUnsafe}`] };
      const otherText = readDoc(join(root, otherRel));
      const r = validateDoc(other, otherText, depthFor(other, data), data.checkins);
      if (r.rules.includes('checkins')) return { ok: false, errors: [`${DOCS[other].file}: "checkins: none" asks nothing, so it must be quick: set depth: quick there first`] };
      inputs.push([otherRel, otherText]);
    }
  }
  const next = setFrontmatter(text, { status: 'accepted', updated: today, accepted: today, 'accepted-hash': acceptedHash(data, body) });
  // project.md is accepted under its own settings: the doc itself.
  const projectData = name === 'project' ? data : settings;
  const check = validateDoc(name, next, depthFor(name, projectData), projectData?.checkins);
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
  // Every placement: pinned right before, and checked right after for both
  // the folders and the identity actually placed. A name that went wrong is
  // removed only when provably this run's (a link to the very source, or
  // the copy just made); anything else is left in place and named.
  const placeChecked = (from, to, fromId, copyOnly = false) => {
    pinned();
    const copied = {};
    const how = copyOnly ? (copied.id = copyExclusive(from, to, pinned, fromId), 'copy') : placeNoClobber(from, to, pinned, fromId, copied);
    const now = pathId(to);
    if (folderChain(root, rel) !== dirs || now !== (how === 'copy' ? copied.id : fromId)) {
      const ours = now !== null && now === (how === 'copy' ? copied.id : pathId(from));
      let note = ours ? '' : `; ${to} is not provably this run's file and was left in place`;
      if (ours) { try { rmIfOurs(to, now); } catch (e) { note = `; ${e.message}`; } }
      throw Object.assign(new Error(`${rel} or a folder on the way changed while it was being placed; run --accept again${note}`), { placeFailed: true });
    }
    return { how, id: now };
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
  let tmpWarning = null;
  let oldId = null;
  // No valid pin, no write: the temporary copy is never created through a
  // folder that is already a link.
  beforeWrite?.();
  pinned();
  try {
    const fd = openSync(tmp, 'wx', mode);
    try {
      tmpId = idOf(fstatSync(fd, BIG));
      writeFileSync(fd, next);
      fchmodSync(fd, mode);
    } finally { closeSync(fd); }
    beforeReplace?.();
    // Written through a folder swapped in before the open, the temporary
    // copy is outside the project, where the cleanup (which needs the
    // pinned folders) cannot reach it. This run created it, so it is
    // removed by that identity at once, while it has no other name.
    let swap = null;
    try { pinned(); } catch (e) { swap = e; }
    if (swap || pathId(tmp) !== tmpId) {
      const err = swap || new Error(`the temporary copy of ${rel} is not where it was written; run --accept again`);
      try { rmIfOurs(tmp, tmpId, null, { sole: true }); } catch (e) { err.message += `; ${e.message}`; }
      throw err;
    }
    // The doc's identity is taken before it moves (a rename keeps it), so
    // a rollback can tell our original from a same-named file reached
    // through a folder swapped right after the rename.
    oldId = pathId(path);
    beforeMoveAside?.(old);
    // Only the regular file that was validated may be moved aside: a link
    // put in its place keeps its own identity through link() and rename(),
    // while every read follows it to bytes that may match.
    const notRegular = () => new Error(`${rel} is no longer a regular file; nothing was changed, run --accept again`);
    if (!isRegularFile(path)) throw notRegular();
    // Moved aside without ever replacing what is at the new name: rename()
    // would silently overwrite a file that appeared there. A link refuses
    // one (EEXIST); then the doc's own name is dropped only while it is
    // still the same file. Without hard links the name is reserved first
    // with an exclusive empty file, and only that reservation is replaced.
    try {
      // Pinned right before the link and again inside the removal: through
      // a folder swapped for a link, either would act outside the project.
      pinned();
      fsOps.link(path, old);
      // A folder swapped in the instant of the link would put the new name
      // outside the project: the name just created there is removed again
      // (only a second name, the file itself is untouched) and acceptance
      // stops with nothing changed.
      // Our name only while it is the very file it was linked from (one file
      // under both names); a file that replaced it since is left, and named.
      const dropLinked = (check) => {
        const linked = pathId(old);
        if (linked === null || linked !== pathId(path)) return linked === null ? '' : `; ${old} is not provably this run's and was left in place`;
        try { rmIfOurs(old, linked, check); return ''; } catch (e2) { return `; ${e2.message}`; }
      };
      if (folderChain(root, rel) !== dirs) {
        const note = dropLinked();
        throw new Error(`a folder on the way to ${rel} changed while it was being accepted; nothing was changed, run --accept again${note}`);
      }
      if (!isRegularFile(old)) {
        const note = dropLinked(pinned);
        throw Object.assign(notRegular(), { message: notRegular().message + note });
      }
      // The doc's own name is dropped only while the aside name is still the
      // very same file: one swapped in after the link would make this the
      // document's last name.
      if (pathId(old) !== oldId) throw new Error(`something replaced ${old} during the accept; nothing was changed, ${rel} is untouched and ${old} was left in place, run --accept again`);
      moved = true;
      rmIfOurs(path, oldId, pinned);
    } catch (e) {
      if (e.code === 'EEXIST') throw new Error(`something appeared at ${old} during the accept; nothing was changed, run --accept again`);
      if (moved || !NO_HARD_LINKS.includes(e.code)) throw e;
      // No hard links: an exclusive copy (COPYFILE_EXCL never replaces
      // anything), then the doc's own name is moved to a name only this run
      // knows and dropped only while it is the same file with the same
      // bytes. No rename ever targets a name someone else could use.
      if (!isRegularFile(path)) throw notRegular();
      let copyId;
      try {
        copyId = copyExclusive(path, old, pinned, oldId);
      } catch (e2) {
        if (e2.code === 'EEXIST') throw new Error(`something appeared at ${old} during the accept; nothing was changed, run --accept again`);
        throw e2;
      }
      moved = true;
      // From here the copy is the original the rollback restores. Its
      // identity comes from the descriptor it was written through, never
      // from a later look at the name.
      const origId = oldId;
      oldId = copyId;
      beforeAside?.(path);
      // Re-pinned right before the move: through a folder swapped for a
      // link, the rename would take someone else's doc off its name.
      pinned();
      // A save made over the doc since the copy is never moved: acceptance
      // stops while it is still at its own name.
      if (pathId(path) !== origId || !isRegularFile(path)) throw new Error(`${rel} changed while it was being moved aside; nothing was changed, run --accept again`);
      const aside = `${path}.${randomUUID()}.rm`;
      renameSync(path, aside);
      let same = false;
      try { const a = readById(aside, origId); const o = readById(old, oldId); same = a !== null && o !== null && a === o; } catch { same = false; }
      if (!same) {
        // Changed in the last instant: put back at its own name without
        // ever replacing a file saved there meanwhile (an exclusive copy,
        // as there are no hard links here), and the file itself is kept.
        testHooks.beforePutBack?.(path);
        let back = false;
        try { pinned(); placeNoClobber(aside, path, pinned, origId, {}); back = true; } catch { back = false; }
        throw new Error(back
          ? `${rel} changed while it was being moved aside; it is back at its own name as a copy, and the file itself is kept at ${aside}; run --accept again`
          : `${rel} changed while it was being moved aside; your version is kept at ${aside}`);
      }
      // Deleted by identity under another private name, never by a plain
      // unlink after the check: a file that replaced `aside` since is kept.
      rmIfOurs(aside, origId, pinned, { expect: readById(old, oldId) });
    }
    pinned();
    const oldText = readById(old, oldId);
    if (oldText === null) throw new Error(`${rel} is not where it was moved aside; run --accept again`);
    if (oldText !== text) {
      // A link puts the very file back; a copy is only a snapshot, so the
      // original itself (which an editor may still be writing) is kept.
      const { how } = placeChecked(old, path, oldId);
      moved = false;
      if (how === 'link') rmIfOurs(old, oldId, pinned);
      rmIfOurs(tmp, tmpId, pinned);
      const kept = how === 'link' ? '' : `; it was put back as a copy, the file itself is kept at ${old}`;
      return { ok: false, errors: [`the doc changed while it was being accepted; nothing was written, run --accept again${kept}`] };
    }
    // Identity cannot show an edit made in place, so the bytes are checked
    // too, right before the copy is placed.
    beforePlace?.(tmp);
    if (readById(tmp, tmpId) !== next) {
      throw new Error(`the temporary copy of ${rel} changed before it was placed; nothing was kept, run --accept again`);
    }
    inputsUnchanged();
    // The copy carries the doc's permissions as seen when it was written:
    // tightened since (0644 to 0600), the original (moved aside, the very
    // file) says so, and acceptance stops rather than undo it.
    // Only the very original answers: a lookup that fails (EIO, EACCES) or
    // finds another file there stops acceptance. One that is provably gone
    // has no permissions left to keep, and the validated copy goes in.
    let modeNow = null;
    try {
      const st = fsOps.lstat(old, BIG);
      if (idOf(st) !== oldId) throw new Error(`the original of ${rel} was replaced during acceptance; nothing was written, run --accept again`);
      modeNow = Number(st.mode) & 0o7777;
    } catch (e) {
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e.code ? new Error(`the permissions of ${rel} could not be checked (${e.code}); nothing was written, run --accept again`) : e;
    }
    if (modeNow !== null && modeNow !== mode) throw new Error(`${rel} had its permissions changed during acceptance; nothing was written, run --accept again`);
    // What was actually placed, checked at once (see placeChecked). Copied
    // from a descriptor checked to be the temporary file, never linked:
    // link() takes whatever the name holds at that instant, and a file
    // swapped in only for the call would land at the doc's name, not ours
    // to remove, with the original stranded aside.
    const placedNow = placeChecked(tmp, path, tmpId, true).id;
    placed = true;
    placedId = placedNow;
    afterPlace?.(tmp);
    pinned();
    try { rmIfOurs(tmp, tmpId, pinned); } catch (e) {
      if (!e.notOurs) throw e;
      tmpWarning = `${basename(tmp)} was replaced by another file during acceptance; that file was left in place`;
    }
    // Until that unlink, a link placement left two names for one file, and a
    // write through the temporary name would land in the doc. So the doc is
    // read once more now that it is the only name.
    beforePlacedCheck?.(path);
    pinned();
    if (readById(path, placedId) !== next) {
      throw new Error(`${rel} changed while it was being accepted; run --accept again`);
    }
    inputsUnchanged();
    // The original is deleted only while it is provably ours: reached
    // through the pinned folders, the very file we moved aside, and still
    // holding what was validated. Otherwise it is kept and reported.
    beforeCleanup?.(old);
    let ours = false;
    let keptAt = old;
    try { ours = folderChain(root, rel) === dirs && readById(old, oldId) === text; } catch { ours = false; }
    if (ours) {
      // Re-pinned inside the removal, right before its move: a folder
      // swapped for a link since the check above is never acted through.
      try { rmIfOurs(old, oldId, pinned, { expect: text }); } catch (e) { ours = false; keptAt = e.keptAt ?? old; }
    }
    if (!ours) return { ok: true, warnings: [...check.warnings, ...(tmpWarning ? [tmpWarning] : []), `the previous version changed or could not be confirmed during acceptance; kept at ${keptAt}`] };
  } catch (err) {
    // Undo through the same paths: a file that went through a swapped link
    // comes back the same way. Only what is provably ours is removed.
    if (placed) {
      let ours = false;
      try {
        ours = folderChain(root, rel) === dirs && readById(path, placedId) === next;
      } catch { ours = false; }
      // Removed by identity through a private name, never by a separate
      // look followed by an unlink: a save that replaces the doc in between
      // is kept, and the original is then not put back over it.
      if (ours) {
        try { rmIfOurs(path, placedId, pinned, { expect: next }); } catch (e) { err.message += `; ${e.message}`; }
      }
    }
    try { rmIfOurs(tmp, tmpId, pinned); } catch (e) { err.message += `; ${e.message}`; }
    // Never leave the doc stranded under its temporary name.
    // lstat, not exists: a dangling link that appeared at the doc's path is
    // someone's entry too, and is never replaced. Then the original stays
    // at its temporary name, and the error says where.
    const taken = (p) => { try { lstatSync(p); return true; } catch { return false; } };
    // Restored with the same no-clobber placement as everything else: a
    // save that lands at the path in the meantime is never overwritten.
    // Only our own original is put back: reached through the pinned
    // folders and the very file we moved aside. A same-named file shown
    // through a swapped folder is never moved or deleted.
    if (moved && (oldId === null || folderChain(root, rel) !== dirs || (taken(old) && pathId(old) !== oldId))) {
      err.message += `; a folder on the way changed, so the original was not put back: it was moved aside to ${old} in the folder as it was`;
    } else if (moved && taken(old)) {
      let restored = false;
      let how = null;
      try {
        try { how = placeChecked(old, path, oldId).how; } catch (e) {
          // The failure that brought us here may be the link itself: fall
          // back to an exclusive copy, still never over an existing entry,
          // and checked the same way.
          if (e.code === 'EEXIST' || e.placeFailed) throw e;
          how = placeChecked(old, path, oldId, true).how;
        }
        restored = true;
      } catch { restored = false; }
      // A copy is a snapshot: the original itself is kept, since an editor
      // may still be writing to it.
      if (restored && how === 'link') {
        try { rmIfOurs(old, oldId, pinned); } catch (e) { err.message += `; ${e.message}`; }
      }
      else if (restored) err.message += `; the doc was put back as a copy, the file itself is kept at ${old}`;
      else err.message += `; something appeared at ${rel} meanwhile, the original is kept at ${old}`;
    }
    throw err;
  }
  return { ok: true, warnings: [...check.warnings, ...(tmpWarning ? [tmpWarning] : [])] };
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
  if (only && !ORDER.includes(only)) {
    console.error(`unknown doc "${only}". Known: ${ORDER.join(', ')}`);
    return 2;
  }
  const accept = acc.value;
  const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--doc' && args[i - 1] !== '--accept');
  const root = resolve(positional[0] || '.');
  if (accept) {
    if (!ORDER.includes(accept)) { console.error(`unknown doc "${accept}". Known: ${ORDER.join(', ')}`); return 2; }
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
  // `--doc` checks one doc (and project.md): it says nothing about the rest.
  if (only) {
    if (report.ok) console.log(`\n${DOCS[only].file} passes.`);
    return report.ok ? 0 : 1;
  }
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

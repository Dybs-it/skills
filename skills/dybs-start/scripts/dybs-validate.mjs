#!/usr/bin/env node
// Validates a project's dybs/ folder against the Getting Started contract.
// Usage: node dybs-validate.mjs [projectRoot] [--doc <name>] [--json]
// Exit code 0 = no errors (warnings allowed), 1 = errors, 2 = usage problem.
//
// This file is the single home for the doc contract (required sections and
// length caps). Templates and skills must agree with DOCS below.

import { readFileSync, existsSync, statSync, lstatSync, realpathSync, openSync, closeSync, fstatSync, constants as fsConstants } from 'node:fs';
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
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    // Quotes count only as a matching pair around the whole value; a lone or
    // mismatched quote (`'accepted`) stays in the value, so it fails.
    if (kv) { const raw = kv[2].trim(); const q = raw.match(/^(["'])(.*)\1$/); data[kv[1]] = q ? q[2] : raw; }
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
export function visibleText(body, { keepCode = false, hideUnclosed = false } = {}) {
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

function skipped(projectData) {
  // project.md may declare `skip: ui, ux` for docs that do not apply.
  const raw = projectData?.skip || '';
  return new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
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
// Up to 32 nested parentheses in a destination: cmark (GitHub's renderer)
// stops there; commonmark.js has no limit, and no real doc goes deeper.
const LINK_DEST = String.raw`(?:<[^<>\n]*>|${BALANCED(32)})`;
// A title may run over several lines, never across a blank one.
const TITLE_NL = String.raw`\n(?![ \t]*(?:\n|$))`;
const LINK_TITLE = String.raw`(?:"(?:[^"\\\n]|\\.|${TITLE_NL})*"|'(?:[^'\\\n]|\\.|${TITLE_NL})*'|\((?:[^()\\\n]|\\.|${TITLE_NL})*\))`;
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
const DEF_DEST = String.raw`(?:<[^<>\n]*>|(?:[^\s()\\<]|${ESCAPED}|\(${BALANCED(31)}\))${BALANCED(32)})`;
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
// The start of a definition line, label and colon.
const DEF_HEAD = new RegExp(String.raw`^(?:${CONTAINERS})${LABEL}:`);
function definitions(lines) {
  const defs = new Map();
  // Continuation lines are read without their quote markers, never past a
  // blank line or into a deeper quote; up to 20 lines are tried.
  const strip = (x) => x.replace(/^(?: {0,3}>[ \t]?)*/, '');
  const spanEnd = (i, fits) => {
    for (let j = i + 1; j < lines.length && j - i <= 20; j++) {
      if (strip(lines[j]).trim() === '' || containerQuotes(lines[j]) > containerQuotes(lines[i])) return -1;
      if (fits(lines.slice(i, j + 1).map((x, k) => (k ? strip(x) : x)).join('\n'))) return j;
    }
    return -1;
  };
  let titleMayFollow = false;
  let depth = 0;
  // The quotes each line's paragraph is in: a lazy line (fewer `>`, still
  // the same paragraph) keeps the depth of the paragraph it continues.
  const inQuotes = [];
  for (let i = 0, cur = null; i < lines.length; i++) {
    if (lines[i].replace(/^(?: {0,3}>[ \t]?)*/, '').trim() === '') { cur = null; inQuotes.push(0); continue; }
    const d = containerQuotes(lines[i]);
    if (cur === null || d >= cur) cur = d;
    inQuotes.push(cur);
  }
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (titleMayFollow && containerQuotes(l) <= depth && DEF_TITLE_LINE.test(l)) {
      defs.set(i, null);
      titleMayFollow = false;
      continue;
    }
    // A title on its own lines, over several of them.
    const titleEnd = titleMayFollow && containerQuotes(l) <= depth ? spanEnd(i, (joined) => DEF_TITLE_LINE.test(joined)) : -1;
    if (titleEnd > i) {
      for (let k = i; k <= titleEnd; k++) defs.set(k, null);
      titleMayFollow = false;
      i = titleEnd;
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
    // A block quote opened on this line interrupts the paragraph before it.
    const opensQuote = i > 0 && containerQuotes(l) > inQuotes[i - 1];
    const blockStart = i === 0 || (defs.has(i - 1) && !continues) || opensItem || opensQuote || ended || /^(?: {0,3}>[ \t]?)*[ \t]*$/.test(lines[i - 1]);
    // A label holds at most 999 characters; a longer one is no label, and
    // the line is ordinary text.
    const m = DEF_LINE.exec(l);
    if (m && blockStart && m[1].length <= 999) {
      defs.set(i, label(m[1]));
      titleMayFollow = !m[2];
      depth = containerQuotes(l);
      continue;
    }
    // A definition whose title runs over the next lines.
    const defEnd = blockStart && DEF_HEAD.test(l) ? spanEnd(i, (joined) => { const mm = DEF_LINE.exec(joined); return Boolean(mm) && mm[1].length <= 999 && Boolean(mm[2]); }) : -1;
    if (defEnd > i) {
      defs.set(i, label(DEF_LINE.exec(lines.slice(i, defEnd + 1).map((x, k) => (k ? strip(x) : x)).join('\n'))[1]));
      for (let k = i + 1; k <= defEnd; k++) defs.set(k, null);
      titleMayFollow = false;
      depth = containerQuotes(l);
      i = defEnd;
      continue;
    }
    const open = DEF_OPEN.exec(l);
    const rest = open && open[1].length <= 999 && blockStart && i + 1 < lines.length && !BLOCK_END.test(lines[i + 1]) && containerQuotes(lines[i + 1]) <= containerQuotes(l)
      // An HTML block start (`<details>`) interrupts the paragraph: it is never
      // the destination, however much it looks like `<url>`.
      && !HTML_INTERRUPT.test(lines[i + 1].replace(/^(?: {0,3}>[ \t]?)*/, '')) ? DEF_REST.exec(lines[i + 1]) : null;
    if (rest) {
      defs.set(i, label(open[1]));
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
  // Anywhere in a line, not only at its start: inline HTML stays raw, and
  // `intro <details>` ... `</details>` collapses the sections between.
  // A link destination (`[x](<details>)`) is never raw HTML: it is left out.
  // A well-formed reference definition (`[x]: <details>`) is no HTML either.
  const htmlLines = visibleText(body).split('\n');
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
  if (words > spec.maxWords) {
    fail('cap', `${words} words, cap is ${spec.maxWords}. Cut, or move detail to context/decisions/`);
  } else if (words > spec.maxWords * 0.9) {
    warnings.push(`${words} words, close to the cap of ${spec.maxWords}`);
  }

  // Inline formatting can split a placeholder that still reads whole
  // (`T**O**DO`, `[TO](x)DO`), so it is also checked with emphasis, code
  // and link markup removed. That can only find more, never fewer.
  // Only what renders is scanned: definition lines (and their titles) go
  // here, link destinations and titles below, so a TODO in a URL is not
  // a placeholder. Labels are matched as written (`[f&#111;o]` is not
  // `[foo]`), and character references are decoded only at the end, as
  // text. Code that is not kept leaves an empty line, so the lines of both
  // readings line up.
  const kept = visibleText(body, { keepCode: true }).split('\n');
  const rendered = (kept.length === visibleText(body).split('\n').length ? kept.map((l, i) => (defined.has(i) ? '' : l)) : kept).join('\n');
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
  // Code spans first: their content is literal (no links, escapes or
  // emphasis inside), so it is set aside whole and put back last. A span
  // turns its line endings into spaces, then loses one space on each side
  // when both are there and it is not all spaces (`` ` O ` `` shows `O`).
  const codes = [];
  const flatMarked = rendered
    .replace(/(?<![`\\])(`+)(?!`)((?:[^\n]|\n(?![ \t>]*(?:\n|$)))*?[^`])\1(?!`)/g, (m, ticks, raw) => {
      const c = raw.replace(/\n/g, ' ');
      codes.push(/^ [\s\S]* $/.test(c) && /[^ ]/.test(c) ? c.slice(1, -1) : c);
      return String.fromCharCode(0xe100 + codes.length - 1);
    })
    .replace(new RegExp(INLINE_LINK, 'g'), (m, t) => LINK(t))
    .replace(/(?<!\\)(\[(?:[^\[\]\\\n]|\\.)*\])\[((?:[^\[\]\\\n]|\\.)*)\]/g, (m, t, l) => (labels.has(label(l || t.slice(1, -1))) ? LINK(t.slice(1, -1)) : m))
    .replace(/(?<!\\)\[((?:[^\[\]\\\n]|\\.)+)\](?!\[(?:[^\[\]\\\n]|\\.)*\])/g, (m, x) => (labels.has(label(x)) ? LINK(x) : m))
    .replace(/\\([!-/:-@[-`{-~])/g, (m, c) => String.fromCharCode(0xe000 + c.charCodeAt(0)))
    // Only markup that renders as such is read through: paired `*`
    // emphasis, and `_` emphasis at word boundaries (`T_O_DO` stays as
    // written). Resolved link brackets go; `~` is text in CommonMark.
    .replace(/(\*+)(?![\s*])([^*]+?)(?<![\s*])\1/g, '$2')
    .replace(/(?<![\p{L}\p{N}_])(_+)(?![\s_])([^_]+?)(?<![\s_])\1(?![\p{L}\p{N}_])/gu, '$2')
    .replace(/[\ue0f0\ue0f1]/g, '');
  // References decode while escapes are still set aside (`\&amp;` stays).
  const unescape = (t) => decodeReferences(t).replace(/[\ue000-\ue07f]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xe000))
    .replace(/[\ue100-\uf8ff]/g, (c) => codes[c.charCodeAt(0) - 0xe100] ?? c);
  const flat = unescape(flatMarked);
  // Delimiter runs that overlap (`*T**O***DO` is emphasis around strong
  // emphasis) are not paired above; with every unescaped `*` gone, such a
  // placeholder still shows. A literal `*` inside a placeholder word is
  // all this could misread, which no doc writes.
  const loose = unescape(flatMarked.replace(/\*+/g, ''));
  if (PLACEHOLDER.test(flat) || PLACEHOLDER.test(loose)) {
    const msg = 'unfilled placeholder ({{...}}, TODO or TBD)';
    if (data?.status === 'accepted') fail('placeholder', msg);
    else warnings.push(msg);
  }

  return { name, file: spec.file, status: data?.status ?? null, words, errors, warnings, rules: [...rules] };
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
  // The method rules must be a readable file: a folder (or anything else)
  // at that name is present but holds no rules for the skills to follow.
  const readme = join(dir, 'README.md');
  if (!existsSync(readme)) {
    results.push({ name: 'readme', file: 'README.md', status: null, words: 0,
      errors: ['missing dybs/README.md (the method rules). Run dybs-start to restore it.'], warnings: [] });
  } else if (!statSync(readme).isFile()) {
    results.push({ name: 'readme', file: 'README.md', status: null, words: 0,
      errors: ['dybs/README.md is not a file, so the method rules cannot be read. Move it aside and run dybs-start to restore it.'], warnings: [] });
  } else {
    // A file the skills cannot read is as good as missing.
    try { readFileSync(readme); } catch (e) {
      results.push({ name: 'readme', file: 'README.md', status: null, words: 0,
        errors: [`dybs/README.md cannot be read (${e.code || e.message}), so the method rules are unavailable. Fix its permissions.`], warnings: [] });
    }
  }

  const projectPath = join(dir, DOCS.project.file);
  const projectText = lookup(projectPath) === 'present' ? readRegular(projectPath) : null;
  const projectData = projectText === null ? null : parseFrontmatter(projectText).data;
  validateHooks.afterSettings?.();
  const skip = skipped(projectData);

  for (const name of ORDER) {
    // project.md is always loaded: it holds the settings every other doc is
    // checked against, so `--doc <other>` checks it too.
    if (only && name !== only && name !== 'project') continue;
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
      const errors = only && (only === name || name === 'project') ? [`${spec.file} does not exist yet`] : [];
      results.push({ name, file: spec.file, status: 'missing', words: 0, errors, warnings: [] });
      continue;
    }
    // project.md is validated from the very bytes its settings came from:
    // a save in between would otherwise mix two versions in one result.
    if (!(name === 'project' && projectText !== null)) validateHooks.beforeRead?.(path);
    const text = name === 'project' && projectText !== null ? projectText : readRegular(path);
    if (text === null) {
      results.push({ name, file: spec.file, status: null, words: 0, errors: [`${spec.file} is not a regular file, so it cannot be read`], warnings: [] });
      continue;
    }
    results.push(validateDoc(name, text));
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
  // The method rules are not a phase: dybs-start (the `project` step)
  // restores them, so a README problem routes there.
  if (pending?.name === 'readme') return 'project';
  return pending ? pending.name : null;
}

export function main(argv) {
  const args = argv.slice(2);
  const json = args.includes('--json');
  // One `--doc` at most: a second one must not be dropped unchecked.
  if (args.filter((a) => a === '--doc').length > 1) { console.error('--doc may be given once'); return 2; }
  const docIdx = args.indexOf('--doc');
  const only = docIdx >= 0 ? args[docIdx + 1] : undefined;
  // `--doc` always names a known doc: without one (or with an empty
  // value) it must not fall back to a whole-project check that can pass.
  if (docIdx >= 0 && (!only || only.startsWith('--') || !ORDER.includes(only))) {
    console.error(`${only && !only.startsWith('--') ? `unknown doc "${only}"` : '--doc needs a doc name'}. Known: ${ORDER.join(', ')}`);
    return 2;
  }
  const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--doc');
  // Anything else is a mistake, never ignored: a misspelled option or a
  // second folder must not let a check of some other tree pass.
  const unknown = args.filter((a) => a.startsWith('-') && a !== '--doc' && a !== '--json');
  if (unknown.length) { console.error(`unknown option ${unknown[0]}. Options: --doc <name>, --json`); return 2; }
  if (positional.length > 1) { console.error(`one project folder at most, got: ${positional.join(' ')}`); return 2; }
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
  // `--doc` checks one doc (and project.md): it says nothing about the rest.
  if (only) {
    if (report.ok) console.log(`\n${DOCS[only].file} passes.`);
    return report.ok ? 0 : 1;
  }
  const next = nextStep(report.results);
  console.log(next ? `\nNext: ${next}` : report.accepted ? '\nAll Getting Started docs accepted.' : '');
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

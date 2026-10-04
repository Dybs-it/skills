#!/usr/bin/env node
// Validates a project's dybs/ folder against the Getting Started contract.
// Usage: node dybs-validate.mjs [projectRoot] [--doc <name>] [--json]
// Exit code 0 = no errors (warnings allowed), 1 = errors, 2 = usage problem.
//
// This file is the single home for the doc contract (required sections and
// length caps). Templates and skills must agree with DOCS below.

import { readFileSync, existsSync, statSync, realpathSync, openSync, closeSync, fstatSync, constants as fsConstants } from 'node:fs';
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

// Character references decoded the way a reader sees them, for the
// placeholder check: `T&#79;DO` renders as TODO. Numeric references are
// decoded in full; of the named ones, those that can spell a placeholder
// (the braces, and any letter or digit written as a reference). Decoding
// inside code too can only find more, never less.
const NAMED = { lbrace: '{', lcub: '{', rbrace: '}', rcub: '}', amp: '&' };
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
      if (blank || inner.match(/^ */)[0].length >= indented || /^\t/.test(inner)) { prevBlank = blank; para = false; if (keepCode) out.push(line); continue; }
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
      const col = marks.length ? marks.at(-1).index + marks.at(-1)[0].length : inList && quoteDepth(line) >= listQuote ? (items.filter((c) => c <= at).at(-1) ?? 0) : 0;
      const prefix = line.slice(0, at);
      fence = { ch: m[1][0], len: m[1].length, quote: (prefix.match(/>/g) || []).length, col, listFirst: /^\s*(?:[-*+]|\d{1,9}[.)])[ \t]/.test(prefix) || (inList && quoteDepth(line) >= listQuote && !/^ {0,3}>/.test(line) && col > 0) };
      prevBlank = false;
      para = false;
      if (keepCode) out.push(line);
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
      if (keepCode) out.push(line);
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
export function headings(body) {
  // A heading counts only if no reading of an unclosed comment hides it.
  return [...visibleText(body, { hideUnclosed: true }).matchAll(/^ {0,3}##[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/gm)].map((h) => h.at(1));
}

export function wordCount(body) {
  // Count prose only: what a reader sees, without HTML comments (template
  // guidance) or fenced code (``` or ~~~), by the same rules as headings.
  // Link destinations and titles, and reference definitions (`[x]: url`),
  // are never shown either. A definition cannot interrupt a paragraph, so
  // only one after a blank line (or another definition) is left out.
  let prev = '';
  const prose = visibleText(body).split('\n').map((l) => {
    const def = /^(?: {0,3}>[ \t]?)* {0,3}\[[^\]\n]+\]:[ \t]*(?:<[^<>\n]*>|[^\s<]\S*)(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?[ \t]*$/.test(l) && (prev.trim() === '' || prev === '\u0002');
    prev = def ? '\u0002' : l;
    return def ? '' : dropValidLinkTargets(l);
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
function dropValidLinkTargets(text) {
  return text.replace(/\]\([ \t]*(?:<[^<>\n]*>|(?:[^\s()\\]|\\.|\((?:[^\s()\\]|\\.)*\))*)(?:[ \t]+(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\((?:[^()\\\n]|\\.)*\)))?[ \t]*\)/g, ']');
}

// Removes every `](destination)` and `][label]`, with the destination's
// parentheses balanced (`](foo(bar))`), so only the text a reader sees is
// left between the brackets.
function dropLinkTargets(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ']' && text[i + 1] === '(') {
      let depth = 0;
      let j = i + 1;
      for (; j < text.length && text[j] !== '\n'; j++) {
        if (text[j] === '\\') { j++; continue; }
        // A quoted title (`"x)"`, `'x)'`) after the destination holds no
        // delimiters of its own.
        if (depth === 1 && (text[j] === '"' || text[j] === "'") && /[ \t]/.test(text[j - 1])) {
          // Escaped quotes (`"x\")"`) do not close the title.
          let q = j + 1;
          while (q < text.length && text[q] !== text[j] && text[q] !== '\n') q += text[q] === '\\' ? 2 : 1;
          if (q < text.length && text[q] === text[j]) { j = q; continue; }
        }
        if (text[j] === '(') depth++;
        else if (text[j] === ')' && --depth === 0) break;
      }
      if (depth === 0 && j < text.length && text[j] === ')') { i = j; continue; }
    }
    if (text[i] === ']' && text[i + 1] === '[') {
      const end = text.indexOf(']', i + 2);
      if (end > 0 && !text.slice(i + 2, end).includes('\n')) { i = end; continue; }
    }
    out += text[i];
  }
  return out;
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
  // A reference definition's destination (`[x]: <details>`) is no HTML either.
  const refDest = (l) => l.replace(/^((?: {0,3}>[ \t]?)*(?: {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+)*\s{0,3}\[[^\]\n]+\]:[ \t]*)<[^>\n]*>/, '$1');
  const html = visibleText(body).split('\n').find((l) => /<\/?[A-Za-z][A-Za-z0-9-]*(?=[\s/>]|$)|<\?|<![A-Za-z]|<!\[CDATA\[/.test(dropLinkTargets(refDest(textOutsideCodeSpans(l)))));
  if (html !== undefined) fail('html', `raw HTML is not allowed (found: ${html.trim().slice(0, 40)}); use Markdown`);

  const found = headings(body);
  // `## **Goals**` and `## `Goals`` render as Goals: inline markup is
  // read through when matching a required section.
  const plain = (h) => dropLinkTargets(h).replace(/[*_~`[\]]/g, '').trim();
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
  const shown = decodeReferences(visibleText(body, { keepCode: true }));
  // Backslash escapes of punctuation (`\{\{x\}\}`) render as the bare character.
  const flat = dropLinkTargets(shown).replace(/\\([!-/:-@[-`{-~])/g, '$1').replace(/[*_~`[\]]/g, '');
  if (PLACEHOLDER.test(shown) || PLACEHOLDER.test(flat)) {
    const msg = 'unfilled placeholder ({{...}}, TODO or TBD)';
    if (data?.status === 'accepted') fail('placeholder', msg);
    else warnings.push(msg);
  }

  return { name, file: spec.file, status: data?.status ?? null, words, errors, warnings, rules: [...rules] };
}

// Reads a file only if it is a regular file. Opened without blocking, so a
// FIFO or a device at a doc's name never hangs the check, and judged on the
// open descriptor, not on a separate look at the name. null otherwise.
function readRegular(p) {
  const fd = openSync(p, fsConstants.O_RDONLY | (fsConstants.O_NONBLOCK ?? 0));
  try { return fstatSync(fd).isFile() ? readFileSync(fd, 'utf8') : null; } finally { closeSync(fd); }
}

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
  const projectText = existsSync(projectPath) ? readRegular(projectPath) : null;
  const projectData = projectText === null ? null : parseFrontmatter(projectText).data;
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
    if (!existsSync(path)) {
      // A doc asked for by name must exist: `--doc` passing is the check
      // before a check-in, and "it is not there" is not a pass.
      const errors = only && (only === name || name === 'project') ? [`${spec.file} does not exist yet`] : [];
      results.push({ name, file: spec.file, status: 'missing', words: 0, errors, warnings: [] });
      continue;
    }
    const text = readRegular(path);
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

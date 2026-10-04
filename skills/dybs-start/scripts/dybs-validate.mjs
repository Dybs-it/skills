#!/usr/bin/env node
// Validates a project's dybs/ folder against the Getting Started contract.
// Usage: node dybs-validate.mjs [projectRoot] [--doc <name>] [--json]
// Exit code 0 = no errors (warnings allowed), 1 = errors, 2 = usage problem.
//
// This file is the single home for the doc contract (required sections and
// length caps). Templates and skills must agree with DOCS below.

import { readFileSync, writeFileSync, existsSync, statSync, lstatSync, renameSync, rmSync, chmodSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
  { id: 'doc-lists', text: 'In project.md, `quick:`, `thorough:` and `skip:` name only known docs (prd, scope, domain, architecture, ux, ui), and no doc is both `quick` and `thorough`.' },
  { id: 'checkins', text: 'In project.md, `checkins`, when present, is `each-doc`, `end` or `none`.' },
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
    data[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return { data, body: text.slice(m[0].length), duplicates, unparsed };
}

// Headings a reader sees: none inside HTML comments or fenced examples.
export function headings(body) {
  const visible = body.replace(/<!--[\s\S]*?(?:-->|$)/g, '').replace(/^ {0,3}(```|~~~)[\s\S]*?(?:^ {0,3}\1[^\n]*$|(?![\s\S]))/gm, '');
  return [...visible.matchAll(/^ {0,3}##\s+(.+?)\s*$/gm)].map((h) => h.at(1));
}

export function wordCount(body) {
  // Count prose only: drop HTML comments (template guidance) and code fences.
  const prose = body.replace(/<!--[\s\S]*?-->/g, '').replace(/```[\s\S]*?```/g, '');
  return (prose.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
}

function list(raw) {
  return new Set((raw || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
}

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
  return createHash('sha256').update(meaning + body.replace(/\r\n/g, '\n').trim()).digest('hex').slice(0, 12);
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.updated || '')) fail('updated', 'frontmatter "updated" must be YYYY-MM-DD');
    if (data.depth !== undefined && !DEPTHS.includes(data.depth)) {
      fail('depth', `frontmatter "depth" must be one of ${DEPTHS.join('|')}`);
    }
    if (data.status === 'accepted' && !/^\d{4}-\d{2}-\d{2}$/.test(data.accepted || '')) {
      fail('accepted-date', 'accepted docs need frontmatter "accepted: YYYY-MM-DD" (set only on the human\'s word)');
    }
    if (name === 'project') {
      for (const key of ['quick', 'thorough', 'skip']) {
        const unknown = [...list(data[key])].filter((n) => !LISTABLE.includes(n));
        if (unknown.length) fail('doc-lists', `"${key}:" names unknown doc(s) ${unknown.join(', ')}. Known: ${LISTABLE.join(', ')}`);
      }
      const both = [...list(data.quick)].filter((n) => list(data.thorough).has(n));
      if (both.length) fail('doc-lists', `${both.join(', ')} listed under both "quick:" and "thorough:"`);
      if (data.checkins !== undefined && !CHECKINS.includes(data.checkins)) {
        fail('checkins', `"checkins" must be one of ${CHECKINS.join('|')} (found "${data.checkins}")`);
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
  if (PLACEHOLDER.test(body.replace(/<!--[\s\S]*?-->/g, '')) || PLACEHOLDER.test(frontmatterValues)) {
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
      results.push({ name, file: spec.file, status: 'missing', words: 0, errors: [], warnings: [] });
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

// Today as the person running the command sees it (local time, not UTC), so
// an acceptance at 23:30 is not stamped with tomorrow's date.
export function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Marks a doc accepted on the human's word: status, date and a fingerprint of
// its content. Refuses a doc that would not validate as accepted.
export function acceptDoc(root, name, today = localDate()) {
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
  const tmp = `${path}.dybs-${process.pid}.tmp`;
  const mode = lstatSync(path).mode & 0o7777;
  writeFileSync(tmp, next, { flag: 'wx', mode });
  try { chmodSync(tmp, mode); renameSync(tmp, path); } catch (err) { rmSync(tmp, { force: true }); throw err; }
  return { ok: true };
}

export function main(argv) {
  const args = argv.slice(2);
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
    const r = acceptDoc(root, accept);
    if (json) {
      console.log(JSON.stringify({ schema: 2, accept, ok: r.ok, errors: r.errors || [] }, null, 2));
      return r.ok ? 0 : 1;
    }
    if (!r.ok) { console.error(`not accepted, fix first:\n  ${r.errors.join('\n  ')}`); return 1; }
    console.log(`${accept} accepted.`);
    return 0;
  }
  const report = validateProject(root, only);

  if (json) {
    // schema 2: depth split into requestedDepth/documentDepth/needsDeepening.
    console.log(JSON.stringify({ schema: 2, ...report, next: report.parked ? 'kickoff' : nextStep(report.results, report.checkins) }, null, 2));
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

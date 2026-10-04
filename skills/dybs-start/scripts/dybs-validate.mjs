#!/usr/bin/env node
// Validates a project's dybs/ folder against the Getting Started contract.
// Usage: node dybs-validate.mjs [projectRoot] [--doc <name>] [--json]
// Exit code 0 = no errors (warnings allowed), 1 = errors, 2 = usage problem.
//
// This file is the single home for the doc contract (required sections and
// length caps). Templates and skills must agree with DOCS below.

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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
  { id: 'depth', text: 'Frontmatter `depth`, when present, is `quick` or `thorough`.' },
  { id: 'cap', text: 'The doc is under the word cap for its depth (quick or thorough), not counting HTML comments and code blocks.' },
  { id: 'accepted-hash', text: 'An accepted doc is not changed. Any real change sets `status: draft` and removes `accepted` and `accepted-hash`, and the human accepts again. (`accepted-hash` is written by the validator\'s `--accept` and lets it detect a change.)' },
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

export function headings(body) {
  return [...body.matchAll(/^##\s+(.+?)\s*$/gm)].map((h) => h.at(1));
}

export function wordCount(body) {
  // Count prose only: drop HTML comments (template guidance) and code fences.
  const prose = body.replace(/<!--[\s\S]*?-->/g, '').replace(/```[\s\S]*?```/g, '');
  return (prose.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
}

function list(raw) {
  return new Set((raw || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
}

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

// Fingerprint of a doc's content (not its frontmatter), stored as
// `accepted-hash` when the human accepts, so a later edit is detectable.
export function bodyHash(body) {
  return createHash('sha256').update(body.replace(/\r\n/g, '\n').trim()).digest('hex').slice(0, 12);
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
  const { data, body } = parseFrontmatter(text);

  if (!data) {
    fail('frontmatter', 'missing frontmatter (--- block at the top)');
  } else {
    if (data.doc !== name) fail('doc-name', `frontmatter "doc" must be "${name}" (found "${data.doc ?? ''}")`);
    if (!STATUSES.includes(data.status)) fail('status', `frontmatter "status" must be one of ${STATUSES.join('|')}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.updated || '')) fail('updated', 'frontmatter "updated" must be YYYY-MM-DD');
    if (data.depth !== undefined && !DEPTHS.includes(data.depth)) {
      fail('depth', `frontmatter "depth" must be one of ${DEPTHS.join('|')}`);
    }
    if (data.status === 'accepted' && !/^\d{4}-\d{2}-\d{2}$/.test(data.accepted || '')) {
      fail('accepted-date', 'accepted docs need frontmatter "accepted: YYYY-MM-DD" (set only on the human\'s word)');
    }
    if (data.status === 'accepted' && data['accepted-hash'] && data['accepted-hash'] !== bodyHash(body)) {
      fail('accepted-hash', 'changed after it was accepted: set status: draft, remove accepted and accepted-hash, and ask the human to accept again');
    }
  }
  // In project.md, `depth` is the project's setting, not how deep project.md
  // itself was written, so project.md never needs deepening.
  const documentDepth = name !== 'project' && DEPTHS.includes(data?.depth) ? data.depth : null;
  const depth = documentDepth ?? requestedDepth;
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

  if (PLACEHOLDER.test(body.replace(/<!--[\s\S]*?-->/g, ''))) {
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
    if (only && name !== only) continue;
    const spec = DOCS[name];
    const path = join(dir, spec.file);
    if (skip.has(name)) {
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
  return { ok, complete, atRequestedDepth, accepted, deepen, results };
}

function nextStep(results) {
  const pending = results.find((r) => r.status === 'missing' || r.status === 'draft' || r.errors.length || r.needsDeepening);
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

// Marks a doc accepted on the human's word: status, date and a fingerprint of
// its content. Refuses a doc that would not validate as accepted.
export function acceptDoc(root, name, today = new Date().toISOString().slice(0, 10)) {
  const path = join(root, 'dybs', DOCS[name].file);
  const text = readFileSync(path, 'utf8');
  const { body } = parseFrontmatter(text);
  const next = setFrontmatter(text, { status: 'accepted', updated: today, accepted: today, 'accepted-hash': bodyHash(body) });
  const projectPath = join(root, 'dybs', DOCS.project.file);
  const projectData = existsSync(projectPath) ? parseFrontmatter(readFileSync(projectPath, 'utf8')).data : null;
  const check = validateDoc(name, next, depthFor(name, projectData));
  if (check.errors.length) return { ok: false, errors: check.errors };
  writeFileSync(path, next);
  return { ok: true };
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
  const acceptIdx = args.indexOf('--accept');
  const accept = acceptIdx >= 0 ? args[acceptIdx + 1] : undefined;
  const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--doc' && args[i - 1] !== '--accept');
  const root = resolve(positional[0] || '.');
  if (accept) {
    if (!DOCS[accept]) { console.error(`unknown doc "${accept}". Known: ${ORDER.join(', ')}`); return 2; }
    const r = acceptDoc(root, accept);
    if (!r.ok) { console.error(`not accepted, fix first:\n  ${r.errors.join('\n  ')}`); return 1; }
    console.log(`${accept} accepted.`);
    return 0;
  }
  const report = validateProject(root, only);

  if (json) {
    // schema 2: depth split into requestedDepth/documentDepth/needsDeepening.
    console.log(JSON.stringify({ schema: 2, ...report, next: nextStep(report.results) }, null, 2));
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
  const next = nextStep(report.results);
  console.log(next ? `\nNext: ${next}` : '\nAll Getting Started docs accepted at the requested depth.');
  return report.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(main(process.argv));
}

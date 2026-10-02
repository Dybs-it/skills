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

function skipped(projectData) {
  // project.md may declare `skip: ui, ux` for docs that do not apply.
  const raw = projectData?.skip || '';
  return new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
}

export function validateDoc(name, text) {
  const spec = DOCS[name];
  const errors = [];
  const warnings = [];
  const { data, body } = parseFrontmatter(text);

  if (!data) {
    errors.push('missing frontmatter (--- block at the top)');
  } else {
    if (data.doc !== name) errors.push(`frontmatter "doc" must be "${name}" (found "${data.doc ?? ''}")`);
    if (!STATUSES.includes(data.status)) errors.push(`frontmatter "status" must be one of ${STATUSES.join('|')}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.updated || '')) errors.push('frontmatter "updated" must be YYYY-MM-DD');
    if (data.status === 'accepted' && !/^\d{4}-\d{2}-\d{2}$/.test(data.accepted || '')) {
      errors.push('accepted docs need frontmatter "accepted: YYYY-MM-DD" (set only on the human\'s word)');
    }
  }

  const found = headings(body);
  const missing = spec.sections.filter((s) => !found.some((h) => h.toLowerCase() === s.toLowerCase()));
  for (const s of missing) errors.push(`missing section "## ${s}"`);

  const words = wordCount(body);
  if (words > spec.maxWords) {
    errors.push(`${words} words, cap is ${spec.maxWords}. Cut, or move detail to context/decisions/`);
  } else if (words > spec.maxWords * 0.9) {
    warnings.push(`${words} words, close to the cap of ${spec.maxWords}`);
  }

  if (PLACEHOLDER.test(body.replace(/<!--[\s\S]*?-->/g, ''))) {
    const msg = 'unfilled placeholder ({{...}}, TODO or TBD)';
    if (data?.status === 'accepted') errors.push(msg);
    else warnings.push(msg);
  }

  return { name, file: spec.file, status: data?.status ?? null, words, errors, warnings };
}

export function validateProject(root, only) {
  const dir = join(root, 'dybs');
  const results = [];
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return { ok: false, fatal: `no dybs/ folder in ${root}. Run the dybs-start skill first.`, results };
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
    results.push(validateDoc(name, readFileSync(path, 'utf8')));
  }
  const ok = results.every((r) => r.errors.length === 0);
  return { ok, results };
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
    console.log(JSON.stringify({ ...report, next: nextStep(report.results) }, null, 2));
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

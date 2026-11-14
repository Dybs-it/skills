#!/usr/bin/env node
// Picks the model and effort for one quality step of one task, and keeps the
// task's run log. Everything is computed from dybs/work/<task>/test-plan.md,
// so the same plan always gives the same answer.
//
// Usage:
//   node dybs-route.mjs score <task-folder> [--json]
//   node dybs-route.mjs route <task-folder> <step> [--escalate] [--json|--flags]
//   node dybs-route.mjs log   <task-folder> <step> <event> [--ran-on <model>] [--note <text>]
//
// <step>  is one of STEPS; <event> is one of EVENTS.
// --flags prints `--model <m> --effort <e>`, ready for `claude $(...)`.
// Exit code 0 = answered; 2 = usage or format problem.
//
// The rules live here, as code, so a launcher (the Dybs app, a shell alias, a
// human) and every skill read one table. quality.md describes them in words.
// The thresholds are a first guess: tune them from the run logs.

import { readFileSync, appendFileSync, existsSync, lstatSync } from 'node:fs';
import { resolve, join, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STEPS = ['test-plan', 'tests', 'review', 'gate', 'pr'];
export const EVENTS = ['start', 'done', 'stuck', 'escalate'];
export const LEVELS = ['S', 'M', 'L', 'XL'];
// Weakest first. Escalating moves one place to the right.
export const MODELS = ['haiku', 'sonnet', 'opus', 'fable'];
export const EFFORTS = ['low', 'medium', 'high'];

// step -> complexity -> [model, effort]. Planning and judging follow the
// task's complexity; the gate and the PR text are mechanical at any size.
export const ROUTES = {
  'test-plan': { S: ['sonnet', 'medium'], M: ['sonnet', 'medium'], L: ['opus', 'medium'], XL: ['opus', 'high'] },
  tests: { S: ['sonnet', 'medium'], M: ['sonnet', 'medium'], L: ['opus', 'high'], XL: ['fable', 'high'] },
  review: { S: ['sonnet', 'medium'], M: ['sonnet', 'medium'], L: ['opus', 'high'], XL: ['opus', 'high'] },
  gate: { S: ['sonnet', 'low'], M: ['sonnet', 'low'], L: ['sonnet', 'low'], XL: ['sonnet', 'medium'] },
  pr: { S: ['sonnet', 'low'], M: ['sonnet', 'low'], L: ['sonnet', 'low'], XL: ['sonnet', 'medium'] },
};

// Without a plan nothing is known about the task: plan it as a middle case.
export const UNKNOWN = 'M';
// Points at or above each bound give that level.
export const BOUNDS = { M: 2, L: 5, XL: 8 };
// A file larger than this is sized from its bytes instead of being read.
const MAX_READ = 2 * 1024 * 1024;

const TASK_NAME = /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u;
const lf = (t) => String(t ?? '').replace(/\r\n?/g, '\n');

// The plan as a reader sees it: no HTML comments, no fenced code.
function visible(text) {
  return lf(text).replace(/<!--[\s\S]*?-->/g, '').replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, '');
}

export function frontmatter(text) {
  const m = lf(text).match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  const out = {};
  if (!m) return out;
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (kv && !(kv[1] in out)) out[kv[1]] = kv[2].trim();
  }
  return out;
}

export function section(text, heading) {
  const lines = visible(text).split('\n');
  const start = lines.findIndex((l) => l.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start < 0) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^## /.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}

// Table rows as cells, without the header and the divider. A row that still
// holds a template placeholder is not a row yet.
export function rows(sectionText) {
  const lines = sectionText.split('\n').filter((l) => /^\s*\|/.test(l));
  const body = lines.filter((l, i) => i > 0 && !/^\s*\|[\s:|-]+\|?\s*$/.test(l) && !l.includes('{{'));
  return body.map((l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim()));
}

// The header names decide the column, so a plan with an extra column still reads.
function column(sectionText, name) {
  const header = sectionText.split('\n').find((l) => /^\s*\|/.test(l));
  if (!header) return -1;
  const cells = header.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim().toLowerCase());
  return cells.indexOf(name.toLowerCase());
}

// Complexity says how hard the work is to get right, not how much it matters.
// It is built from facts a script can measure (how much code is in scope, how
// many parts it spans, how much has to be proven, at which test level).
// What the planning agent merely judged (risk scores, priorities) differs from
// run to run on the same task, so together it can add one point at most.
export function score(planText, { root = null } = {}) {
  const fm = frontmatter(planText);
  const reasons = [];
  let points = 0;
  const add = (n, why) => { if (n > 0) { points += n; reasons.push(`+${n} ${why}`); } };

  const scope = section(planText, 'Scope');
  const inScope = scope.split(/out of scope|\*\*out:?\*\*/i)[0];
  const named = [...new Set([...inScope.matchAll(/`([^`\s]+\.[A-Za-z0-9]+)(?::[\d-]+)?`/g)].map((m) => m[1]))];
  // With the project at hand only files that exist count, and their size too.
  let files = named;
  let lines = null;
  if (root) {
    files = [];
    lines = 0;
    for (const f of named) {
      const abs = resolve(root, f);
      if (abs !== root && !abs.startsWith(root + sep)) continue;
      let st;
      try { st = lstatSync(abs); } catch { continue; }
      if (!st.isFile()) continue;
      files.push(f);
      lines += st.size > MAX_READ ? Math.round(st.size / 40) : readFileSync(abs, 'utf8').split('\n').length;
    }
  }
  add(files.length > 20 ? 3 : files.length > 8 ? 2 : files.length > 3 ? 1 : 0, `${files.length} files in scope`);
  if (lines !== null) add(lines > 5000 ? 3 : lines > 1500 ? 2 : lines > 400 ? 1 : 0, `${lines} lines in those files`);
  const parts = new Set(files.map((f) => f.split('/').slice(0, -1).slice(0, 2).join('/')));
  add(parts.size >= 5 ? 2 : parts.size >= 3 ? 1 : 0, `${parts.size} folders touched`);

  const scen = section(planText, 'Scenarios');
  const scenarios = rows(scen);
  add(scenarios.length > 20 ? 2 : scenarios.length > 10 ? 1 : 0, `${scenarios.length} scenarios`);
  const lv = column(scen, 'Level');
  const levels = new Set(lv < 0 ? [] : scenarios.map((r) => (r[lv] || '').toLowerCase()));
  const e2e = [...levels].some((l) => /end.?to.?end|e2e/.test(l));
  add(e2e ? 2 : levels.has('integration') ? 1 : 0, e2e ? 'end-to-end scenarios' : 'integration scenarios');

  const criteria = section(planText, 'Acceptance criteria');
  const p0 = [...criteria.matchAll(/^\s*[-*]\s*\*\*AC\d+\*\*[^\n]*?\(\s*P0\b/gm)].length;
  const risks = section(planText, 'Risks');
  const sc = column(risks, 'Score');
  const scores = sc < 0 ? [] : rows(risks).map((r) => Number(r[sc])).filter((n) => Number.isInteger(n));
  const top = scores.length ? Math.max(...scores) : 0;
  add(top >= 9 || p0 >= 3 ? 1 : 0, `judged risky (highest risk ${top}, ${p0} P0 criteria)`);

  const computed = points >= BOUNDS.XL ? 'XL' : points >= BOUNDS.L ? 'L' : points >= BOUNDS.M ? 'M' : 'S';
  // The human's word wins: `complexity: L` in the plan's frontmatter.
  const override = LEVELS.includes((fm.complexity || '').toUpperCase()) ? fm.complexity.toUpperCase() : null;
  return { complexity: override || computed, computed, override, points, reasons };
}

export function route(step, complexity, { escalate = false } = {}) {
  if (!STEPS.includes(step)) throw new Error(`unknown step "${step}" (one of: ${STEPS.join(', ')})`);
  let [model, effort] = ROUTES[step][complexity];
  if (escalate) {
    model = MODELS[Math.min(MODELS.indexOf(model) + 1, MODELS.length - 1)];
    effort = 'high';
  }
  return { model, effort };
}

function taskFolder(arg) {
  const dir = resolve(arg || '');
  if (!arg || !existsSync(dir) || !lstatSync(dir).isDirectory()) throw new Error(`not a task folder: ${arg ?? '(none)'}`);
  if (!TASK_NAME.test(basename(dir))) throw new Error(`task folder "${basename(dir)}" is named against the rule in quality.md`);
  return dir;
}

export function scoreTask(dir) {
  const plan = join(dir, 'test-plan.md');
  if (!existsSync(plan) || !lstatSync(plan).isFile()) {
    return { complexity: UNKNOWN, computed: null, override: null, points: null, reasons: ['no test-plan.md yet: planned as a middle case'] };
  }
  // dybs/work/<task>/ sits three folders below the project root.
  const root = basename(resolve(dir, '..')) === 'work' && basename(resolve(dir, '../..')) === 'dybs' ? resolve(dir, '../../..') : null;
  return score(readFileSync(plan, 'utf8'), { root });
}

const oneLine = (s) => String(s ?? '').replace(/[\r\n|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);

// One line per event, appended: no run ever rewrites another run's lines.
export function logLine({ step, event, complexity, model, effort, ranOn, note, now = new Date() }) {
  const parts = [now.toISOString().slice(0, 16) + 'Z', step, event, `complexity ${complexity}`, `routed ${model} ${effort}`];
  if (ranOn) parts.push(`ran on ${oneLine(ranOn)}`);
  if (note) parts.push(oneLine(note));
  return `- ${parts.join(' | ')}\n`;
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const flags = new Set(rest.filter((a) => a.startsWith('--')));
  const value = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
  const skip = new Set([value('--ran-on'), value('--note')].filter((v) => v !== undefined));
  const pos = rest.filter((a) => !a.startsWith('--') && !skip.has(a));
  const json = flags.has('--json');

  if (cmd === 'score') {
    const s = scoreTask(taskFolder(pos[0]));
    if (json) return console.log(JSON.stringify(s));
    console.log(`Complexity: ${s.complexity}${s.override ? ` (set by the human; computed ${s.computed})` : ''}`);
    for (const r of s.reasons) console.log(`  ${r}`);
    return;
  }
  if (cmd === 'route' || cmd === 'log') {
    const dir = taskFolder(pos[0]);
    const step = pos[1];
    const s = scoreTask(dir);
    const event = cmd === 'log' ? pos[2] : null;
    if (cmd === 'log' && !EVENTS.includes(event)) throw new Error(`unknown event "${event}" (one of: ${EVENTS.join(', ')})`);
    const r = route(step, s.complexity, { escalate: flags.has('--escalate') });
    if (cmd === 'route') {
      if (json) return console.log(JSON.stringify({ step, complexity: s.complexity, ...r }));
      if (flags.has('--flags')) return console.log(`--model ${r.model} --effort ${r.effort}`);
      return console.log(`${step}: ${r.model}, effort ${r.effort} (complexity ${s.complexity})`);
    }
    const file = join(dir, 'log.md');
    if (existsSync(file) && !lstatSync(file).isFile()) throw new Error('log.md is not a regular file');
    const head = existsSync(file) ? '' : `# Run log: ${basename(dir)}\n\n`;
    appendFileSync(file, head + logLine({ step, event, complexity: s.complexity, ...r, ranOn: value('--ran-on'), note: value('--note') }));
    console.log(`Logged ${step} ${event} (complexity ${s.complexity}, routed ${r.model} ${r.effort}).`);
    if (event === 'stuck') {
      const up = route(step, s.complexity, { escalate: true });
      console.log(up.model === r.model && r.effort === 'high'
        ? 'Already on the strongest route: this needs the human.'
        : `Escalate: run this step again with --model ${up.model} --effort ${up.effort}.`);
    }
    return;
  }
  throw new Error('usage: dybs-route.mjs score|route|log <task-folder> [<step> [<event>]]');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
}

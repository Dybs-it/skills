#!/usr/bin/env node
// The mechanical side of the work loop, so no agent turn is spent on it:
// which step a task needs next, on which model and effort, and the run log.
// Everything is computed from the files in dybs/work/<task>/, so the same
// files always give the same answer.
//
// Usage:
//   node dybs-route.mjs next   <task-folder> [--json]
//   node dybs-route.mjs status <dybs/work folder> [--json]
//   node dybs-route.mjs items  <task-folder>          the gate's Items and Risks tables
//   node dybs-route.mjs score  <task-folder> [--json]
//   node dybs-route.mjs route  <task-folder> <step> [--escalate] [--json|--flags]
//   node dybs-route.mjs log    <task-folder> <step> <event> [--ran-on <model>] [--note <text>]
//
// <step>  is one of STEPS; <event> is one of EVENTS.
// --flags prints `--model <m> --effort <e>`, ready for `claude $(...)`.
// Exit code 0 = answered; 2 = usage or format problem.
//
// The rules live here, as code, so a launcher (the Dybs app, a shell alias, a
// human) and every skill read one table. quality.md describes them in words.
// The thresholds are a first guess: tune them from the run logs.

import { readFileSync, appendFileSync, existsSync, lstatSync, readdirSync } from 'node:fs';
import { resolve, join, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Every step a skill can log. `tests` is dybs-tests used on its own, outside
// the loop; the loop builds with `build`.
export const STEPS = ['task', 'test-plan', 'build', 'tests', 'review', 'gate', 'pr', 'done'];
export const SKILLS = { task: 'dybs-task', 'test-plan': 'dybs-test-plan', build: 'dybs-build', tests: 'dybs-tests', review: 'dybs-review', gate: 'dybs-gate', pr: 'dybs-pr', done: 'dybs-done' };
export const STATUSES = ['open', 'building', 'review', 'done', 'stopped'];
export const LANES = ['fast', 'full'];
// A task is small enough for the fast lane at or under each of these.
export const FAST = { files: 2, lines: 600, criteria: 3 };
// A step that gave up this many times needs the human.
export const MAX_STUCK = 2;
// Reviews of one task before open findings go to the human.
export const MAX_ROUNDS = 3;
// Builds of one task that report done before the loop stops asking for more.
export const MAX_BUILDS = 5;
export const EVENTS = ['start', 'done', 'stuck', 'escalate'];
export const LEVELS = ['S', 'M', 'L', 'XL'];
// Weakest first. Escalating moves one place to the right.
export const MODELS = ['haiku', 'sonnet', 'opus', 'fable'];
export const EFFORTS = ['low', 'medium', 'high'];

// step -> complexity -> [model, effort]. Planning and judging follow the
// task's complexity; the gate and the PR text are mechanical at any size.
export const ROUTES = {
  task: { S: ['sonnet', 'low'], M: ['sonnet', 'low'], L: ['sonnet', 'medium'], XL: ['sonnet', 'medium'] },
  build: { S: ['sonnet', 'medium'], M: ['sonnet', 'medium'], L: ['opus', 'high'], XL: ['fable', 'high'] },
  done: { S: ['sonnet', 'low'], M: ['sonnet', 'low'], L: ['sonnet', 'low'], XL: ['sonnet', 'medium'] },
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

  // A test plan names its code under Scope; a task without a plan yet names
  // it under Touches.
  const scope = section(planText, 'Scope') || section(planText, 'Touches');
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
  return { complexity: override || computed, computed, override, points, reasons, files: files.length, named: named.length, lines };
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

// The text of a regular file in the task folder, or null.
function read(dir, name) {
  const p = join(dir, name);
  try { return lstatSync(p).isFile() ? readFileSync(p, 'utf8') : null; } catch { return null; }
}

// dybs/work/<task>/ sits three folders below the project root.
const projectRoot = (dir) => (basename(resolve(dir, '..')) === 'work' && basename(resolve(dir, '../..')) === 'dybs' ? resolve(dir, '../../..') : null);

// From the test plan when there is one, else from what the task says it
// touches, else a middle case.
export function scoreTask(dir) {
  const root = projectRoot(dir);
  const plan = read(dir, 'test-plan.md');
  if (plan !== null) return score(plan, { root });
  const task = read(dir, 'task.md');
  if (task !== null) {
    const s = score(task, { root });
    const fm = frontmatter(task);
    const override = LEVELS.includes((fm.complexity || '').toUpperCase()) ? fm.complexity.toUpperCase() : null;
    return { ...s, complexity: override || s.complexity, override, reasons: [...s.reasons, 'no test plan yet: scored from the task'] };
  }
  return { complexity: UNKNOWN, computed: null, override: null, points: null, reasons: ['no task.md or test-plan.md yet: planned as a middle case'], files: 0, lines: null };
}

// What a task.md says: its status, its lane, and how much it asks for.
// The lane is computed unless the human wrote `lane:` in the frontmatter:
// fast when the task touches little, asks little and cites no domain rule.
export function taskInfo(taskText, { root = null } = {}) {
  const fm = frontmatter(taskText);
  const status = STATUSES.includes((fm.status || '').toLowerCase()) ? fm.status.toLowerCase() : 'open';
  const criteria = [...section(taskText, 'Acceptance').matchAll(/^\s*[-*]\s+\S/gm)].length;
  const s = score(taskText, { root });
  const rules = /\bD\d+\b/.test(section(taskText, 'Acceptance') + section(taskText, 'Ask'));
  const why = [];
  // Every file the task names counts, also one it will create: a task is
  // not smaller because its files do not exist yet.
  if (s.named === 0) why.push('it names no file it touches');
  if (s.named > FAST.files) why.push(`${s.named} files`);
  if (s.lines !== null && s.lines > FAST.lines) why.push(`${s.lines} lines in those files`);
  if (criteria === 0) why.push('no acceptance criteria');
  if (criteria > FAST.criteria) why.push(`${criteria} acceptance criteria`);
  if (rules) why.push('it cites a domain rule');
  const computed = why.length ? 'full' : 'fast';
  const override = LANES.includes((fm.lane || '').toLowerCase()) ? fm.lane.toLowerCase() : null;
  return { status, lane: override || computed, laneComputed: computed, laneOverride: override, why, criteria };
}

// Findings in review.md are checklist items: `- [ ] **V1** ...` open,
// `- [x] **V1** ...` fixed. An open one marked `(needs human: ...)` is a
// question, not a fix. `status: stale` in the frontmatter means the code
// changed after the review.
export function findings(reviewText) {
  const fm = frontmatter(reviewText);
  const items = [...visible(reviewText).matchAll(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/gm)].filter((m) => !m[2].includes('{{'));
  const open = items.filter((m) => m[1] === ' ');
  const human = open.filter((m) => /\(needs human\b/i.test(m[2])).length;
  const round = Number.isInteger(Number(fm.round)) && Number(fm.round) > 0 ? Number(fm.round) : 1;
  return { total: items.length, fixed: items.length - open.length, open: open.length - human, human, stale: (fm.status || '').toLowerCase() === 'stale', round };
}

// The scenarios of a test plan per status.
export function scenarios(planText) {
  const scen = section(planText, 'Scenarios');
  const col = column(scen, 'Status');
  const prio = column(scen, 'Priority');
  const out = { total: 0, planned: 0, stuck: 0, optional: 0 };
  if (col < 0) return out;
  for (const r of rows(scen)) {
    const st = (r[col] || '').toLowerCase();
    out.total += 1;
    // dybs-build takes P3 only when asked: a planned P3 is not pending work.
    if (st === 'planned' && prio >= 0 && (r[prio] || '').toUpperCase() === 'P3') out.optional += 1;
    else if (st === 'planned') out.planned += 1;
    if (st === 'stuck') out.stuck += 1;
  }
  return out;
}

const PRIO = ['P0', 'P1', 'P2', 'P3'];
const higher = (a, b) => (PRIO.indexOf(a) <= PRIO.indexOf(b) ? a : b);
// Same reading as dybs-gate.mjs: a bare token `path:line`, or a whole code
// span when the path holds a space, a comma or a Markdown character.
const LOCATION = /^(?:[A-Za-z]:[\\/])?[^\s:`|]+:[1-9]\d*$/;
const SPANNED = /^(?:[A-Za-z]:[\\/])?(?=\S)[^:`|]*[^\s:`|]:[1-9]\d*$/;
export function testLocations(cellText) {
  const out = [];
  const rest = String(cellText ?? '').replace(/`([^`]+)`/g, (m, inner) => { if (SPANNED.test(inner)) out.push(inner); return ' '; });
  for (const tok of rest.split(/[,;\s]+/)) if (LOCATION.test(tok)) out.push(tok);
  return out;
}
// Printed back in a code span when the bare token would not survive.
const shown = (loc) => (/[\s,;*_[\]<>~\\&]/.test(loc) ? `\`${loc}\`` : loc);
const cell = (v) => String(v ?? '').replace(/[|\\]/g, '').replace(/\s+/g, ' ').trim();
// The gate script takes a risk's name only as plain text: no Markdown, no
// entities. A plan writes them freely, so the name is made plain here.
const plain = (v, n) => {
  const t = String(v ?? '').replace(/&[#A-Za-z0-9]+;/g, ' ').replace(/[[\]<>`*~\\|]/g, '').replace(/\s+/g, ' ').trim().replace(/^_+|_+$/g, '').slice(0, 100).trim();
  return /[\p{L}\p{N}]/u.test(t) ? t : `risk ${n}`;
};

// The gate's Items table, built from the test plan so it is the same every
// time: one row per acceptance criterion and per requirement or rule (R#,
// D#) the criteria cite. A row is FULL only when every scenario that covers
// it is green or proven and names its test as path:line. The gate step may
// lower a row after reading the test; it never raises one.
export function gateItems(planText) {
  const crit = [];
  for (const m of section(planText, 'Acceptance criteria').matchAll(/^\s*[-*]\s*\*\*(AC\d+)\*\*\s*\(([^)]*)\)/gm)) {
    const parts = m[2].split(/[,\s]+/).filter(Boolean);
    crit.push({ id: m[1], priority: parts.find((x) => PRIO.includes(x)) || null, refs: parts.filter((x) => /^[RD]\d+$/.test(x)) });
  }
  const scen = section(planText, 'Scenarios');
  const col = (n) => column(scen, n);
  const [cCov, cTest, cStatus, cPrio] = [col('Covers'), col('Test'), col('Status'), col('Priority')];
  const sc = rows(scen).map((r) => ({
    covers: (r[cCov] || '').split(/[,\s]+/).filter(Boolean),
    tests: testLocations(r[cTest]),
    proven: ['green', 'proven'].includes((r[cStatus] || '').toLowerCase()),
    priority: PRIO.includes(r[cPrio]) ? r[cPrio] : null,
  }));
  const rowFor = (id, base, covering) => {
    let priority = base;
    for (const x of covering) if (x.priority) priority = priority ? higher(priority, x.priority) : x.priority;
    const ok = covering.filter((x) => x.proven && x.tests.length);
    const coverage = !covering.length || !ok.length ? 'NONE' : ok.length === covering.length ? 'FULL' : 'PARTIAL';
    return { item: id, priority: priority || 'P0', coverage, evidence: [...new Set(ok.flatMap((x) => x.tests))] };
  };
  const items = crit.map((c) => rowFor(c.id, c.priority, sc.filter((x) => x.covers.includes(c.id))));
  const byId = Object.fromEntries(items.map((i) => [i.item, i]));
  for (const ref of [...new Set(crit.flatMap((c) => c.refs))]) {
    const citing = crit.filter((c) => c.refs.includes(ref)).map((c) => byId[c.id]);
    const direct = sc.filter((x) => x.covers.includes(ref));
    const d = rowFor(ref, null, direct);
    const all = [...citing, ...(direct.length ? [d] : [])];
    const coverage = all.every((x) => x.coverage === 'FULL') ? 'FULL' : all.some((x) => x.coverage !== 'NONE') ? 'PARTIAL' : 'NONE';
    items.push({ item: ref, priority: all.map((x) => x.priority).reduce(higher), coverage, evidence: [...new Set(all.flatMap((x) => x.evidence))] });
  }
  const risks = section(planText, 'Risks');
  const rc = ['Risk', 'Category', 'P', 'I', 'Score', 'Status'].map((n) => column(risks, n));
  const riskRows = rc.some((i) => i < 0) ? [] : rows(risks).map((r) => rc.map((i) => r[i] || ''));
  return { items, risks: riskRows };
}

export function gateTables(planText) {
  const g = gateItems(planText);
  const out = ['## Items', '', '| Item | Priority | Coverage | Evidence | Security |', '|---|---|---|---|---|'];
  for (const i of g.items) out.push(`| ${i.item} | ${i.priority} | ${i.coverage} | ${i.evidence.map(shown).join(', ')} | no |`);
  out.push('', '## Risks', '', '| Risk | Category | P | I | Score | Status |', '|---|---|---|---|---|---|');
  g.risks.forEach((r, n) => out.push(`| ${[plain(r[0], n + 1), ...r.slice(1).map(cell)].join(' | ')} |`));
  return out.join('\n') + '\n';
}

// What gate.md says was decided, or null. The gate script is the judge;
// this only reads what the gate step copied from it.
export function gateDecision(gateText) {
  const d = section(gateText, 'Decision');
  if (/not computed|\bSTALE\b/i.test(d)) return null;
  // The first verdict word, however the step phrased the line around it.
  const m = d.match(/\b(PASS|CONCERNS|FAIL|WAIVED)\b/);
  return m ? m[1] : null;
}

// The gate script's own answer for this task, when dybs-gate is installed
// beside this skill: PASS, CONCERNS, WAIVED, FAIL, or null when it gives no
// decision (stale evidence, a format problem). undefined when it cannot be
// asked, and the text of gate.md has to do.
export function askGate(dir) {
  const script = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'dybs-gate', 'scripts', 'dybs-gate.mjs');
  if (!existsSync(script)) return undefined;
  const r = spawnSync(process.execPath, [script, join(dir, 'gate.md'), '--json'], { encoding: 'utf8', cwd: projectRoot(dir) || dir });
  if (r.error) return undefined;
  try {
    const d = JSON.parse(r.stdout).decision;
    return ['PASS', 'CONCERNS', 'WAIVED', 'FAIL'].includes(d) ? d : null;
  } catch { return null; }
}

export function parseLog(logText) {
  const out = [];
  for (const line of visible(logText).split('\n')) {
    if (!/^\s*-\s/.test(line)) continue;
    const c = line.replace(/^\s*-\s*/, '').split('|').map((x) => x.trim());
    if (c.length >= 3 && STEPS.includes(c[1])) out.push({ step: c[1], event: c[2] });
  }
  return out;
}

// What a task needs next, from the text of its files (null when missing):
// { kind: 'run', step, skill, escalate } | { kind: 'stop', reason, detail }
// | { kind: 'done' }. A stop always hands the task to the human.
//
//   fast lane: build, review, pr, done
//   full lane: test-plan, build, review, gate, pr, done
//
// After a review with open findings the task goes back to build; a build
// that changed code marks the review stale, and it is reviewed again.
export function next(files, { root = null } = {}) {
  const f = files || {};
  const run = (step, escalate = false) => ({ kind: 'run', step, skill: SKILLS[step], escalate });
  const stop = (reason, detail) => ({ kind: 'stop', reason, detail });
  if (typeof f.task !== 'string' || !f.task.trim()) return run('task');
  const t = taskInfo(f.task, { root });
  if (t.status === 'done') return { kind: 'done' };
  if (t.status === 'stopped') return stop('stopped', 'The task is marked stopped. Only the human clears that.');

  const log = parseLog(f.log);
  const stuck = (step) => log.filter((e) => e.step === step && e.event === 'stuck').length;
  const guarded = (step) => (stuck(step) >= MAX_STUCK
    ? stop('stuck', `${step} gave up ${stuck(step)} times, the last time on a stronger model.`)
    : run(step, stuck(step) > 0));
  // A step whose result is one file should not need a third run to write it.
  const once = (step, what) => (log.filter((e) => e.step === step && e.event === 'done').length >= 2
    ? stop('no-progress', `${step} ran twice and ${what}. Look at its last check-in.`)
    : guarded(step));

  const full = t.lane === 'full';
  const has = (x) => typeof x === 'string' && x.trim() !== '';
  // A FAIL always hands the task to the human, whatever else is pending:
  // no unattended session runs past a failed gate.
  // A recorded FAIL also outlives a gate that cannot be computed any more
  // (evidence changed since): only a new computed verdict replaces it.
  const written = full && has(f.gate) ? gateDecision(f.gate) : null;
  const gate = !full || !has(f.gate) ? null : f.gateDecision === undefined ? written : f.gateDecision === null && written === 'FAIL' ? 'FAIL' : f.gateDecision;
  if (gate === 'FAIL') return stop('gate-fail', 'The gate says FAIL. Fix what blocks it, or waive it yourself, then run dybs-gate again.');
  if (full && !has(f.testPlan)) return guarded('test-plan');
  const sc = has(f.testPlan) ? scenarios(f.testPlan) : { total: 0, planned: 0, stuck: 0 };
  // A plan without a single scenario is not a plan to build from.
  if (full && sc.total === 0) return once('test-plan', 'the plan still has no scenarios');
  const rv = has(f.review) ? findings(f.review) : null;

  if (t.status !== 'review' || sc.planned > 0 || sc.stuck > 0) {
    // A first build, a fix round per review and one escalation fit in this.
    const builds = log.filter((e) => e.step === 'build' && e.event === 'done').length;
    if (builds >= MAX_BUILDS) return stop('no-progress', `build reported done ${builds} times and the task is still not ready for review. Look at its last check-in.`);
    return guarded('build');
  }
  if (!rv || rv.stale) {
    if (rv && rv.round >= MAX_ROUNDS) return stop('review-rounds', `Reviewed ${rv.round} times and the code still changed afterwards. Look at review.md.`);
    return guarded('review');
  }
  if (rv.open > 0) {
    if (rv.round >= MAX_ROUNDS) return stop('review-rounds', `${rv.open} findings are still open after ${rv.round} reviews.`);
    return guarded('build');
  }
  if (rv.human > 0) return stop('findings', `${rv.human} review findings need your decision. They are marked (needs human) in review.md.`);
  if (full) {
    // The gate script is the judge when it can be asked; gate.md is only
    // what the step wrote down.
    if (gate === null) return once('gate', 'there is still no gate decision (stale evidence, or the gate was not computed)');
  }
  if (!has(f.pr)) return once('pr', 'there is still no pr.md');
  return stop('merge', 'The PR text is ready. Open and merge the PR, then run dybs-done to close the task.');
}

export function nextForTask(dir) {
  const files = { task: read(dir, 'task.md'), testPlan: read(dir, 'test-plan.md'), review: read(dir, 'review.md'), gate: read(dir, 'gate.md'), pr: read(dir, 'pr.md'), log: read(dir, 'log.md') };
  if (files.gate !== null) files.gateDecision = askGate(dir);
  return next(files, { root: projectRoot(dir) });
}

// The board: one row per task folder, read from the files. Nothing is stored.
export function board(workDir) {
  const out = [];
  for (const e of readdirSync(workDir, { withFileTypes: true })) {
    if (!e.isDirectory() || !TASK_NAME.test(e.name)) continue;
    const dir = join(workDir, e.name);
    const task = read(dir, 'task.md');
    const info = task === null ? null : taskInfo(task, { root: projectRoot(dir) });
    const n = nextForTask(dir);
    out.push({
      task: e.name,
      status: info ? info.status : 'no task.md',
      lane: info ? info.lane : '',
      complexity: scoreTask(dir).complexity,
      next: n.kind === 'run' ? n.step : n.kind === 'stop' ? `you: ${n.reason}` : 'done',
    });
  }
  return out.sort((a, b) => a.task.localeCompare(b.task));
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
  if (cmd === 'next') {
    const n = nextForTask(taskFolder(pos[0]));
    if (json) return console.log(JSON.stringify(n));
    if (n.kind === 'run') return console.log(`Next: ${n.skill}${n.escalate ? ' (one model up: it gave up once)' : ''}`);
    return console.log(n.kind === 'done' ? 'Done.' : `Yours (${n.reason}): ${n.detail}`);
  }
  if (cmd === 'status') {
    const dir = resolve(pos[0] || '');
    if (!pos[0] || !existsSync(dir) || !lstatSync(dir).isDirectory()) throw new Error(`not a folder: ${pos[0] ?? '(none)'}`);
    const b = board(dir);
    if (json) return console.log(JSON.stringify(b));
    if (!b.length) return console.log('No tasks.');
    console.log('| Task | Status | Lane | Size | Next |\n|---|---|---|---|---|');
    for (const r of b) console.log(`| ${r.task} | ${r.status} | ${r.lane} | ${r.complexity} | ${r.next} |`);
    return;
  }
  if (cmd === 'items') {
    const plan = read(taskFolder(pos[0]), 'test-plan.md');
    if (plan === null) throw new Error('no test-plan.md in this task folder: the gate has nothing to count');
    return process.stdout.write(gateTables(plan));
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
  throw new Error('usage: dybs-route.mjs next|status|items|score|route|log <folder> [<step> [<event>]]');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
}

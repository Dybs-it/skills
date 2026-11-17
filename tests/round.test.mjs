// dybs/.round.json: the question round a skill is asking, written for the
// Dybs app to show (decision 0012). The validator checks it when it is there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { validateProject, validateRound, SOURCE_TAGS } from '../skills/dybs-start/scripts/dybs-validate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = join(ROOT, 'tests/fixtures/sample-project');
const SCRIPT = join(ROOT, 'skills/dybs-start/scripts/dybs-validate.mjs');
const run = (args) => spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8' });

// The shape agreed in Dybs-it/dybs-desktop-app#297.
const GOOD = () => ({
  version: 1,
  id: 'discovery-map-2',
  stage: 'Discovery', doc: 'map', round: 2,
  title: 'Who has this problem, exactly?',
  asker: 'Noor', skeptic: { name: 'Bas', remark: 'Everyone is not a user.' },
  intro: 'Most of the map is settled. A round or two to go.',
  questions: [
    { n: 1, title: 'The first user', question: 'Who feels it first?', recommended: 'The household admin.', why: 'They set the house up.' },
    { n: 2, title: 'Who pays', question: 'Who pays for it?', recommended: 'Nobody yet.', why: 'Free while we learn.' },
  ],
  settled: [{ text: 'Flatmates share chores weekly.', tag: 'heard' }],
  status: 'open',
  next: 'round',
});

function project(round) {
  const dir = mkdtempSync(join(tmpdir(), 'dybs-round-'));
  cpSync(SAMPLE, dir, { recursive: true });
  if (round !== undefined) writeFileSync(join(dir, 'dybs/.round.json'), typeof round === 'string' ? round : JSON.stringify(round, null, 2));
  return dir;
}

function check(round) {
  const dir = project(round);
  try { return validateProject(dir); } finally { rmSync(dir, { recursive: true }); }
}

test('no round file is not an error', () => {
  const r = check();
  assert.equal(r.ok, true);
  assert.deepEqual(r.round, { file: 'dybs/.round.json', present: false, errors: [] });
});

test('a good round file passes', () => {
  const r = check(GOOD());
  assert.equal(r.ok, true, JSON.stringify(r.round));
  assert.deepEqual(r.round, { file: 'dybs/.round.json', present: true, errors: [] });
  // An answered round that ends the stage passes too, and the extras are optional.
  const { asker, skeptic, intro, settled, ...bare } = GOOD();
  assert.deepEqual(check({ ...bare, status: 'answered', next: 'summary' }).round.errors, []);
});

const errorsOf = (round) => check(round).round.errors;

test('a round file that is not JSON is refused, with the reason', () => {
  const r = check('{ "version": 1,');
  assert.equal(r.ok, false);
  assert.equal(r.round.errors.length, 1);
  assert.match(r.round.errors[0], /^dybs\/\.round\.json is not valid JSON/);
});

test('a wrong or missing version is refused', () => {
  assert.deepEqual(errorsOf({ ...GOOD(), version: 2 }), ['version must be 1, got 2']);
  const { version, ...none } = GOOD();
  assert.deepEqual(errorsOf(none), ['version is missing; it must be 1']);
  assert.deepEqual(errorsOf('[]'), ['the round must be one JSON object']);
});

test('a missing or empty field is refused, by name', () => {
  for (const f of ['id', 'stage', 'doc', 'title']) {
    const { [f]: _, ...rest } = GOOD();
    assert.deepEqual(errorsOf(rest), [`${f} is missing; it must be a non-empty text`], f);
    assert.deepEqual(errorsOf({ ...GOOD(), [f]: ' ' }), [`${f} is missing; it must be a non-empty text`], f);
  }
  const { round, ...noRound } = GOOD();
  assert.deepEqual(errorsOf(noRound), ['round must be a whole number from 1, got nothing']);
  assert.deepEqual(errorsOf({ ...GOOD(), round: 0 }), ['round must be a whole number from 1, got 0']);
  const { questions, ...noQuestions } = GOOD();
  assert.deepEqual(errorsOf(noQuestions), ['questions is missing; it must be a list of 1 to 7 questions']);
  const q = GOOD();
  delete q.questions[1].recommended;
  q.questions[0].why = '';
  assert.deepEqual(errorsOf(q), ['Q1: why is missing; it must be a non-empty text', 'Q2: recommended is missing; it must be a non-empty text']);
  assert.deepEqual(errorsOf({ ...GOOD(), skeptic: { name: 'Bas' } }), ['skeptic.remark is missing; it must be a non-empty text']);
  assert.deepEqual(errorsOf({ ...GOOD(), settled: [{ tag: 'heard' }] }), ['settled 1: text is missing; it must be a non-empty text']);
  assert.deepEqual(errorsOf({ ...GOOD(), asker: 3 }), ['asker must be a non-empty text when given']);
});

test('the optional fields are checked when given', () => {
  assert.deepEqual(errorsOf({ ...GOOD(), intro: '' }), ['intro must be a non-empty text when given']);
  assert.deepEqual(errorsOf({ ...GOOD(), settled: 'heard' }), ['settled must be a list when given']);
  for (const skeptic of [null, 'Bas', ['Bas']]) {
    assert.deepEqual(errorsOf({ ...GOOD(), skeptic }), ['skeptic must be an object with name and remark when given'], JSON.stringify(skeptic));
  }
});

test('a round file that is not a regular file is refused', () => {
  const dir = project();
  mkdirSync(join(dir, 'dybs/.round.json'));
  try {
    const r = validateProject(dir);
    assert.equal(r.ok, false);
    assert.deepEqual(r.round.errors, ['dybs/.round.json is not a regular file: keep dybs/.round.json a real file in dybs/']);
  } finally { rmSync(dir, { recursive: true }); }
});

const ask = (n) => ({ n, title: `T${n}`, question: `Q${n}?`, recommended: 'Yes.', why: 'Because.' });

test('a round asks 1 to 7 questions', () => {
  assert.deepEqual(errorsOf({ ...GOOD(), questions: [1, 2, 3, 4, 5, 6, 7].map(ask) }), []);
  assert.deepEqual(errorsOf({ ...GOOD(), questions: [1, 2, 3, 4, 5, 6, 7, 8].map(ask) }), ['questions has 8 questions; a round asks at most 7']);
  assert.deepEqual(errorsOf({ ...GOOD(), questions: [] }), ['questions is empty; a round asks at least one question']);
});

test('questions are numbered 1, 2, 3... in order, each number once', () => {
  assert.deepEqual(errorsOf({ ...GOOD(), questions: [1, 1].map(ask) }), ['Q2: n is 1 more than once; number the questions 1 to 2 in order']);
  assert.deepEqual(errorsOf({ ...GOOD(), questions: [2, 1].map(ask) }), ['Q1: n must be 1, got 2; number the questions 1 to 2 in order', 'Q2: n must be 2, got 1; number the questions 1 to 2 in order']);
  assert.deepEqual(errorsOf({ ...GOOD(), questions: [1, 3].map(ask) }), ['Q2: n must be 2, got 3; number the questions 1 to 2 in order']);
  assert.deepEqual(errorsOf({ ...GOOD(), questions: [ask('1')] }), ['Q1: n must be 1, got "1"; number the questions 1 to 1 in order']);
});

test('every settled item carries one of the source tags', () => {
  const settled = ['heard', 'read', 'researched', 'interview', 'assumption'].map((tag) => ({ text: 'x', tag }));
  assert.deepEqual(errorsOf({ ...GOOD(), settled }), []);
  assert.deepEqual(errorsOf({ ...GOOD(), settled: [{ text: 'x', tag: 'guessed' }] }), ['settled 1: tag "guessed" is not a source tag; use heard, read, researched, interview or assumption']);
  assert.deepEqual(errorsOf({ ...GOOD(), settled: [{ text: 'x' }] }), ['settled 1: tag is missing; use heard, read, researched, interview or assumption']);
});

test('status is open or answered, and next is round or summary', () => {
  assert.deepEqual(errorsOf({ ...GOOD(), status: 'done' }), ['status must be open or answered, got "done"']);
  assert.deepEqual(errorsOf({ ...GOOD(), next: 'doc' }), ['next must be round or summary, got "doc"']);
  const { status, next, ...neither } = GOOD();
  assert.deepEqual(errorsOf(neither), ['status must be open or answered, got nothing', 'next must be round or summary, got nothing']);
});

test('the CLI shows a broken round file and fails; --json carries it', () => {
  const dir = project({ ...GOOD(), status: 'done' });
  try {
    const r = run([dir]);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /^FAIL {6}\.round\.json\n {10}error: status must be open or answered, got "done"$/m);
    const j = run([dir, '--json']);
    assert.equal(j.status, 1);
    const out = JSON.parse(j.stdout);
    assert.equal(out.ok, false);
    assert.deepEqual(out.round, { file: 'dybs/.round.json', present: true, errors: ['status must be open or answered, got "done"'] });
  } finally { rmSync(dir, { recursive: true }); }
});

test('a good round file is shown as OK, and no round file is not shown', () => {
  const dir = project(GOOD());
  try {
    const r = run([dir]);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /^OK {8}\.round\.json$/m);
  } finally { rmSync(dir, { recursive: true }); }
  const none = project();
  try { assert.doesNotMatch(run([none]).stdout, /round\.json/); } finally { rmSync(none, { recursive: true }); }
});

test('the CLI never prints control characters taken from the round file', () => {
  // A committed round file must not be able to retitle or rewrite the terminal
  // of whoever validates the project.
  const esc = '\u001b]0;PWNED\u0007';
  for (const round of [`{"x": ${esc} }`, { ...GOOD(), questions: [ask(1), { ...ask(2), n: esc }, { ...ask(3), n: esc }] }]) {
    const dir = project(round);
    try {
      const r = run([dir]);
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stdout, /^FAIL {6}\.round\.json$/m);
      assert.doesNotMatch(r.stdout, /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
    } finally { rmSync(dir, { recursive: true }); }
  }
});

test('a round in progress never blocks a one-doc check', () => {
  const dir = project('not json');
  try {
    const r = run([dir, '--doc', 'map']);
    assert.equal(r.status, 0, r.stdout);
    assert.doesNotMatch(r.stdout, /round/);
  } finally { rmSync(dir, { recursive: true }); }
});

test('--save keeps the round out of the saved report: it is about the docs', () => {
  const dir = project('not json');
  try {
    const r = run([dir, '--save']);
    assert.equal(r.status, 1, r.stdout);
    const rep = JSON.parse(readFileSync(join(dir, 'dybs/.validation.json'), 'utf8'));
    assert.equal(rep.ok, true);
    assert.equal('round' in rep, false);
    assert.equal(rep.docs.some((d) => d.file.includes('round')), false);
  } finally { rmSync(dir, { recursive: true }); }
});

test('a round file reached through a link is refused, never read', () => {
  const dir = project();
  const outside = join(mkdtempSync(join(tmpdir(), 'dybs-outside-')), 'round.json');
  writeFileSync(outside, JSON.stringify(GOOD()));
  symlinkSync(outside, join(dir, 'dybs/.round.json'));
  try {
    const r = validateProject(dir);
    assert.equal(r.ok, false);
    assert.equal(r.round.errors.length, 1);
    assert.match(r.round.errors[0], /keep dybs\/\.round\.json a real file in dybs\//);
  } finally { rmSync(dir, { recursive: true }); rmSync(dirname(outside), { recursive: true }); }
});

test('the round tags are the source tags dybs-discover defines, one list', () => {
  const skill = readFileSync(join(ROOT, 'skills/dybs-discover/SKILL.md'), 'utf8');
  const section = skill.match(/^## Facts and assumptions\n([\s\S]*?)(?=^## )/m)[1];
  const tags = [...section.matchAll(/^- \*\(([a-z]+)/gm)].map((m) => m[1]);
  assert.deepEqual(tags, SOURCE_TAGS);
});

// --- the rule in the skills ---

const flat = (rel) => readFileSync(join(ROOT, 'skills', rel), 'utf8').replace(/\s+/g, ' ');

test('the interview writes each round to the round file before asking, and marks it answered', () => {
  const t = readFileSync(join(ROOT, 'skills/dybs-start/interview.md'), 'utf8');
  const rounds = t.match(/^## 3\. Ask in rounds\n([\s\S]*?)(?=^## )/m)[1];
  const f = rounds.replace(/\s+/g, ' ');
  assert.match(f, /Before asking a round in the session, write it to `dybs\/\.round\.json`/);
  assert.match(f, /Asking in the session stays exactly as it is/);
  assert.match(f, /After reading the human's answers, set its `status` to `answered`/);
  assert.match(f, /`id` is new for every round/);
  // The example in the rule is itself a good round, in the agreed shape.
  const example = JSON.parse(rounds.match(/```json\n([\s\S]*?)```/)[1]);
  assert.deepEqual(validateRound(example), []);
  assert.deepEqual(Object.keys(example), ['version', 'id', 'stage', 'doc', 'round', 'title', 'asker', 'skeptic', 'intro', 'questions', 'settled', 'status', 'next']);
  for (const tag of SOURCE_TAGS) assert.ok(f.includes(`\`${tag}\``), tag);
  // The id is one lowercase word per part, so "Getting Started" cannot be guessed two ways.
  assert.match(f, /`<stage>-<doc>-<round>` in lowercase, with hyphens for spaces \(`getting-started-prd-1`\)/);
  assert.match(example.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  // The file is kept with the docs: no interviewee's name or personal details go in it.
  assert.match(f, /Leave out the names and personal details of the people you heard from/);
  // The check works when this skill is installed alone, and looks at the round only:
  // mid-interview the rest of the report is about docs not written yet.
  assert.match(f, /When Node is available and `dybs-start\/scripts\/dybs-validate\.mjs` exists, run it on the project and fix only what it reports under `\.round\.json`/);
  // Asking itself is unchanged.
  assert.match(rounds, /\*\*Q1\. <short title>\*\*\n<the question, with options where that helps>\n→ Recommended: <your answer, and why in one line>/);
});

test('dybs-check tells a broken round file apart from the docs', () => {
  assert.match(flat('dybs-check/SKILL.md'), /A `FAIL` on `\.round\.json` is not a doc error: it is the last question round an interview left behind\. List it apart from the docs; the interview writes it again on its next round, or the human deletes it\./);
});

test('discovery and the kickoff write their rounds to the round file too', () => {
  assert.match(flat('dybs-discover/SKILL.md'), /Every round of questions, in every stage, also goes to `dybs\/\.round\.json` as `interview\.md` says under \*\*Ask in rounds\*\*, with `stage: Discovery` and `doc:` the stage's doc \(`map`, `sketch` or `decide`\)/);
  assert.match(flat('dybs-start/SKILL.md'), /This round goes to `dybs\/\.round\.json` too, as `interview\.md` says under \*\*Ask in rounds\*\*, with `stage: Kickoff` and `doc: project`/);
});

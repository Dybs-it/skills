import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync, renameSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { SKILLS_SRC, PLANNING } from '../src/update.mjs';
import { main, fold, segments, parts, PART_CHARS, LEDGER, FOLDER, SKIP } from '../skills/dybs-ideas/scripts/dybs-ideas.mjs';

const SCRIPT = join(SKILLS_SRC, 'dybs-ideas/scripts/dybs-ideas.mjs');

function setup(notes = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dybs-ideas-'));
  const project = join(root, 'project');
  const folder = join(root, 'notes');
  mkdirSync(join(project, 'dybs/ideas'), { recursive: true });
  mkdirSync(folder);
  for (const [n, t] of Object.entries(notes)) writeFileSync(join(folder, n), t);
  return { root, project, folder };
}

const run = (args) => {
  const lines = [];
  const code = main(args, (l) => lines.push(l));
  const text = lines.join('\n');
  let json = null;
  try { json = JSON.parse(text); } catch { /* plain */ }
  return { code, text, json };
};

const idea = (mentions) => `---\nidea: x\nstatus: captured\nserves: new\ncreated: 2026-11-22\nupdated: 2026-11-22\n---\n\n# Send reminders in the client's own language\n\n## Idea\n\nClients miss reminders.\n\n## Mentions\n\n${mentions.join('\n')}\n\n## Grilling\n\n## Advice\n\n## Decision\n`;

const ref = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12);
const CALL = 'Anna: Most of our clients read Turkish, and the reminder is always in Dutch.\nBert: So they ignore it?\n';
const CURLY = 'Kim: It’s   the “second”\nreminder.';
const C = `call.txt@${ref(CALL)}`;

test('new lists unread notes, mark records them, and a second run reads nothing', () => {
  const { root, project, folder } = setup({ 'call.txt': CALL, 'b.md': 'notes', 'skip.pdf': 'x', '.hidden.txt': 'x', 'empty.vtt': '  \n' });
  mkdirSync(join(folder, 'sub.txt'));
  symlinkSync(join(folder, 'call.txt'), join(folder, 'link.txt'));
  let r = run(['new', project, '--folder', folder, '--json']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.json.new.map((n) => n.name), ['b.md', 'call.txt']);
  assert.deepEqual(r.json.empty, ['empty.vtt']);
  assert.equal(r.json.prompt, null);
  r = run(['mark', project, ...r.json.new.map((n) => n.mark), '--folder', folder]);
  assert.equal(r.code, 0);
  // The folder is remembered: later runs can leave it out.
  r = run(['new', project, '--json']);
  assert.deepEqual(r.json.new, []);
  assert.equal(r.json.alreadyRead, 2);
  // Marking twice adds nothing.
  const before = readFileSync(join(project, LEDGER), 'utf8');
  run(['mark', project, 'call.txt']);
  assert.equal(JSON.parse(readFileSync(join(project, LEDGER), 'utf8')).read.length, JSON.parse(before).read.length);
  rmSync(root, { recursive: true });
});

test('a renamed note is not read again, a changed note is', () => {
  const { root, project, folder } = setup({ 'call.txt': CALL });
  run(['mark', project, 'call.txt', '--folder', folder]);
  renameSync(join(folder, 'call.txt'), join(folder, '2026-11-20 call.txt'));
  assert.deepEqual(run(['new', project, '--json']).json.new, []);
  writeFileSync(join(folder, '2026-11-20 call.txt'), CALL + 'Anna: One more thing.\n');
  assert.deepEqual(run(['new', project, '--json']).json.new.map((n) => n.name), ['2026-11-20 call.txt']);
  rmSync(root, { recursive: true });
});

test('mark records the content that was read, not what changed since', () => {
  const { root, project, folder } = setup({ 'call.txt': CALL });
  const seen = run(['new', project, '--folder', folder, '--json']).json.new[0].mark;
  writeFileSync(join(folder, 'call.txt'), CALL + 'Bert: added while the agent was reading.\n');
  assert.equal(run(['mark', project, seen, '--folder', folder]).code, 0);
  assert.deepEqual(run(['new', project, '--json']).json.new.map((n) => n.name), ['call.txt']);
  rmSync(root, { recursive: true });
});

test('mark refuses a note that is not in the folder and writes nothing', () => {
  const { root, project, folder } = setup({ 'call.txt': CALL });
  for (const bad of ['missing.txt', '../call.txt', 'notes/call.txt']) {
    const r = run(['mark', project, bad, '--folder', folder]);
    assert.equal(r.code, 2, bad);
    assert.ok(!existsSync(join(project, LEDGER)), bad);
  }
  rmSync(root, { recursive: true });
});

test('without a folder it stops with an honest message', () => {
  const { root, project } = setup();
  let r = run(['new', project]);
  assert.equal(r.code, 2);
  assert.match(r.text, /^dybs-ideas: No notes folder\. Pass it: \/dybs-ideas <folder>/);
  r = run(['new', project, '--folder', join(root, 'nope'), '--json']);
  assert.equal(r.code, 2);
  assert.match(r.json.error, /does not exist/);
  rmSync(root, { recursive: true });
});

test('a broken ledger is reported and never overwritten', () => {
  const { root, project, folder } = setup({ 'call.txt': CALL });
  writeFileSync(join(project, LEDGER), '{ not json');
  for (const args of [['new', project, '--folder', folder], ['mark', project, 'call.txt', '--folder', folder]]) {
    const r = run(args);
    assert.equal(r.code, 2);
    assert.match(r.text, /not valid JSON/);
  }
  assert.equal(readFileSync(join(project, LEDGER), 'utf8'), '{ not json');
  rmSync(root, { recursive: true });
});

test('new names the project prompt when there is one', () => {
  const { root, project, folder } = setup({ 'call.txt': CALL });
  writeFileSync(join(project, 'dybs/transcript-prompt.txt'), 'Look for billing problems.');
  assert.equal(run(['new', project, '--folder', folder, '--json']).json.prompt, 'dybs/transcript-prompt.txt');
  rmSync(root, { recursive: true });
});

test('verify passes a quote that is in its source, across wrapped lines and curly quotes', () => {
  const { root, project, folder } = setup({ 'call.txt': CALL });
  run(['mark', project, 'call.txt', '--folder', folder]);
  writeFileSync(join(project, 'dybs/ideas/reminder-language.md'), idea([
    `- "Most of our clients read Turkish, and the reminder is always in Dutch." (Anna, 2026-11-20 no time, \`${C}\`, need)`,
    `- "always in Dutch. Bert: So they ignore it?" (unknown speaker, date unknown no time, \`${C}\`, need)`,
  ]));
  writeFileSync(join(folder, 'curly.txt'), CURLY);
  run(['mark', project, 'curly.txt']);
  writeFileSync(join(project, 'dybs/ideas/second.md'), idea([`- "It's the "second" reminder." (Kim, 2026-11-21 no time, \`curly.txt@${ref(CURLY)}\`, asked)`]));
  const r = run(['verify', project, '--json']);
  assert.deepEqual(r.json.problems, []);
  assert.equal(r.json.checked, 3);
  assert.equal(r.code, 0);
  rmSync(root, { recursive: true });
});

test('verify fails an invented or reworded quote', () => {
  const { root, project, folder } = setup({ 'call.txt': CALL });
  run(['mark', project, 'call.txt', '--folder', folder]);
  writeFileSync(join(project, 'dybs/ideas/x.md'), idea([
    `- "Most of our clients read Turkish and the reminder is always in Dutch." (Anna, 2026-11-20 no time, \`${C}\`, need)`,
    `- "most of our clients read Turkish" (Anna, 2026-11-20 no time, \`${C}\`, need)`,
    `- "Most of our clients ... in Dutch." (Anna, 2026-11-20 no time, \`${C}\`, need)`,
  ]));
  const r = run(['verify', project, '--json']);
  assert.equal(r.code, 1);
  assert.deepEqual(r.json.problems.map((p) => p.problem), ['quote not in source', 'quote not in source', 'quote not in source']);
  rmSync(root, { recursive: true });
});

test('verify fails a malformed line, a duplicate and a source that was never read', () => {
  const { root, project, folder } = setup({ 'call.txt': CALL });
  run(['mark', project, 'call.txt', '--folder', folder]);
  const good = `- "the reminder is always in Dutch." (Anna, 2026-11-20 no time, \`${C}\`, need)`;
  writeFileSync(join(project, 'dybs/ideas/x.md'), idea([
    good, good,
    `- "the reminder" (Anna, 20 November, \`${C}\`, need)`,
    `- "the reminder" (Anna, 2026-11-20 no time, \`${C}\`)`,
    `- "Clients want Turkish." (Anna, 2026-11-20 no time, \`invented.txt@0123456789ab\`, asked)`,
  ]));
  const r = run(['verify', project, '--json']);
  assert.equal(r.code, 1);
  assert.deepEqual(r.json.problems.map((p) => p.problem), ['duplicate of x.md', 'malformed', 'malformed', 'unknown source']);
  rmSync(root, { recursive: true });
});

test('verify does not fail a mention whose read source was removed later', () => {
  const { root, project, folder } = setup({ 'call.txt': CALL });
  run(['mark', project, 'call.txt', '--folder', folder]);
  writeFileSync(join(project, 'dybs/ideas/x.md'), idea([`- "the reminder is always in Dutch." (Anna, 2026-11-20 no time, \`${C}\`, need)`]));
  rmSync(join(folder, 'call.txt'));
  const r = run(['verify', project, '--json']);
  assert.equal(r.code, 0);
  assert.equal(r.json.unchecked, 1);
  rmSync(root, { recursive: true });
});

test('verify ignores ideas without mentions and the template comment', () => {
  const { root, project, folder } = setup({});
  writeFileSync(join(project, 'dybs/ideas/plain.md'), '---\nidea: plain\nstatus: grilled\n---\n\n# Plain\n\n## Idea\n\n> said once\n');
  writeFileSync(join(project, 'dybs/ideas/fresh.md'), readFileSync(join(SKILLS_SRC, 'dybs-ideas/template.md'), 'utf8'));
  const r = run(['verify', project, '--folder', folder, '--json']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.json.problems, []);
  rmSync(root, { recursive: true });
});

test('a re-exported note never fails the evidence already taken from it', () => {
  const { root, project, folder } = setup({ 'call.txt': CALL });
  run(['mark', project, 'call.txt', '--folder', folder]);
  writeFileSync(join(project, 'dybs/ideas/accepted.md'), idea([`- "the reminder is always in Dutch." (Anna, 2026-11-20 no time, \`${C}\`, need)`]).replace('status: captured', 'status: accepted'));
  // The meeting tool exports the same call again with one word changed.
  writeFileSync(join(folder, 'call.txt'), CALL.replace('always', 'mostly'));
  const r = run(['verify', project, '--json']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.json.problems, []);
  assert.equal(r.json.unchecked, 1);
  rmSync(root, { recursive: true });
});

test('a renamed note is still checked, by its content', () => {
  const { root, project, folder } = setup({ 'call.txt': CALL });
  run(['mark', project, 'call.txt', '--folder', folder]);
  renameSync(join(folder, 'call.txt'), join(folder, 'renamed.txt'));
  writeFileSync(join(folder, 'call.txt'), 'Another meeting entirely.');
  writeFileSync(join(project, 'dybs/ideas/x.md'), idea([`- "the reminder is always in Dutch." (Anna, 2026-11-20 no time, \`${C}\`, need)`]));
  let r = run(['verify', project, '--json']);
  assert.equal(r.code, 0);
  assert.equal(r.json.checked, 1);
  writeFileSync(join(project, 'dybs/ideas/x.md'), idea([`- "Most of our clients read Dutch." (Anna, 2026-11-20 no time, \`${C}\`, need)`]));
  r = run(['verify', project, '--json']);
  assert.deepEqual(r.json.problems.map((p) => p.problem), ['quote not in source']);
  rmSync(root, { recursive: true });
});

test('the same quote from the same note in two ideas is a duplicate', () => {
  const { root, project, folder } = setup({ 'call.txt': CALL });
  run(['mark', project, 'call.txt', '--folder', folder]);
  const line = `- "the reminder is always in Dutch." (Anna, 2026-11-20 no time, \`${C}\`, need)`;
  writeFileSync(join(project, 'dybs/ideas/a.md'), idea([line]));
  writeFileSync(join(project, 'dybs/ideas/b.md'), idea([line]));
  const r = run(['verify', project, '--json']);
  assert.equal(r.code, 1);
  assert.deepEqual(r.json.problems.map((p) => [p.idea, p.problem]), [['b.md', 'duplicate of a.md']]);
  rmSync(root, { recursive: true });
});

test('a quote of one or two words proves nothing', () => {
  const { root, project, folder } = setup({ 'call.txt': CALL });
  run(['mark', project, 'call.txt', '--folder', folder]);
  writeFileSync(join(project, 'dybs/ideas/x.md'), idea([`- "in Dutch." (Anna, 2026-11-20 no time, \`${C}\`, need)`]));
  assert.deepEqual(run(['verify', project, '--json']).json.problems.map((p) => p.problem), ['too short']);
  rmSync(root, { recursive: true });
});

test('the folder is remembered on this device only, from the first run', () => {
  const { root, project, folder } = setup({});
  assert.equal(run(['new', project, '--folder', folder, '--json']).code, 0);
  assert.equal(readFileSync(join(project, FOLDER), 'utf8').trim(), folder);
  assert.match(readFileSync(join(project, 'dybs/ideas/.gitignore'), 'utf8'), /^\.folder$/m);
  assert.equal(run(['new', project, '--json']).json.folder, folder);
  writeFileSync(join(folder, 'call.txt'), CALL);
  run(['mark', project, 'call.txt']);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(project, LEDGER), 'utf8'))), ['version', 'read']);
  // An existing .gitignore keeps its lines and gets .folder once.
  writeFileSync(join(project, 'dybs/ideas/.gitignore'), 'drafts/');
  run(['new', project, '--folder', folder]);
  run(['new', project, '--folder', folder]);
  assert.equal(readFileSync(join(project, 'dybs/ideas/.gitignore'), 'utf8'), 'drafts/\n.folder\n.run.json\n.skip\n');
  rmSync(root, { recursive: true });
});

test('a notes folder reached through a link is read', () => {
  const { root, project, folder } = setup({ 'call.txt': CALL });
  symlinkSync(folder, join(root, 'linked'));
  const r = run(['new', project, '--folder', join(root, 'linked'), '--json']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.json.new.map((n) => n.name), ['call.txt']);
  rmSync(root, { recursive: true });
});

test('a note that cannot be read is listed, and the run goes on', { skip: process.getuid?.() === 0 && 'root reads everything' }, () => {
  const { root, project, folder } = setup({ 'call.txt': CALL, 'locked.txt': 'secret' });
  chmodSync(join(folder, 'locked.txt'), 0o000);
  const r = run(['new', project, '--folder', folder, '--json']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.json.unreadable, ['locked.txt']);
  assert.deepEqual(r.json.new.map((n) => n.name), ['call.txt']);
  assert.match(r.json.new[0].ref, /^call\.txt@[0-9a-f]{12}$/);
  chmodSync(join(folder, 'locked.txt'), 0o600);
  rmSync(root, { recursive: true });
});

test('a subtitle line that is only a number is speech, not a cue number', () => {
  const srt = '1\n00:00:01,000 --> 00:00:03,000\nWe need\n2\nreminders per customer.\n\n2\n00:00:03,000 --> 00:00:05,000\n3\n';
  assert.equal(fold(srt, 'a.srt'), 'We need 2 reminders per customer. 3');
  const vtt = 'WEBVTT\n\nintro\n00:00:01.000 --> 00:00:03.000\nWe need\n2\nreminders.\n\n00:00:03.000 --> 00:00:05.000\n42\n';
  assert.equal(fold(vtt, 'a.vtt'), 'We need 2 reminders. 42');
});

test('Markdown quote marks and WebVTT note blocks do not break a quote', () => {
  assert.equal(fold('> Anna: the reminder is\n> always in Dutch.', 'a.md'), 'Anna: the reminder is always in Dutch.');
  const vtt = 'WEBVTT\n\nNOTE exported by a tool\nsecond line of the note\n\n00:00:01.000 --> 00:00:03.000\nthe reminder is always in Dutch.\n';
  assert.equal(fold(vtt, 'a.vtt'), 'the reminder is always in Dutch.');
});

test('the same quote from a re-exported note is still a duplicate', () => {
  const { root, project, folder } = setup({ 'call.txt': CALL });
  run(['mark', project, 'call.txt', '--folder', folder]);
  const again = CALL + 'Anna: One more thing.\n';
  writeFileSync(join(folder, 'call.txt'), again);
  writeFileSync(join(project, 'dybs/ideas/x.md'), idea([
    `- "the reminder is always in Dutch." (Anna, 2026-11-20 no time, \`${C}\`, need)`,
    `- "the reminder is always in Dutch." (Anna, 2026-11-20 no time, \`call.txt@${ref(again)}\`, need)`,
  ]));
  const r = run(['verify', project, '--json']);
  assert.equal(r.code, 1);
  assert.deepEqual(r.json.problems.map((p) => p.problem), ['duplicate of x.md']);
  rmSync(root, { recursive: true });
});

test('problems in mentions from before this run are listed and never block it', () => {
  const { root, project, folder } = setup({ 'call.txt': CALL });
  // An earlier run's note, gone from the folder, a hand-edited line, and a
  // ledger moved aside: nobody can fix these now.
  writeFileSync(join(project, 'dybs/ideas/old.md'), idea(['- "a quote from a meeting long ago" (Kim, 2026-01-02 no time, `old.txt@aaaaaaaaaaaa`, need)', '- hand-edited line']));
  run(['new', project, '--folder', folder]);
  writeFileSync(join(project, 'dybs/ideas/x.md'), idea([`- "the reminder is always in Dutch." (Anna, 2026-11-20 no time, \`${C}\`, need)`]));
  let r = run(['verify', project, '--json']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.json.earlier.map((p) => p.problem), ['unknown source', 'malformed']);
  // Every line this run adds is checked strictly, whatever it claims.
  for (const bad of [
    '- "Clients want Turkish reminders." (Anna, 2026-11-20 no time, `made-up.txt@abcdefabcdef`, asked)',
    `- "the reminder is never in Dutch." (Anna, 2026-11-20 no time, \`${C}\`, need)`,
    '- a line without a ref',
  ]) {
    writeFileSync(join(project, 'dybs/ideas/x.md'), idea([bad]));
    r = run(['verify', project, '--json']);
    assert.equal(r.code, 1, bad);
    assert.equal(r.json.problems.length, 1, bad);
  }
  // mark ends the run: without a snapshot, every problem fails again.
  run(['mark', project, 'call.txt']);
  assert.ok(!existsSync(join(project, 'dybs/ideas/.run.json')));
  assert.equal(run(['verify', project, '--json']).json.problems.length, 3);
  assert.equal(run(['verify', project, 'call.txt']).code, 2);
  rmSync(root, { recursive: true });
});

test('a duplicate is reported on the line this run added, never on the evidence', () => {
  const { root, project, folder } = setup({ 'call.txt': CALL });
  const line = `- "the reminder is always in Dutch." (Anna, 2026-11-20 no time, \`${C}\`, need)`;
  writeFileSync(join(project, 'dybs/ideas/z-old.md'), idea([line]));
  run(['new', project, '--folder', folder]);
  writeFileSync(join(project, 'dybs/ideas/a-new.md'), idea([line]));
  const r = run(['verify', project, '--json']);
  assert.equal(r.code, 1);
  assert.deepEqual(r.json.problems.map((p) => [p.idea, p.problem]), [['a-new.md', 'duplicate of z-old.md']]);
  rmSync(root, { recursive: true });
});

test('a second new in the same run keeps the first snapshot', () => {
  const { root, project, folder } = setup({ 'call.txt': CALL });
  run(['new', project, '--folder', folder]);
  writeFileSync(join(project, 'dybs/ideas/x.md'), idea(['- "Clients want Turkish reminders." (Anna, 2026-11-20 no time, `made-up.txt@abcdefabcdef`, asked)']));
  run(['new', project]);
  assert.equal(run(['verify', project]).code, 1);
  rmSync(root, { recursive: true });
});

test('the folder is never written through a .gitignore that is a link or a folder', () => {
  const { root, project, folder } = setup({});
  const outside = join(root, 'outside.txt');
  symlinkSync(outside, join(project, 'dybs/ideas/.gitignore'));
  let r = run(['new', project, '--folder', folder]);
  assert.equal(r.code, 2);
  assert.match(r.text, /\.gitignore is not a plain file, so nothing was written\. Remove it or make it a plain file/);
  assert.ok(!existsSync(outside));
  assert.ok(!existsSync(join(project, FOLDER)));
  rmSync(join(project, 'dybs/ideas/.gitignore'));
  mkdirSync(join(project, 'dybs/ideas/.gitignore'));
  r = run(['new', project, '--folder', folder]);
  assert.equal(r.code, 2);
  rmSync(root, { recursive: true });
});

test('a skipped note is never read or marked, and unskipping makes it eligible again', () => {
  const { root, project, folder } = setup({ 'call.txt': CALL, 'private.txt': 'Personal talk.', 'later.md': 'notes' });
  run(['new', project, '--folder', folder]);
  // Never opened: a skipped note that cannot be read changes nothing.
  if (process.getuid?.() !== 0) chmodSync(join(folder, 'private.txt'), 0o000);
  writeFileSync(join(project, SKIP), 'private.txt\n\n  later.md  \n');
  assert.match(readFileSync(join(project, 'dybs/ideas/.gitignore'), 'utf8'), /^\.skip$/m);
  let r = run(['new', project, '--json']);
  assert.deepEqual(r.json.new.map((n) => n.name), ['call.txt']);
  assert.deepEqual(r.json.skipped, ['later.md', 'private.txt']);
  assert.deepEqual(r.json.unreadable, []);
  // A skipped note is not marked, even when asked.
  r = run(['mark', project, 'call.txt', 'private.txt', '--json']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.json.marked, ['call.txt']);
  assert.deepEqual(r.json.skipped, ['private.txt']);
  assert.deepEqual(JSON.parse(readFileSync(join(project, LEDGER), 'utf8')).read.map((n) => n.name), ['call.txt']);
  // A note added to the folder later is read by default.
  writeFileSync(join(folder, 'next.vtt'), 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhello there everyone\n');
  assert.deepEqual(run(['new', project, '--json']).json.new.map((n) => n.name), ['next.vtt']);
  chmodSync(join(folder, 'private.txt'), 0o600);
  writeFileSync(join(project, SKIP), 'later.md\n');
  assert.deepEqual(run(['new', project, '--json']).json.new.map((n) => n.name), ['next.vtt', 'private.txt']);
  rmSync(root, { recursive: true });
});

test('a run with nothing to read leaves no record behind for the next run', () => {
  const { root, project, folder } = setup({ 'call.txt': CALL });
  run(['mark', project, 'call.txt', '--folder', folder]);
  // A scheduled run finds nothing new and ends without mark.
  assert.deepEqual(run(['new', project, '--json']).json.new, []);
  assert.ok(!existsSync(join(project, 'dybs/ideas/.run.json')));
  // A person adds a line by hand; the next run must not hold it to this run.
  writeFileSync(join(project, 'dybs/ideas/old.md'), idea(['- "a quote from a meeting long ago" (Kim, 2026-01-02 no time, `old.txt@aaaaaaaaaaaa`, need)']));
  writeFileSync(join(folder, 'next.txt'), 'Bert: we should text the clients instead of mailing them.\n');
  run(['new', project]);
  const r = run(['verify', project, '--json']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.json.earlier.map((p) => p.problem), ['unknown source']);
  rmSync(root, { recursive: true });
});

test('verify never opens a skipped note and never accepts a quote from it', () => {
  const { root, project, folder } = setup({ 'call.txt': CALL, 'private.txt': 'Kim: the secret plan is to raise prices.\n' });
  run(['new', project, '--folder', folder]);
  writeFileSync(join(project, SKIP), 'private.txt\n');
  writeFileSync(join(project, 'dybs/ideas/x.md'), idea([`- "the secret plan is to raise prices." (Kim, 2026-11-20 no time, \`private.txt@${ref('Kim: the secret plan is to raise prices.\n')}\`, need)`]));
  const r = run(['verify', project, '--json']);
  assert.equal(r.code, 1);
  assert.equal(r.json.checked, 0);
  assert.deepEqual(r.json.problems.map((p) => p.problem), ['source skipped or gone']);
  rmSync(root, { recursive: true });
});

test('a second copy of a line already in the same idea is new, and fails', () => {
  const { root, project, folder } = setup({ 'call.txt': CALL });
  const line = `- "the reminder is always in Dutch." (Anna, 2026-11-20 no time, \`${C}\`, need)`;
  writeFileSync(join(project, 'dybs/ideas/x.md'), idea([line]));
  run(['new', project, '--folder', folder]);
  writeFileSync(join(project, 'dybs/ideas/x.md'), idea([line, line]));
  const r = run(['verify', project, '--json']);
  assert.equal(r.code, 1);
  assert.deepEqual(r.json.problems.map((p) => p.problem), ['duplicate of x.md']);
  rmSync(root, { recursive: true });
});

test('SRT cues without blank lines between them still lose their numbers and timings', () => {
  const srt = '1\n00:00:01,000 --> 00:00:02,000\nhello there\n2\n00:00:02,000 --> 00:00:03,000\nfriend\n';
  assert.equal(fold(srt, 'a.srt'), 'hello there friend');
});

test('the skip list ignores case, and mark says which notes it skipped', () => {
  const { root, project, folder } = setup({ 'call.txt': CALL, 'Private.TXT': 'x y z' });
  run(['new', project, '--folder', folder]);
  writeFileSync(join(project, SKIP), 'private.txt\n');
  assert.deepEqual(run(['new', project, '--json']).json.skipped, ['Private.TXT']);
  assert.match(run(['mark', project, 'call.txt', 'Private.TXT']).text, /Marked as read: 1, skipped: Private\.TXT/);
  rmSync(root, { recursive: true });
});

test('a spoken line with an arrow in it is speech, not a timing line', () => {
  const srt = '1\n00:00:01,000 --> 00:00:03,000\nthe flow goes A --> B every time\n';
  assert.equal(fold(srt, 'a.srt'), 'the flow goes A --> B every time');
});

test('a quote from a note read before and now skipped never passes', () => {
  const { root, project, folder } = setup({ 'call.txt': CALL, 'private.txt': 'Kim: the plan is to raise prices next year.\n' });
  run(['mark', project, 'call.txt', 'private.txt', '--folder', folder]);
  writeFileSync(join(project, SKIP), 'private.txt\n');
  writeFileSync(join(folder, 'next.txt'), 'Bert: we should text the clients instead of mailing them.\n');
  run(['new', project]);
  writeFileSync(join(project, 'dybs/ideas/x.md'), idea([`- "the plan is to lower prices next year." (Kim, 2026-11-20 no time, \`private.txt@${ref('Kim: the plan is to raise prices next year.\n')}\`, need)`]));
  const r = run(['verify', project, '--json']);
  assert.equal(r.code, 1);
  assert.equal(r.json.unchecked, 0);
  assert.deepEqual(r.json.problems.map((p) => p.problem), ['not a note of this run']);
  rmSync(root, { recursive: true });
});

test('a stopped run keeps its record while a line it added never passed verify', () => {
  const { root, project, folder } = setup({ 'call.txt': CALL });
  run(['new', project, '--folder', folder]);
  // The run writes a mention and stops before verify; then its note is skipped.
  writeFileSync(join(project, 'dybs/ideas/x.md'), idea(['- "Clients want Turkish reminders." (Anna, 2026-11-20 no time, `made-up.txt@abcdefabcdef`, asked)']));
  writeFileSync(join(project, SKIP), 'call.txt\n');
  run(['new', project]);
  assert.ok(existsSync(join(project, 'dybs/ideas/.run.json')));
  writeFileSync(join(folder, 'next.txt'), 'Bert: we should text the clients instead of mailing them.\n');
  run(['new', project]);
  assert.equal(run(['verify', project]).code, 1);
  rmSync(root, { recursive: true });
});

test('a run record of an older version is ignored, so every problem fails', () => {
  const { root, project, folder } = setup({ 'call.txt': CALL });
  writeFileSync(join(project, 'dybs/ideas/old.md'), idea(['- "a quote from a meeting long ago" (Kim, 2026-01-02 no time, `old.txt@aaaaaaaaaaaa`, need)']));
  run(['new', project, '--folder', folder]);
  const rec = JSON.parse(readFileSync(join(project, 'dybs/ideas/.run.json'), 'utf8'));
  assert.equal(rec.version, 2);
  writeFileSync(join(project, 'dybs/ideas/.run.json'), JSON.stringify({ version: 1, lines: rec.lines }));
  assert.deepEqual(run(['verify', project, '--json']).json.problems.map((p) => p.problem), ['unknown source']);
  rmSync(root, { recursive: true });
});

const TIMED = '[09:58:02] Anna: Morning all.\n\n[10:03:41] Anna: Most of our clients read Turkish, and the reminder\nis always in Dutch.\n\n[10:04:10] Bert: So they ignore it?\n';
const T = `call.txt@${ref(TIMED)}`;

test('a mention carries the time its quote starts at, and a wrong or missing one fails', () => {
  const { root, project, folder } = setup({ 'call.txt': TIMED, 'plain.txt': CALL });
  run(['new', project, '--folder', folder]);
  const P = `plain.txt@${ref(CALL)}`;
  const check = (lines) => {
    writeFileSync(join(project, 'dybs/ideas/x.md'), idea(lines));
    return run(['verify', project, '--json']).json.problems.map((p) => p.problem);
  };
  assert.deepEqual(check([
    `- "the reminder is always in Dutch." (Anna, 2026-11-20 10:03, \`${T}\`, need)`,
    `- "always in Dutch. Bert: So they ignore it?" (Bert, 2026-11-20 10:03, \`${T}\`, need)`,
    `- "Most of our clients read Turkish" (Anna, 2026-11-20 no time, \`${P}\`, need)`,
  ]), []);
  assert.deepEqual(check([`- "the reminder is always in Dutch." (Anna, 2026-11-20 10:04, \`${T}\`, need)`]), ['wrong time']);
  assert.deepEqual(check([`- "the reminder is always in Dutch." (Anna, 2026-11-20 no time, \`${T}\`, need)`]), ['time missing']);
  assert.deepEqual(check([`- "Most of our clients read Turkish" (Anna, 2026-11-20 10:03, \`${P}\`, need)`]), ['time not in note']);
  assert.deepEqual(check([`- "the reminder is always in Dutch." (Anna, 2026-11-20, \`${T}\`, need)`]), ['malformed']);
  rmSync(root, { recursive: true });
});

test('subtitle cues give their start time; text timestamps are not part of the text', () => {
  const srt = '1\n01:02:03,000 --> 01:02:05,000\nWe need\n2\nreminders.\n';
  assert.deepEqual(segments(srt, 'a.srt'), [{ time: '01:02', text: 'We need 2 reminders.' }]);
  const vtt = 'WEBVTT\n\n00:07.000 --> 00:09.000 align:start\nhello there\n';
  assert.deepEqual(segments(vtt, 'a.vtt'), [{ time: '00:00', text: 'hello there' }]);
  assert.equal(fold('(09:01:02) Kim: we meet at 10:30 today', 'a.txt'), 'Kim: we meet at 10:30 today');
});

test('a long note is read in parts, and is marked only when every part was read', () => {
  // Generic filler, then the only idea in the last part of the note.
  const filler = Array.from({ length: 70 }, (_, i) => `[10:${String(i % 60).padStart(2, '0')}:00] Speaker ${i % 3}: ${'we went through the agenda and the open points again. '.repeat(20)}`);
  const last = '[11:15:00] Kim: I keep copying every invoice into a spreadsheet by hand before I can send it.';
  const long = filler.join('\n') + '\n' + last + '\n';
  assert.ok(long.length > 3 * PART_CHARS);
  const { root, project, folder } = setup({ 'long.txt': long });
  const n = run(['new', project, '--folder', folder, '--json']).json.new[0];
  assert.ok(n.parts.length >= 3);
  const end = n.parts[n.parts.length - 1];
  assert.equal(end.lines[1], long.split('\n').length);
  assert.equal(end.to, '11:15');
  assert.deepEqual(parts(long, 'long.txt'), n.parts);
  // The quote from the last part verifies with its own time.
  writeFileSync(join(project, 'dybs/ideas/invoice-copying.md'), idea([`- "I keep copying every invoice into a spreadsheet by hand" (Kim, 2026-11-20 11:15, \`${n.ref}\`, need)`]));
  assert.equal(run(['verify', project]).code, 0);
  // Marking waits for every part.
  const all = n.parts.map((p) => String(p.part));
  let r = run(['part', project, n.ref, ...all.slice(0, -1)]);
  assert.equal(r.code, 0);
  r = run(['mark', project, n.mark]);
  assert.equal(r.code, 2);
  assert.match(r.text, new RegExp(`part ${n.parts.length} of ${n.parts.length} not read`));
  assert.equal(run(['part', project, n.ref, String(n.parts.length + 1)]).code, 2);
  run(['part', project, n.ref, all[all.length - 1]]);
  assert.equal(run(['mark', project, n.mark]).code, 0);
  const entry = JSON.parse(readFileSync(join(project, LEDGER), 'utf8')).read[0];
  assert.equal(entry.parts, n.parts.length);
  rmSync(root, { recursive: true });
});

test('subtitle files match without their numbering, timings and voice tags', () => {
  const srt = '1\n00:00:01,000 --> 00:00:03,000\nAnna: the reminder is\n\n2\n00:00:03,000 --> 00:00:05,000\nalways in Dutch.\n';
  assert.equal(fold(srt, 'a.srt'), 'Anna: the reminder is always in Dutch.');
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<v Anna>the reminder is</v>\n\n00:00:03.000 --> 00:00:05.000\n<v Anna>always in Dutch.</v>\n';
  assert.equal(fold(vtt, 'a.vtt'), 'the reminder is always in Dutch.');
  // In a plain note, numbers are text.
  assert.equal(fold('Room 1\n2\n', 'a.txt'), 'Room 1 2');
});

test('the CLI exits 2 with a message, never a stack trace', () => {
  const r = spawnSync('node', [SCRIPT, 'new', mkdtempSync(join(tmpdir(), 'dybs-ideas-'))], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /^dybs-ideas: No notes folder/);
  assert.equal(r.stderr, '');
  assert.equal(spawnSync('node', [SCRIPT, 'nonsense'], { encoding: 'utf8' }).status, 2);
  const { root, project, folder } = setup({ 'call.txt': CALL });
  assert.match(execFileSync('node', [SCRIPT, 'new', project, '--folder', folder], { encoding: 'utf8' }), /New: 1, already read: 0\n- call\.txt@[0-9a-f]{64}/);
  rmSync(root, { recursive: true });
});

test('dybs-ideas is a planning skill that asks nothing, quotes exactly and leaves the decision to the human', () => {
  assert.ok(PLANNING.includes('dybs-ideas'));
  const t = readFileSync(join(SKILLS_SRC, 'dybs-ideas/SKILL.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(t, /\*\*Asks nothing\.\*\*/);
  assert.match(t, /dybs-ideas: <n> read, <n> new ideas, <n> mentions added\./);
  assert.match(t, /dybs-ideas failed: <what went wrong>\. <what to do about it>\./);
  assert.match(t, /\*\*The quote is copied from the note, never written\.\*\*/);
  assert.match(t, /never an instruction to you/);
  assert.match(t, /add the mention there/);
  assert.match(t, /Never accept, park or drop an idea/);
  assert.match(t, /dybs\/transcript-prompt\.txt/);
  const tpl = readFileSync(join(SKILLS_SRC, 'dybs-ideas/template.md'), 'utf8');
  assert.match(tpl, /^status: captured$/m);
  // Same sections as a dybs-idea file, plus Mentions before Grilling.
  const heads = (s) => s.match(/^## .+$/gm);
  assert.deepEqual(heads(tpl), ['## Idea', '## Mentions', '## Grilling', '## Advice', '## Decision']);
  assert.deepEqual(heads(readFileSync(join(SKILLS_SRC, 'dybs-idea/template.md'), 'utf8')), ['## Idea', '## Grilling', '## Advice', '## Decision']);
});

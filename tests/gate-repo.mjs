// A gate only decides on committed evidence in a git repository. This
// commits `files` (path -> content) in a fresh repository, writes `text` as
// dybs/work/<task>/gate.md with `commit:` set to that commit (replacing one
// already there), and returns where it is.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

export function committedGate(text, files = { 'tests/a.test.js': 'test\n'.repeat(60) }, task = 't') {
  const repo = mkdtempSync(join(tmpdir(), 'dybs-gate-git-'));
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
  g('init', '-q'); g('config', 'user.email', 't@example.com'); g('config', 'user.name', 'T');
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(repo, p)), { recursive: true }); writeFileSync(join(repo, p), c); }
  mkdirSync(join(repo, 'dybs/work', task), { recursive: true });
  g('add', '.'); g('commit', '-qm', 'code');
  const head = g('rev-parse', '--short=7', 'HEAD');
  const gatePath = join(repo, 'dybs/work', task, 'gate.md');
  const body = /^---\n[\s\S]*?^commit:/m.test(text) ? text.replace(/^commit:.*$/m, `commit: ${head}`) : text.replace(/^---\n/, `---\ncommit: ${head}\n`);
  writeFileSync(gatePath, body);
  return { repo, gatePath };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { probe, report, parseRemote, onPath } from '../skills/dybs-start/scripts/dybs-probe.mjs';
import { SKILLS_SRC } from '../src/update.mjs';

const SCRIPT = join(SKILLS_SRC, 'dybs-start/scripts/dybs-probe.mjs');
// A PATH holding only git, so what the probe finds does not depend on this machine.
const gitOnly = () => {
  const bin = mkdtempSync(join(tmpdir(), 'dybs-bin-'));
  const git = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  writeFileSync(join(bin, 'git'), `#!/bin/sh\nexec ${git} "$@"\n`);
  chmodSync(join(bin, 'git'), 0o755);
  return { PATH: bin };
};
const repo = (files = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'dybs-probe-'));
  for (const [f, c] of Object.entries(files)) { mkdirSync(join(root, f, '..'), { recursive: true }); writeFileSync(join(root, f), c); }
  return root;
};
const git = (root, ...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' });

test('a remote is read in both URL forms, and only github.com counts as GitHub', () => {
  assert.deepEqual(parseRemote('git@github.com:Dybs-it/skills.git'), { host: 'github.com', repo: 'Dybs-it/skills' });
  assert.deepEqual(parseRemote('https://github.com/Dybs-it/skills'), { host: 'github.com', repo: 'Dybs-it/skills' });
  assert.deepEqual(parseRemote('https://user@gitlab.example.com/group/sub/app.git'), { host: 'gitlab.example.com', repo: 'group/sub/app' });
  assert.equal(parseRemote(''), null);
  const root = repo({ 'README.md': '# x' });
  git(root, 'init', '-q'); git(root, 'remote', 'add', 'origin', 'https://github.example.org/a/b.git');
  const p = probe(root, gitOnly());
  assert.equal(p.git.repository, true);
  assert.equal(p.git.github, false);
  assert.equal(p.git.repo, 'a/b');
});

test('an empty folder is greenfield, with nothing claimed', () => {
  const p = probe(repo(), gitOnly());
  assert.equal(p.kind, 'greenfield');
  assert.equal(p.git.repository, false);
  assert.deepEqual([p.languages, p.testing.tools, p.ci, p.agents, p.design.tokens], [[], [], [], [], []]);
  assert.equal(p.gh.installed, false);
  assert.equal(p.gh.signedIn, null);
  assert.equal(p.runtime.herdr, false);
});

test('test tools, commands, CI, tokens and a style guide are found from the files', () => {
  const root = repo({
    'package.json': JSON.stringify({ scripts: { test: 'vitest run', lint: 'eslint .', start: 'node .' }, devDependencies: { vitest: '1', eslint: '9', '@playwright/test': '1' }, dependencies: { tailwindcss: '4' } }),
    '.github/workflows/ci.yml': 'on: push',
    'styles/jk-tokens.css': ':root{}',
    'docs/styleguide.md': '# Style',
    'src/a.test.js': '',
    'node_modules/vitest/x.test.js': '',
    '.opencode/commands/design-system.md': 'an agent command, not the product',
  });
  const p = probe(root, gitOnly());
  assert.equal(p.kind, 'existing');
  assert.deepEqual(p.testing.tools, ['vitest', '@playwright/test']);
  assert.deepEqual(Object.keys(p.testing.commands), ['npm run test', 'npm run lint']);
  assert.deepEqual(p.testing.lint, ['eslint']);
  assert.equal(p.testing.testFiles, 1);
  assert.deepEqual(p.ci, ['.github/workflows/ci.yml']);
  assert.deepEqual(p.design.tokens, ['styles/jk-tokens.css']);
  assert.deepEqual(p.design.styleGuide, ['docs/styleguide.md']);
  assert.deepEqual(p.design.libraries, ['tailwindcss']);
});

test('agents, gh and Herdr are found on PATH without being run', () => {
  const env = gitOnly();
  for (const b of ['claude', 'herdr']) { writeFileSync(join(env.PATH, b), '#!/bin/sh\necho ran > "$0.ran"\n'); chmodSync(join(env.PATH, b), 0o755); }
  const p = probe(repo(), env);
  assert.deepEqual(p.agents, ['Claude Code']);
  assert.equal(p.runtime.herdr, true);
  assert.equal(onPath('codex', env), false);
  assert.deepEqual(readdirSync(env.PATH).filter((f) => f.endsWith('.ran')), []);
});

test('the probe changes nothing in the project', () => {
  const root = repo({ 'package.json': '{}', 'src/a.js': 'x' });
  git(root, 'init', '-q');
  const before = statSync(join(root, 'package.json')).mtimeMs;
  const r = spawnSync('node', [SCRIPT, root], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /These are facts/);
  assert.equal(git(root, 'status', '--porcelain').trim().split('\n').sort().join(), '?? package.json,?? src/');
  assert.equal(statSync(join(root, 'package.json')).mtimeMs, before);
});

test('the report says plainly when gh is missing or not signed in', () => {
  const p = probe(repo(), gitOnly());
  assert.match(report(p), /- gh CLI: not installed/);
  assert.match(report({ ...p, gh: { installed: true, signedIn: false } }), /not signed in \(`gh auth login`\)/);
  assert.match(report({ ...p, gh: { installed: true, signedIn: true } }), /installed, signed in/);
});

test('a folder that does not exist is refused', () => {
  assert.equal(spawnSync('node', [SCRIPT, '/no/such/folder'], { encoding: 'utf8' }).status, 2);
});

test('--json prints one object a launcher can read', () => {
  const out = JSON.parse(spawnSync('node', [SCRIPT, repo({ 'go.mod': 'module x' }), '--json'], { encoding: 'utf8' }).stdout);
  assert.deepEqual(out.languages, ['Go']);
  assert.equal(typeof out.gh.installed, 'boolean');
});

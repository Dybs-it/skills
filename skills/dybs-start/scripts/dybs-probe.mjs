#!/usr/bin/env node
// Looks up what can be known about a project without asking anyone, so an
// interview is spent on decisions and not on facts.
// Usage: node dybs-probe.mjs [project-root] [--json]
//
// Read-only. It lists files and reads manifests; it runs `git` to read the
// remote and the branch, and `gh auth status` to see whether gh is signed in
// (its output is not kept). It never prints a token, never changes a file,
// and never installs anything.
// Exit code 0 = reported; 2 = the folder cannot be read.

import { readFileSync, readdirSync, existsSync, statSync, lstatSync } from 'node:fs';
import { join, resolve, delimiter, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const AGENTS = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI', opencode: 'OpenCode', aider: 'Aider', 'cursor-agent': 'Cursor' };
const TEST_TOOLS = ['vitest', 'jest', 'mocha', 'ava', 'jasmine', 'cypress', '@playwright/test', 'playwright', '@testing-library/react', 'pytest', 'rspec', 'phpunit'];
const LINT_TOOLS = ['eslint', 'biome', '@biomejs/biome', 'prettier', 'ruff', 'rubocop', 'stylelint'];
const UI_TOOLS = ['tailwindcss', '@mui/material', '@chakra-ui/react', '@radix-ui/themes', 'antd', 'bootstrap', 'storybook', '@storybook/react', 'styled-components', '@shadcn/ui'];
const MANIFESTS = { 'package.json': 'JavaScript or TypeScript', 'pyproject.toml': 'Python', 'requirements.txt': 'Python', 'Cargo.toml': 'Rust', 'go.mod': 'Go', 'Gemfile': 'Ruby', 'composer.json': 'PHP', 'pom.xml': 'Java', 'build.gradle': 'Java or Kotlin', 'build.gradle.kts': 'Kotlin', 'Package.swift': 'Swift', 'pubspec.yaml': 'Dart' };
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'vendor', 'target', '.next', 'coverage', '.venv', 'venv']);

// Whether a command is on PATH. Looked up, never run.
export function onPath(cmd, env = process.env) {
  const exts = process.platform === 'win32' ? ['', ...(env.PATHEXT || '.EXE;.CMD;.BAT').split(';')] : [''];
  for (const dir of (env.PATH || '').split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      try { if (statSync(join(dir, cmd + ext)).isFile()) return true; } catch { /* next */ }
    }
  }
  return false;
}

// `owner/name` and the host from a git remote URL, in either common form.
export function parseRemote(url) {
  const u = String(url || '').trim();
  const m = u.match(/^(?:https?:\/\/|ssh:\/\/|git:\/\/)?(?:[^@/\s]+@)?([^:/\s]+)[:/](.+?)(?:\.git)?\/?$/);
  if (!m) return null;
  return { host: m[1].toLowerCase(), repo: m[2] };
}

const run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] });
  return r.error || r.status !== 0 ? null : r.stdout.trim();
};

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

// File names up to two folders deep, without build output and dependencies.
function shallowFiles(root) {
  const out = [];
  const walk = (dir, rel, depth) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      // Hidden folders hold tool and agent settings, not the product; the two
      // that say something about it are listed by name.
      const hidden = e.name.startsWith('.') && !['.github', '.storybook', '.circleci'].includes(e.name);
      if (e.isDirectory()) { if (depth < 2 && !hidden && !SKIP_DIRS.has(e.name)) walk(join(dir, e.name), r, depth + 1); } else out.push(r);
    }
  };
  walk(root, '', 0);
  return out;
}

export function probe(rootArg = '.', env = process.env) {
  const root = resolve(rootArg);
  if (!existsSync(root) || !lstatSync(root).isDirectory()) throw new Error(`not a folder: ${rootArg}`);
  const files = shallowFiles(root);
  const has = (f) => files.includes(f);

  // Source control
  const git = { repository: false, branch: null, defaultBranch: null, remote: null, host: null, repo: null, github: false };
  if (onPath('git', env) && run('git', ['rev-parse', '--is-inside-work-tree'], root) === 'true') {
    git.repository = true;
    git.branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], root);
    const head = run('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], root);
    git.defaultBranch = head ? head.replace(/^origin\//, '') : null;
    const parsed = parseRemote(run('git', ['remote', 'get-url', 'origin'], root));
    if (parsed) { git.remote = 'origin'; git.host = parsed.host; git.repo = parsed.repo; git.github = parsed.host === 'github.com'; }
  }
  const gh = { installed: onPath('gh', env), signedIn: null };
  if (gh.installed) gh.signedIn = spawnSync('gh', ['auth', 'status'], { cwd: root, timeout: 8000, stdio: 'ignore' }).status === 0;

  // Stack
  const languages = [...new Set(Object.entries(MANIFESTS).filter(([f]) => has(f)).map(([, l]) => l))];
  const pkg = has('package.json') ? readJson(join(root, 'package.json')) : null;
  const deps = pkg ? { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) } : {};
  const scripts = pkg && pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  const pick = (names) => names.filter((n) => Object.prototype.hasOwnProperty.call(deps, n));
  const pytest = files.some((f) => /(^|\/)(pytest\.ini|conftest\.py)$/.test(f)) ? ['pytest'] : [];
  const testFiles = files.filter((f) => /(\.|_)(test|spec)\.[a-z]+$/i.test(f) || /(^|\/)(tests?|__tests__|spec)\//.test(f)).length;
  const testing = {
    tools: [...new Set([...pick(TEST_TOOLS), ...pytest])],
    commands: Object.fromEntries(Object.entries(scripts).filter(([k]) => /^(test|lint|typecheck|check|build|e2e)/.test(k)).map(([k, v]) => [`npm run ${k}`, String(v).slice(0, 120)])),
    nodeTest: Object.values(scripts).some((v) => /node --test/.test(String(v))),
    testFiles,
    lint: pick(LINT_TOOLS),
  };
  const ci = files.filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f) || ['.gitlab-ci.yml', '.circleci/config.yml', 'Jenkinsfile', 'azure-pipelines.yml', 'bitbucket-pipelines.yml'].includes(f));

  // Interface
  const design = {
    libraries: pick(UI_TOOLS),
    tokens: files.filter((f) => /(^|\/)(tailwind\.config\.[cm]?[jt]s|[\w-]*tokens?\.(json|css|scss|[jt]s)|theme\.[jt]s|design-tokens\.[a-z]+|variables\.s?css)$/i.test(f)),
    styleGuide: files.filter((f) => /(style-?guide|design-?system|brand)[^/]*\.(md|mdx|pdf)$/i.test(f) || /^\.storybook\//.test(f)).map((f) => (f.startsWith('.storybook/') ? '.storybook/' : f)).filter((f, i, a) => a.indexOf(f) === i),
    stylesheets: files.filter((f) => ['.css', '.scss', '.less'].includes(extname(f))).length,
  };

  // Docs and agents
  const docs = files.filter((f) => /^(README|CONTRIBUTING|ARCHITECTURE|AGENTS|CLAUDE|SECURITY)(\.md)?$/i.test(f) || /^(docs\/)?(adr|adrs|decisions)\//i.test(f)).slice(0, 20);
  const agents = Object.entries(AGENTS).filter(([bin]) => onPath(bin, env)).map(([, name]) => name);
  const runtime = { herdr: onPath('herdr', env), tmux: onPath('tmux', env) };
  const dybs = { folder: existsSync(join(root, 'dybs')), project: existsSync(join(root, 'dybs/project.md')), working: existsSync(join(root, 'dybs/context/working.md')) };

  return { root, kind: languages.length || files.some((f) => /\.(js|ts|py|rb|go|rs|java|php|swift|kt|cs)$/.test(f)) ? 'existing' : 'greenfield', git, gh, languages, testing, ci, design, docs, agents, runtime, node: process.version, dybs };
}

const yn = (b) => (b ? 'yes' : 'no');
const list = (a) => (a.length ? a.join(', ') : 'none found');

export function report(p) {
  const l = [];
  l.push(`# What the repository shows (${p.kind})`, '');
  l.push('## Source control');
  l.push(`- Git repository: ${yn(p.git.repository)}${p.git.branch ? `, on \`${p.git.branch}\`` : ''}${p.git.defaultBranch ? `, default branch \`${p.git.defaultBranch}\`` : ''}`);
  l.push(`- Remote: ${p.git.repo ? `${p.git.host} \`${p.git.repo}\`` : 'none'}`);
  l.push(`- GitHub: ${yn(p.git.github)}`);
  l.push(`- gh CLI: ${p.gh.installed ? `installed, ${p.gh.signedIn ? 'signed in' : 'not signed in (`gh auth login`)'}` : 'not installed'}`);
  l.push('', '## Stack and tests');
  l.push(`- Languages: ${list(p.languages)}`);
  l.push(`- Test tools: ${list([...p.testing.tools, ...(p.testing.nodeTest ? ['node --test'] : [])])} (${p.testing.testFiles} test files seen)`);
  l.push(`- Lint and format: ${list(p.testing.lint)}`);
  const cmds = Object.entries(p.testing.commands);
  l.push(`- Commands: ${cmds.length ? cmds.map(([k]) => `\`${k}\``).join(', ') : 'none found'}`);
  l.push(`- CI: ${list(p.ci)}`);
  l.push('', '## Interface');
  l.push(`- UI libraries: ${list(p.design.libraries)}`);
  l.push(`- Design tokens: ${list(p.design.tokens)}`);
  l.push(`- Style guide: ${list(p.design.styleGuide)}`);
  l.push('', '## Docs, agents and runtime');
  l.push(`- Docs: ${list(p.docs)}`);
  l.push(`- Agents on this machine: ${list(p.agents)}`);
  l.push(`- Herdr: ${p.runtime.herdr ? 'installed' : 'not installed'}`);
  l.push(`- dybs/: ${p.dybs.folder ? `present${p.dybs.project ? '' : ', no project.md'}` : 'not set up'}`);
  l.push('', 'These are facts, each looked up just now. Ask about none of them; ask what the human wants.');
  return l.join('\n') + '\n';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    const p = probe(args.find((a) => !a.startsWith('--')) || '.');
    process.stdout.write(args.includes('--json') ? JSON.stringify(p) + '\n' : report(p));
  } catch (e) { console.error(e.message); process.exit(2); }
}

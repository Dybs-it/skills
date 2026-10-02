#!/usr/bin/env node
import { resolve } from 'node:path';
import {
  TARGETS, detectTargets, installTarget, uninstallTarget, status, skillNames, packageVersion,
} from '../src/install.mjs';
import { main as validateMain } from '../skills/dybs-start/scripts/dybs-validate.mjs';

const HELP = `dybs-skills ${packageVersion()}

Usage:
  npx dybs-skills install   [dir] [--tools claude,agents,opencode] [--force] [--dry-run]
  npx dybs-skills update    (same as install)
  npx dybs-skills uninstall [dir] [--tools ...] [--dry-run]
  npx dybs-skills status    [dir]
  npx dybs-skills list
  npx dybs-skills validate  [dir] [--doc <name>] [--json]

Targets:
${Object.entries(TARGETS).map(([k, t]) => `  ${k.padEnd(9)} ${t.dir.padEnd(20)} ${t.label}`).join('\n')}

Without --tools, targets are detected from the project (.claude, .agents,
AGENTS.md, .codex, .gemini, .opencode). Nothing found means claude + agents.

Files you edited after install are never overwritten or deleted. --force
replaces them, saving the old version as <file>.bak.`;

const SYMBOL = { add: '+', update: '~', replace: '!', remove: '-', conflict: '?', keep: '=' };

function parse(argv) {
  const opts = { positional: [], tools: null, force: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tools') opts.tools = (argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--tools=')) opts.tools = a.slice(8).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--force') opts.force = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else opts.positional.push(a);
  }
  return opts;
}

function report(result, dryRun) {
  const shown = result.actions.filter((a) => a.op !== 'same');
  const counts = {};
  for (const a of result.actions) counts[a.op] = (counts[a.op] || 0) + 1;
  console.log(`\n${result.dir}${dryRun ? ' (dry run)' : ''}`);
  for (const a of shown) {
    console.log(`  ${SYMBOL[a.op]} ${a.rel}${a.why ? `  (${a.why})` : ''}${a.backup ? `  backup: ${a.backup}` : ''}`);
  }
  console.log(`  ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing to do'}`);
  return result.actions.filter((a) => a.op === 'conflict').length;
}

function targetsFor(root, tools) {
  const list = tools || detectTargets(root);
  const bad = list.filter((t) => !TARGETS[t]);
  if (bad.length) throw new Error(`unknown target(s): ${bad.join(', ')}. Known: ${Object.keys(TARGETS).join(', ')}`);
  return list;
}

export function run(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { console.log(HELP); return 0; }
  if (cmd === 'validate') return validateMain(['node', 'dybs-validate', ...rest]);
  if (cmd === 'list') {
    for (const s of skillNames()) console.log(s);
    return 0;
  }

  const opts = parse(rest);
  if (opts.help) { console.log(HELP); return 0; }
  const root = resolve(opts.positional[0] || '.');

  if (cmd === 'status') {
    for (const s of status(root)) {
      console.log(`${s.target.padEnd(9)} ${s.dir.padEnd(20)} ${s.version ? `v${s.version}, ${s.files} files` : 'not installed'}`);
    }
    return 0;
  }

  if (cmd === 'install' || cmd === 'update') {
    let conflicts = 0;
    for (const t of targetsFor(root, opts.tools)) {
      conflicts += report(installTarget(root, t, opts), opts.dryRun);
    }
    if (conflicts) {
      console.log(`\n${conflicts} file(s) left untouched because you changed them. Re-run with --force to replace them (a .bak copy is kept).`);
      return 1;
    }
    if (!opts.dryRun) console.log('\nDone. In your agent, say "dybs start" to begin Getting Started.');
    return 0;
  }

  if (cmd === 'uninstall') {
    for (const t of targetsFor(root, opts.tools || Object.keys(TARGETS))) {
      report(uninstallTarget(root, t, opts), opts.dryRun);
    }
    console.log('\nYour dybs/ folder (the project context) is never touched by uninstall.');
    return 0;
  }

  console.error(`unknown command "${cmd}"\n\n${HELP}`);
  return 2;
}

try {
  process.exitCode = run(process.argv.slice(2));
} catch (err) {
  console.error(`dybs-skills: ${err.message}`);
  process.exitCode = 1;
}

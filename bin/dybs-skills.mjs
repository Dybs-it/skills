#!/usr/bin/env node
import { resolve } from 'node:path';
import {
  update, findInstalls, rootsFor, skillNames, packageVersion, INSTALL_HINT,
} from '../src/update.mjs';
import { main as validateMain } from '../skills/dybs-start/scripts/dybs-validate.mjs';

const HELP = `dybs-skills ${packageVersion()}

Install the skills with a skills package manager:
  ${INSTALL_HINT}                     all skills, 18+ agents
  ${INSTALL_HINT} --skill dybs-prd    one skill

This CLI adds what a package manager can't:
  dybs-skills validate [dir] [--doc <name>] [--json]   check a project's dybs/ context
  dybs-skills update   [dir] [--global] [--force] [--dry-run]
                       update installed Dybs skills without overwriting your edits
  dybs-skills status   [dir] [--global]                 where Dybs skills are installed
  dybs-skills list                                      skills in this package

update and status look in every .<agent>/skills/ folder of the project
(and of your home folder with --global), follow symlinks, and only touch
skills that are already installed. A file you changed is never overwritten:
--force replaces it and keeps a .bak copy.`;

const SYMBOL = { add: '+', update: '~', replace: '!', remove: '-', conflict: '?', keep: '=' };

function parse(argv) {
  const opts = { positional: [], force: false, dryRun: false, global: false };
  for (const a of argv) {
    if (a === '--force') opts.force = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--global') opts.global = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else opts.positional.push(a);
  }
  return opts;
}

export function run(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { console.log(HELP); return 0; }
  if (cmd === 'validate') return validateMain(['node', 'dybs-validate', ...rest]);
  if (cmd === 'list') { for (const s of skillNames()) console.log(s); return 0; }

  const opts = parse(rest);
  if (opts.help) { console.log(HELP); return 0; }
  const roots = rootsFor(resolve(opts.positional[0] || '.'), opts);

  if (cmd === 'status') {
    const installs = findInstalls(roots);
    if (!installs.length) { console.log(`No Dybs skills installed. Install with: ${INSTALL_HINT}`); return 0; }
    for (const i of installs) console.log(`${i.skill.padEnd(18)} ${i.dir}${i.via.length > 1 ? `  (also via ${i.via.length - 1} link)` : ''}`);
    return 0;
  }

  if (cmd === 'update') {
    const { results, notInstalled } = update(roots, opts);
    if (!results.length) { console.log(`No Dybs skills installed. Install with: ${INSTALL_HINT}`); return 0; }
    let conflicts = 0;
    for (const r of results) {
      const changed = r.actions.filter((a) => a.op !== 'same');
      console.log(`${r.skill.padEnd(18)} ${changed.length ? `${changed.length} change(s)` : 'up to date'}${opts.dryRun && changed.length ? ' (dry run)' : ''}`);
      for (const a of changed) {
        console.log(`  ${SYMBOL[a.op]} ${a.rel}${a.why ? `  (${a.why})` : ''}${a.backup ? `  backup: ${a.backup}` : ''}`);
      }
      conflicts += r.actions.filter((a) => a.op === 'conflict').length;
    }
    if (notInstalled.length) {
      console.log(`\nNot installed (left alone): ${notInstalled.join(', ')}`);
      console.log(`Add one with: ${INSTALL_HINT} --skill <name>`);
    }
    if (conflicts) {
      console.log(`\n${conflicts} file(s) left untouched because you changed them. Re-run with --force to replace them (a .bak copy is kept).`);
      return 1;
    }
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

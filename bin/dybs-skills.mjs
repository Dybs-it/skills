#!/usr/bin/env node
import { resolve } from 'node:path';
import {
  update, findInstalls, rootsFor, skillNames, packageVersion, INSTALL_HINT,
} from '../src/update.mjs';
import { main as validateMain } from '../skills/dybs-start/scripts/dybs-validate.mjs';
import { main as gateMain } from '../skills/dybs-gate/scripts/dybs-gate.mjs';

const HELP = `dybs-skills ${packageVersion()}

Install the skills with a skills package manager:
  ${INSTALL_HINT}                     all skills, 18+ agents
  ${INSTALL_HINT} --skill dybs-prd    one skill

This CLI adds what a package manager can't:
  dybs-skills validate [dir] [--doc <name>] [--json]   check a project's dybs/ context
  dybs-skills update   [dir] [--global] [--force] [--dry-run] [--json]
                       update installed Dybs skills without overwriting your edits
  dybs-skills gate     <gate.md> [--today YYYY-MM-DD] [--json]
                       compute the quality gate for a task
  dybs-skills status   [dir] [--global] [--json]        where Dybs skills are installed
  dybs-skills list                                      skills in this package

update and status look in every .<agent>/skills/ folder of the project
(and of your home folder with --global), follow the link a package manager
makes for a whole skill folder, and only touch
skills that are already installed. A file you changed is never overwritten:
--force replaces it and keeps a .bak copy. A skill with anything that needs
you is left completely unchanged. Links inside a skill are never followed.
Discovery covers .<agent>/skills/ folders directly under the project (and
home); it is not an inventory of every package manager or plugin location.`;

const SYMBOL = { add: '+', update: '~', replace: '!', remove: '-', conflict: '?', keep: '=', unsafe: 'x' };
// Bump when the shape of --json output changes.
const JSON_SCHEMA = 1;

function parse(argv) {
  const opts = { positional: [], force: false, dryRun: false, global: false };
  for (const a of argv) {
    if (a === '--force') opts.force = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--global') opts.global = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else opts.positional.push(a);
  }
  return opts;
}

export function run(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { console.log(HELP); return 0; }
  if (cmd === 'validate') return validateMain(['node', 'dybs-validate', ...rest]);
  if (cmd === 'gate') return gateMain(['node', 'dybs-gate', ...rest]);
  if (cmd === 'list') { for (const s of skillNames()) console.log(s); return 0; }

  const opts = parse(rest);
  if (opts.help) { console.log(HELP); return 0; }
  const roots = rootsFor(resolve(opts.positional[0] || '.'), opts);

  if (cmd === 'status') {
    const installs = findInstalls(roots);
    if (opts.json) {
      console.log(JSON.stringify({ schema: JSON_SCHEMA, installs }, null, 2));
      return 0;
    }
    if (!installs.length) { console.log(`No Dybs skills installed. Install with: ${INSTALL_HINT}`); return 0; }
    for (const i of installs) console.log(`${i.skill.padEnd(18)} ${i.dir}${i.via.length > 1 ? `  (also via ${i.via.length - 1} link)` : ''}`);
    return 0;
  }

  if (cmd === 'update') {
    const { results, notInstalled } = update(roots, opts);
    const blocked = results.filter((r) => r.blocked);
    if (opts.json) {
      console.log(JSON.stringify({ schema: JSON_SCHEMA, dryRun: opts.dryRun, results, notInstalled }, null, 2));
      return blocked.length ? 1 : 0;
    }
    if (!results.length) { console.log(`No Dybs skills installed. Install with: ${INSTALL_HINT}`); return 0; }
    for (const r of results) {
      const changed = r.actions.filter((a) => a.op !== 'same');
      const state = r.blocked ? 'skipped, needs you' : changed.length ? `${changed.length} change(s)${r.applied ? '' : ' (dry run)'}` : 'up to date';
      console.log(`${r.skill.padEnd(18)} ${state}`);
      for (const a of changed) {
        console.log(`  ${SYMBOL[a.op]} ${a.rel}${a.why ? `  (${a.why})` : ''}${a.backup ? `  backup: ${a.backup}` : ''}`);
      }
    }
    if (notInstalled.length) {
      console.log(`\nNot installed (left alone): ${notInstalled.join(', ')}`);
      console.log(`Add one with: ${INSTALL_HINT} --skill <name>`);
    }
    if (blocked.length) {
      console.log(`\n${blocked.length} skill(s) left completely unchanged, so none mixes files from two releases.`);
      if (blocked.some((r) => r.actions.some((a) => a.op === 'conflict'))) {
        console.log('? = you changed this file. Re-run with --force to replace it (a .bak copy is kept).');
      }
      if (blocked.some((r) => r.actions.some((a) => a.op === 'unsafe'))) {
        console.log('x = a link or non-file inside the skill. Never written, even with --force: replace it with a regular file, or reinstall the skill.');
      }
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

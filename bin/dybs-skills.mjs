#!/usr/bin/env node
import { resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  update, discover, rootsFor, skillNames, packageVersion, INSTALL_HINT,
} from '../src/update.mjs';
import { main as validateMain } from '../skills/dybs-start/scripts/dybs-validate.mjs';

const HELP = `dybs-skills ${packageVersion()}

Install the skills with a skills package manager:
  ${INSTALL_HINT}                     pick skills and agents
  ${INSTALL_HINT} --skill '*'         all skills, pick agents
  ${INSTALL_HINT} --skill dybs-prd    one skill

This CLI adds what a package manager can't:
  dybs-skills validate [dir] [--doc <name>] [--json]   check a project's dybs/ context
  dybs-skills validate [dir] --accept <doc> [--json]   on your word: mark a doc accepted,
                       dated and fingerprinted (refuses one that does not validate)
  dybs-skills update   [dir] [--global] [--force] [--dry-run] [--json]
                       update installed Dybs skills without overwriting your edits
  dybs-skills status   [dir] [--global] [--json]        where Dybs skills are installed
  dybs-skills list                                      skills in this package

update and status look in every .<agent>/skills/ folder of the project
(and of your home folder with --global), follow the link a package manager
makes for a whole skill folder, and only touch
skills that are already installed. A file you changed is never overwritten:
--force replaces it and keeps a .bak copy. A skill with anything that needs
you is left completely unchanged. Links inside a skill are never followed.
Discovery covers .<agent>/skills/ folders directly under the project (and
home); it is not an inventory of every package manager or plugin location.
A skill that resolves outside the folder you asked for (for example through
a linked .claude folder) is reported and left alone; use --global for
installs in your home folder.`;

function printSkipped(skipped) {
  if (!skipped.length) return;
  console.log('\nLeft alone:');
  for (const s of skipped) console.log(`  ${s.via} -> ${s.dir}  (${s.why})`);
}

const SYMBOL = { add: '+', update: '~', replace: '!', remove: '-', conflict: '?', keep: '=', unsafe: 'x' };
// Bump when the shape of --json output changes.
const JSON_SCHEMA = 1;

// Unknown options and extra paths are refused: a misspelled --dry-run must
// never turn into a real update.
function parse(argv) {
  const opts = { positional: [], force: false, dryRun: false, global: false };
  for (const a of argv) {
    if (a === '--force') opts.force = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--global') opts.global = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a.startsWith('-')) opts.error = `unknown option "${a}"`;
    else opts.positional.push(a);
  }
  if (!opts.error && opts.positional.length > 1) opts.error = `one folder at most, got ${opts.positional.length}`;
  return opts;
}

// `deps.update` and `deps.discover` let a test stand in for the updater.
export function run(argv, deps = {}) {
  const runUpdate = deps.update || update;
  const runDiscover = deps.discover || discover;
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { console.log(HELP); return 0; }
  if (cmd === 'validate') return validateMain(['node', 'dybs-validate', ...rest]);
  const opts = parse(rest);
  if (opts.help) { console.log(HELP); return 0; }
  if (opts.error) { console.error(`${opts.error}\n\n${HELP}`); return 2; }
  // `list` takes no options or folder: anything else is a mistake, not a list.
  if (cmd === 'list') {
    if (rest.length) { console.error(`list takes no arguments, got: ${rest.join(' ')}\n\n${HELP}`); return 2; }
    for (const s of skillNames()) console.log(s);
    return 0;
  }
  const roots = rootsFor(resolve(opts.positional[0] || '.'), opts);

  if (cmd === 'status') {
    let found;
    try {
      found = runDiscover(roots);
    } catch (err) {
      // A discovery failure (an unreadable folder) is still JSON when asked.
      if (opts.json) {
        console.log(JSON.stringify({ schema: JSON_SCHEMA, error: err.message }, null, 2));
        return 1;
      }
      throw err;
    }
    const { installs, skipped } = found;
    if (opts.json) {
      console.log(JSON.stringify({ schema: JSON_SCHEMA, installs, skipped }, null, 2));
      return 0;
    }
    // Installs left alone (outside the folder) exist: never call that empty.
    if (!installs.length) console.log(skipped.length ? 'No Dybs skills installed in this folder; the ones below were left alone.' : `No Dybs skills installed. Install with: ${INSTALL_HINT}`);
    for (const i of installs) console.log(`${i.skill.padEnd(18)} ${i.dir}${i.via.length > 1 ? `  (also via ${i.via.length - 1} link)` : ''}`);
    printSkipped(skipped);
    return 0;
  }

  if (cmd === 'update') {
    let outcome;
    try {
      outcome = runUpdate(roots, opts);
    } catch (err) {
      // An update that stopped (a path changed, a permission error) is still
      // reported as JSON when asked, so automation can handle it.
      if (opts.json) {
        // Installs updated before the failure are committed: listed here.
        console.log(JSON.stringify({ schema: JSON_SCHEMA, dryRun: opts.dryRun, error: err.message, ...(err.completed ? { completed: err.completed } : {}) }, null, 2));
        return 1;
      }
      throw err;
    }
    const { results, notInstalled, skipped } = outcome;
    const blocked = results.filter((r) => r.blocked);
    if (opts.json) {
      console.log(JSON.stringify({ schema: JSON_SCHEMA, dryRun: opts.dryRun, results, notInstalled, skipped }, null, 2));
      return blocked.length ? 1 : 0;
    }
    if (!results.length) {
      console.log(skipped.length ? 'No Dybs skills installed in this folder; the ones below were left alone.' : `No Dybs skills installed. Install with: ${INSTALL_HINT}`);
      printSkipped(skipped);
      return 0;
    }
    for (const r of results) {
      const changed = r.actions.filter((a) => a.op !== 'same');
      const state = r.blocked ? 'skipped, needs you' : changed.length ? `${changed.length} change(s)${r.applied ? '' : ' (dry run)'}` : 'up to date';
      console.log(`${r.skill.padEnd(18)} ${state}`);
      for (const a of changed) {
        console.log(`  ${SYMBOL[a.op]} ${a.rel}${a.why ? `  (${a.why})` : ''}${a.backup ? `  backup: ${a.backup}` : ''}`);
        if (a.kept) console.log(`    the old version changed during the update; kept at ${a.kept}`);
      }
    }
    if (notInstalled.length) {
      console.log(`\nNot installed (left alone): ${notInstalled.join(', ')}`);
      console.log(`Add one with: ${INSTALL_HINT} --skill <name>`);
    }
    printSkipped(skipped);
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

// Run only when called as a command, so tests can import run().
function calledDirectly() {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

if (calledDirectly()) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (err) {
    console.error(`dybs-skills: ${err.message}`);
    process.exitCode = 1;
  }
}

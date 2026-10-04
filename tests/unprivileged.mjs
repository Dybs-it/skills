// Runs a command as a user without special permissions, so permission tests
// mean something even when the suite runs as root (root reads anything).
// As root it uses `runuser -u nobody` with a Node binary that user can
// execute: the current one, or a copy in a world-readable temp folder when
// the current one sits below a folder nobody cannot search (/root/.nvm/...).
// Returns null only when neither works; the caller then skips, saying why.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let nodeForNobody;
const runsAsNobody = (node) => {
  try { execFileSync('runuser', ['-u', 'nobody', '--', node, '-e', '0'], { stdio: 'pipe' }); return true; } catch { return false; }
};

export function unprivileged(args) {
  if (process.getuid?.() !== 0) return [process.execPath, args];
  if (nodeForNobody === undefined) {
    nodeForNobody = null;
    if (runsAsNobody(process.execPath)) nodeForNobody = process.execPath;
    else {
      try {
        const dir = mkdtempSync(join(tmpdir(), 'dybs-node-'));
        chmodSync(dir, 0o755);
        const copy = join(dir, 'node');
        copyFileSync(process.execPath, copy);
        chmodSync(copy, 0o755);
        if (runsAsNobody(copy)) nodeForNobody = copy;
      } catch { /* stays null */ }
    }
  }
  return nodeForNobody ? ['runuser', ['-u', 'nobody', '--', nodeForNobody, ...args]] : null;
}

export const UNPRIVILEGED_SKIP = 'needs an unprivileged user: running as root without runuser or a Node binary that user can execute';

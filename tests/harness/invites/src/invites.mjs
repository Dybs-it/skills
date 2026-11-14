// In-memory invite links for a team workspace.
const invites = new Map();
let seq = 0;

export function createInvite({ ownerId, teamId, ttlMs = 86_400_000, maxUses = 1, now = Date.now() }) {
  if (!ownerId || !teamId) throw new Error('ownerId and teamId are required');
  const id = `inv_${++seq}`;
  invites.set(id, { id, ownerId, teamId, expiresAt: now + ttlMs, maxUses, uses: 0 });
  return invites.get(id);
}

export function redeemInvite(id, userId, now = Date.now()) {
  const inv = invites.get(id);
  if (!inv) return { ok: false, reason: 'not-found' };
  if (now >= inv.expiresAt) return { ok: false, reason: 'expired' };
  if (inv.uses >= inv.maxUses) return { ok: false, reason: 'used-up' };
  inv.uses += 1;
  return { ok: true, teamId: inv.teamId, userId };
}

export function _reset() { invites.clear(); seq = 0; }

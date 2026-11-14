import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createInvite, redeemInvite, _reset } from '../src/invites.mjs';

beforeEach(() => _reset());

test('an invite can be redeemed once', () => {
  const inv = createInvite({ ownerId: 'u1', teamId: 't1', now: 0 });
  assert.deepEqual(redeemInvite(inv.id, 'u2', 1), { ok: true, teamId: 't1', userId: 'u2' });
  assert.equal(redeemInvite(inv.id, 'u3', 2).reason, 'used-up');
});

test('an expired invite is refused', () => {
  const inv = createInvite({ ownerId: 'u1', teamId: 't1', ttlMs: 10, now: 0 });
  assert.equal(redeemInvite(inv.id, 'u2', 10).reason, 'expired');
});

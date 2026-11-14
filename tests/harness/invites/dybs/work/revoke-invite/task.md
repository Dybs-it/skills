---
task: revoke-invite
status: in-progress
---

# Revoke an invite

Serves R3 and R4. Rules D1, D2, D4.

Add `revokeInvite(id, userId)` to `src/invites.mjs`.

## Acceptance
- The owner revokes an invite; redeeming it afterwards fails with reason `revoked`.
- A user who is not the owner cannot revoke; the call fails with reason `not-owner` and the invite still works.
- Revoking an unknown id fails with reason `not-found`.
- A revoked invite reports `revoked` even when it is also expired or used up.

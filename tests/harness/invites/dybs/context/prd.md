---
doc: prd
status: accepted
updated: 2026-11-01
accepted: 2026-11-01
depth: quick
---

# PRD: Invites

## Problem
Owners cannot take back an invite link once it is shared, so a leaked link stays usable until it expires.

## Users
- **Team owner:** controls who can join the team.
- **Invitee:** joins with a link.

## Goals
1. A leaked link can be made useless at once.

## Requirements
- **R1 (must):** An owner can create an invite with an expiry and a maximum number of uses.
- **R2 (must):** An invitee can redeem a valid invite.
- **R3 (must):** An owner can revoke an invite they created.
- **R4:** Redeeming tells the caller why it failed.

## Success measures
- Goal 1: a revoked invite is refused on the next redeem.

## Open questions
- None.

---
doc: domain
status: accepted
updated: 2026-11-01
accepted: 2026-11-01
depth: quick
---

# Domain: Invites

## Glossary
| Term | Meaning | Not to be confused with |
|---|---|---|
| Invite | A link that lets someone join one team | Membership |
| Owner | The user who created the invite | Team admin |
| Redeem | Use an invite to join | Accept |
| Revoke | Make an invite unusable for good | Expire (time based) |

## Rules
- **D1:** Only the owner of an invite may revoke it.
- **D2:** A revoked invite can never be redeemed, and never becomes valid again.
- **D3:** An invite is refused at and after its expiry time.
- **D4:** Redeem failures name one reason: `not-found`, `revoked`, `expired`, `used-up`. `revoked` wins over the others.

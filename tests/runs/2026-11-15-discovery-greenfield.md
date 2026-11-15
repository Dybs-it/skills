# 2026-11-15 freelance invoices (greenfield, synthetic), discovery, depth: quick, checkins: none

A machine run, not the human field run `tests/PROTOCOL.md` asks for. One
fresh headless Claude Code session per step on Sonnet at medium effort, with
web search allowed. The kickoff answers were in the first prompt: a web app
that helps freelance designers get paid on time, EU based, `exists:
nothing`, `decides: one`.

| Step | Turns | Tokens | Cost | Result |
|---|---|---|---|---|
| start | 5 | 177k | $0.12 | `project.md` with `exists` and `decides`; next: map |
| map | 10 | 329k | $0.20 | valid draft, 434 words; target recommended, not chosen |
| sketch (1st try) | 7 | 256k | $0.10 | refused: waited for a confirmation nobody could give |
| sketch (2nd try) | 7 | 266k | $0.11 | refused again |
| *fix: "When the human is not asked now" added to the skill* | | | | |
| sketch | 14 | 431k | $0.24 | valid draft, 770 words; 5 research finds with links, 3 concepts |
| decide | 6 | 204k | $0.08 | valid draft, 492 words; `Not decided yet. Recommended: ...` |
| **Total, without the two refused runs** | **35** | **1.14M** | **$0.64** | |

## What worked

- **Research had sources.** Five finds (built-in reminders in invoicing
  apps, two dedicated chasers, a reminder cadence, message generators), each
  with a link. One was marked as a blog rather than a primary source.
- **The concepts differed in kind:** a message coach (the designer sends),
  a quiet chaser (the app drafts, the designer approves each send), and a
  formal letter service built on the EU Late Payment Directive.
- **Nobody decided for the founder.** Decide wrote `Not decided yet.
  Recommended: ...`, framed the rejected concepts as "would be left
  behind", and the skeptic's objection (a crowded market, one-tap approval
  may still be put off) was recorded.
- **Honesty about evidence:** no simulated customers; the map says no
  interviews exist and asks for five to eight real ones; the EU law point is
  marked unconfirmed for sole traders and sent to a qualified person.
- **Specialists ran as sub-agents** (on Haiku) and only in map and sketch.

## What went wrong

- **Discovery stalled under `checkins: none`.** Each stage ends with the
  human's confirmation; with nobody to ask, the agent refused Sketch twice
  (523k tokens wasted). It was cautious for the right reason. The skill now
  says the confirmation waits for the review point the human chose, and
  that Decide writes a recommendation, never a decision.

## Not covered

A human answering, `exists: research` with real interviews, `exists: code`,
`decides: team` or `client`, the thorough depth, and the PRD drafted from
discovery.

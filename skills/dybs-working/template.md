---
doc: working
status: draft
depth: {{quick | thorough}}
updated: {{YYYY-MM-DD}}
github: {{yes | no}}
issues: {{github | none | where else}}
pull-requests: {{per-task | per-idea | none}}
runtime: {{none | herdr}}
---

# How we work: {{Project name}}

## Testing

<!-- What must be proven before a change counts as done, and how. -->
- **Levels:** {{unit, integration, end-to-end: which are wanted, which are not}}
- **Commands:** {{the test, lint and build commands, and what CI runs}}
- **Never ships untested:** {{the behaviour that always needs a test}}

## Source control

<!-- Where the code and the issues live, and what agents may do there. -->
- **Repository:** {{host, owner/name, default branch}}
- **Issues:** {{where work is written down, and how a task refers to one}}
- **Branches and commits:** {{naming, one branch per task or not, commit style}}

## Pull requests

<!-- Whether a change goes through a pull request, who opens it, who merges. -->
- **Policy:** {{a pull request per task, per idea, or none}}
- **Opens:** {{the human, or an agent as a draft}}
- **Merges:** {{who, and which checks must be green}}

## Agents and runtime

<!-- Which agents do the work, how far they may go alone, what it may cost. -->
- **Agents:** {{the coding agents in use}}
- **Unattended:** {{what may run without a human, and what never may}}
- **Runtime:** {{none, or Herdr, and what it is used for}}
- **Budget:** {{model preference and any cap per task}}

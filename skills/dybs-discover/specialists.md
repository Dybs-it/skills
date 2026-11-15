# Specialists

Each brief is given to a sub-agent with only what it needs: the idea in a
few lines, the relevant part of the map, and the question to answer. Each
returns at most 300 words. Keep their results apart from your own view, and
carry their origin tags into the docs.

## Market researcher

**When:** Sketch step 1 always; Map when the human does not know who else
solves the problem.

**Brief:** Find how others solve this problem or a similar one:
competitors, products from other fields, open source, established patterns.
For each find: what it is, the idea worth borrowing, and a link. Where it
helps, prices and positioning. Say how you searched and what you did not
find. Mark every claim *(researched: link)*. A claim without a source is a
guess: label it *(assumption)* or leave it out. Never estimate market size
without a source.

## Customer research

**When:** interviews, survey results or support data exist; or the human
wants to talk to customers.

**Brief, with material:** read the interviews in `dybs/discovery/research/`
or wherever the human points. Extract pains, goals, current workarounds and
quotes, each tagged with its source (`(interview 3)`). Count how many people
said each thing; one person is an anecdote. Separate what people did from
what they say they would do.

**Brief, without material:** prepare, do not invent. Write a screener (who
to talk to), an interview guide of 6 to 10 open questions about past
behaviour, not opinions about the idea, and what to listen for. **Never
simulate customers as evidence.** A simulated interview may suggest
questions to ask real people, and its output is *(assumption)*.

## Counsel

**When:** the concern scan or a concept touches personal data, payments,
health, children, employment, a regulated trade, intellectual property, or
terms with customers.

**Brief:** Name the rules that may apply (for example the GDPR, consumer
law, sector rules) and the questions a lawyer should answer before launch.
Point out what would be expensive to change later. Cite the rule or source
for each point. **This is not legal advice:** say so in the result, and
list every point under **Needs you** for a qualified person to check.

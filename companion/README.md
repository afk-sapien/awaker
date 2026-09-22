# Companion tools

Nothing in this directory is part of Awaker. It is not in the container, the wheel or the sdist, it
is never loaded by the app or the service, and deleting it changes nothing about how Awaker runs.

These are instructions for an AI assistant that already has access to Awaker's read-only MCP tools.
Awaker itself has no model, no API key and no network access beyond Sleeper and ESPN, and that is
deliberate: the app computes numbers you can check against the code, and anything that turns those
numbers into prose belongs outside it. See [`docs/integrations.md`](../docs/integrations.md) for
connecting the tools.

## `awaker-recap`

Writes the week's league recap as a shareable HTML page: results, the points each roster left on its
bench, the start/sit calls that were actually there to be made, and the week's waiver claims and
trades. It leans on the one distinction the `get_recap` tool is careful about — a manager who set
the lineup the projections advised and lost anyway was unlucky, not careless — because a recap that
cannot tell those apart is worse than no recap.

### Using it with Claude Code or Claude

Copy the skill where your assistant looks for skills:

```sh
# just this project
mkdir -p .claude/skills && cp -r companion/awaker-recap .claude/skills/

# or everywhere
mkdir -p ~/.claude/skills && cp -r companion/awaker-recap ~/.claude/skills/
```

Then ask for what you want — "recap week 5 of my league", "what happened in the Office League this
week" — and the skill takes it from there. It needs the Awaker service running with its MCP tools
connected; it will tell you if they are missing rather than guessing at your league.

### Using it with something else

`SKILL.md` is a plain Markdown briefing and the two files in `references/` are plain documentation,
so any assistant that accepts a system prompt can use them. Paste `SKILL.md` and
`references/payload.md` in, give the model access to `get_recap` over MCP or to
`POST /api/v1/recap` with an agent token, and it has everything the Claude version has.

## Writing your own

The same shape works for anything that reads Awaker and writes something: a draft review, a trade
post-mortem, a season-in-review. Keep to the rules in `awaker-recap/SKILL.md` that are not about
style — quote the numbers rather than computing them, say what is missing, and never let an
assistant's prose imply more certainty than the projections behind it.

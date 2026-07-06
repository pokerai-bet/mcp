# @pokerai/mcp

MCP server for the **[Pokerai API](https://pokerai.bet)** — solver-grade GTO strategy for 6-max
No-Limit Hold'em, exposed as tools your LLM agent (Claude, Cursor, Claude Code, …) can call.

Ask *"what's GTO for AKs on the button facing a UTG open?"* and the agent gets real presolved
frequencies, not a guess.

## Setup

You need a Pokerai API key — get one free at **https://pokerai.bet/login**.

The server runs over stdio via `npx`, so there's nothing to install globally.

### Claude Desktop

Add to `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "pokerai": {
      "command": "npx",
      "args": ["-y", "@pokerai/mcp"],
      "env": { "POKERAI_API_KEY": "gto_your_key_here" }
    }
  }
}
```

### Claude Code

```bash
claude mcp add pokerai -e POKERAI_API_KEY=gto_your_key_here -- npx -y @pokerai/mcp
```

### Cursor

`~/.cursor/mcp.json` (or Settings → MCP), same shape as the Claude Desktop block above.

## Tools

Presolved lookups (spend your **presolved** quota — 1000/mo on the free tier):

| Tool | What it returns |
|------|-----------------|
| `preflop_versions` | selectable strategy chart sets (free) |
| `preflop_strategy` | fold/call/raise frequencies for a hand vs an action line |
| `preflop_range` | the whole 169-hand-type range for a position + line |
| `flop_tree` | flop decision tree (nodes carry tokens) |
| `flop_node` | strategy at one flop node (with or without a hero hand) |

Real-time solver (turn/river) — **off by default** because it spends the scarce **solve** quota
(25/mo on the free tier). Enable with `POKERAI_ENABLE_SOLVE=1`:

| Tool | What it returns |
|------|-----------------|
| `solve_schedule` | trigger an on-demand solve (costs 1 solve quota) |
| `solve_tree` | poll the solve + get its nodes |
| `solve_node` | strategy at one solved node |
| `node_evs` | per-hand, per-action EVs at a node |

## Environment

| Var | Purpose |
|-----|---------|
| `POKERAI_API_KEY` | **required** — your key from https://pokerai.bet/login |
| `POKERAI_ENABLE_SOLVE` | set to `1` to expose the real-time solver tools |
| `POKERAI_API_BASE` | override the API base (default `https://pokerai.bet`) |

## Notes

- The server authenticates with **your** key and spends **your** quota — it holds no shared
  credential and has no abuse surface of its own.
- stdout is the MCP protocol channel; the server logs only to stderr.

MIT licensed. Docs: https://pokerai.bet/docs.en · Reference: https://pokerai.bet/reference

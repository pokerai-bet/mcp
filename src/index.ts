#!/usr/bin/env node
// Pokerai MCP server — exposes the Pokerai GTO API as tools for LLM agents.
// stdio transport. Auth via POKERAI_API_KEY (the caller's own key/quota).
// Real-time solver tools (which spend the scarce solve quota) are OFF unless
// POKERAI_ENABLE_SOLVE=1.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { apiGet, apiPost } from "./api.js";

const server = new McpServer({ name: "pokerai", version: "0.1.0" });

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}
function fail(e: unknown): ToolResult {
  return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
}

const preflopAction = z.object({
  position: z.string().describe("SB / BB / UTG / MP / CO / BTN"),
  action: z.string().describe("'small blind' | 'big blind' | 'fold' | 'call' | 'raise'"),
  amount: z.number().optional().describe("bet-to amount in big blinds (0.5 SB, 1 BB, 3 for a 3bb open)"),
});

// ---- presolved lookups (always on; spend the caller's presolved quota) ----

server.registerTool(
  "preflop_versions",
  {
    title: "List preflop strategy versions",
    description:
      "The selectable preflop_version values (id + human label) and which is the default. Free (no quota). Call this before assuming a version id.",
    inputSchema: {},
  },
  async () => {
    try {
      return ok(await apiGet("/v1/gto/preflop/versions"));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "preflop_strategy",
  {
    title: "Preflop GTO strategy for a hand",
    description:
      "GTO mixed strategy (fold/call/raise frequencies + sizes) for a specific hand facing a preflop action line, 6-max 100bb. Charges 1 presolved quota. The situation (RFI/3-bet/4-bet/...) is derived from the actions.",
    inputSchema: {
      hole_cards: z.string().describe("hero's two cards, e.g. 'AhKh'"),
      hero: z.string().describe("hero position: UTG / MP / CO / BTN / SB / BB"),
      preflop_actions: z
        .array(preflopAction)
        .describe(
          "full action sequence including blinds, e.g. [{position:'SB',action:'small blind',amount:0.5},{position:'BB',action:'big blind',amount:1},{position:'UTG',action:'raise',amount:3}]",
        ),
      preflop_version: z.string().optional().describe("chart-set id from preflop_versions; omit for the default"),
    },
  },
  async ({ hole_cards, hero, preflop_actions, preflop_version }) => {
    try {
      const body: Record<string, unknown> = { hole_cards, positions: { hero }, preflop_actions };
      if (preflop_version) body.preflop_version = preflop_version;
      return ok(await apiPost("/v1/gto/preflop", body));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "preflop_range",
  {
    title: "Whole preflop range for a spot",
    description:
      "The full 169-hand-type range (fold/call/raise per hand type: AA, AKs, AKo, ...) for a position + action line. No hole_cards. Charges 1 presolved quota (one call, not 169).",
    inputSchema: {
      hero: z.string().describe("the position whose range you want: UTG / MP / CO / BTN / SB / BB"),
      preflop_actions: z
        .array(preflopAction)
        .describe("action sequence incl. blinds; the range is for `hero` acting after these actions"),
      preflop_version: z.string().optional().describe("chart-set id from preflop_versions; omit for the default"),
      table_size: z.string().optional().describe("defaults to '6max'"),
    },
  },
  async ({ hero, preflop_actions, preflop_version, table_size }) => {
    try {
      const body: Record<string, unknown> = { table_size: table_size ?? "6max", positions: { hero }, preflop_actions };
      if (preflop_version) body.preflop_version = preflop_version;
      return ok(await apiPost("/v1/gto/preflop/range", body));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "flop_tree",
  {
    title: "Flop decision tree",
    description:
      "Starting ranges + every decision node for a flop spot. Each node carries a `node` token to pass to flop_node. Charges 1 presolved quota. Single-street (for turn/river use the solver tools).",
    inputSchema: {
      board: z.string().describe("the 3 flop cards, e.g. '2c2h2s'"),
      pot_type: z.enum(["SRP", "3BET", "4BET", "LIMP"]),
      positions: z
        .record(z.string())
        .describe(
          "roles→positions. SRP: {hero,raiser,caller}; 3BET/4BET: {hero,raiser,three_bettor}; LIMP: {hero,limper} (hero or limper must be BB)",
        ),
    },
  },
  async ({ board, pot_type, positions }) => {
    try {
      return ok(await apiPost("/v1/gto/flop/tree", { board, pot_type, positions }));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "flop_node",
  {
    title: "Flop node strategy",
    description:
      "Strategy at one flop decision-tree node. Pass a `node` token minted by flop_tree. With hole_cards → that hand's mixed strategy at the node; omit → the node's whole-range strategy. Free (token-gated).",
    inputSchema: {
      node: z.string().describe("node token from flop_tree"),
      hole_cards: z.string().optional().describe("optional hero hand, e.g. 'AdKd'"),
    },
  },
  async ({ node, hole_cards }) => {
    try {
      const body: Record<string, unknown> = { node };
      if (hole_cards) body.hole_cards = hole_cards;
      return ok(await apiPost("/v1/gto/flop/node", body));
    } catch (e) {
      return fail(e);
    }
  },
);

// ---- real-time solver (turn/river) — OFF unless POKERAI_ENABLE_SOLVE=1 ----
// These can spend the scarce solve quota (25/mo on the free tier), so an agent
// only gets them when the operator explicitly opts in.
const SOLVE_ENABLED = process.env.POKERAI_ENABLE_SOLVE === "1";
if (SOLVE_ENABLED) {
  server.registerTool(
    "solve_schedule",
    {
      title: "Schedule a real-time solve (flop/turn/river)",
      description:
        "Trigger an on-demand solve. board length sets the street (3=flop, 4=turn, 5=river). COSTS 1 solve quota on a fresh trigger (the scarce quota); a cached solve is free; all hosts busy → 429. Returns a `solve` handle — poll solve_tree until queryable.",
      inputSchema: {
        board: z.string().describe("3–5 cards, e.g. '2c2h2s9d' for a turn"),
        oop_range: z.string().describe("out-of-position range, e.g. 'AA,KK,QQ,AKs'"),
        ip_range: z.string().describe("in-position range"),
        pot: z.number().describe("pot size in big blinds"),
        effective_stack: z.number().describe("effective stack in big blinds"),
        hero: z.enum(["OOP", "IP"]).optional(),
      },
    },
    async (args) => {
      try {
        return ok(await apiPost("/v1/gto/solver", args));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "solve_tree",
    {
      title: "Poll a solve + get its tree",
      description:
        "Poll a scheduled solve until spot_status=queryable, then get the decision nodes (tokens for solve_node). Free. For a multi-street solve pass turn_card/river_card to advance to a dealt runout.",
      inputSchema: {
        solve: z.string().describe("handle from solve_schedule"),
        turn_card: z.string().optional().describe("for a flop solve: the dealt turn, e.g. 'Td'"),
        river_card: z.string().optional().describe("the dealt river, e.g. 'Qh'"),
      },
    },
    async (args) => {
      try {
        return ok(await apiPost("/v1/gto/solver/tree", args));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "solve_node",
    {
      title: "Node strategy from a solve",
      description:
        "Strategy at one node of a solve. Pass a node token from solve_tree. hero node → hero strategy; villain node (or omit hole_cards) → whole-range strategy. Free.",
      inputSchema: {
        node: z.string().describe("node token from solve_tree"),
        hole_cards: z.string().optional(),
      },
    },
    async (args) => {
      try {
        return ok(await apiPost("/v1/gto/solver/node", args));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "node_evs",
    {
      title: "Per-hand, per-action EVs at a solve node",
      description:
        "Expected values for every hand+action at one node of a completed solve. Give the `solve` handle (from solve_schedule) + a node_id (from solve_tree). Free. Poll solve_tree until queryable first.",
      inputSchema: {
        solve: z.string().describe("handle from solve_schedule"),
        node_id: z.string().describe("node id, e.g. 'root'"),
      },
    },
    async (args) => {
      try {
        return ok(await apiPost("/v1/gto/evs", args));
      } catch (e) {
        return fail(e);
      }
    },
  );
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the MCP channel — log only to stderr.
  console.error(`pokerai-mcp ready (solver tools ${SOLVE_ENABLED ? "ENABLED" : "off — set POKERAI_ENABLE_SOLVE=1"})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

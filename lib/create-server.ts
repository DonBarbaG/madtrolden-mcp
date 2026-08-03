// Shared MCP server factory — used by both the stdio entrypoint (local dev)
// and the Streamable HTTP endpoint on Vercel.

import { createRequire } from "node:module";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPrompts } from "./prompts";
import { registerDealTools } from "./tools/deals";
import { registerHouseholdTools } from "./tools/household";
import { registerPlannerTools } from "./tools/planner";
import { registerProfileTools } from "./tools/profile";
import { registerRecipeTools } from "./tools/recipes";
import { registerScoringTools } from "./tools/scoring";
import { registerShoppingTools } from "./tools/shopping";
import { registerTrackingTools } from "./tools/tracking";
import { registerWhoamiTool } from "./tools/whoami";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

export const SERVER_VERSION = version;
export const SERVER_NAME = "madtrolden";

export const SERVER_INSTRUCTIONS = `# Madtrolden MCP - Nordic Grocery Deal Hunter

Find grocery deals across Denmark, Norway, Sweden, and Finland via etilbudsavis.dk. Score recipes against current deals, plan weekly meals, and generate deal-optimized shopping lists.

## Country support

- **DK** - full store directory and deals
- **NO**, **SE**, **FI** - curated grocery chains and deals; full store directory not exposed by the upstream API

Set country via update_household. Search terms must be in the local language (Danish, Norwegian, Swedish, or Finnish).

## Tool groups

### Deals
- search_deals: find products by keyword across stores
- get_store_offers: browse one store's catalog
- list_stores: discover dealer IDs for household setup
- deals_this_week: roll-up of preferred-store offers, with expiring deals flagged

### Household
- get_household / update_household: people, dietary restrictions, preferred stores, country, default servings

### Pantry
- get_pantry / update_pantry: staples to exclude from shopping lists

### Recipes
- get_recipes / add_recipe / remove_recipe: recipe library

### Planning and shopping
- plan_week: budget-capped week planning (hard DKK cap, optional kcal target) — use for "feed us for X kr"
- score_recipes: score recipes against current deals; optionally generate an optimized weekly plan
- generate_shopping_list: deal-grouped shopping list for chosen recipes
- plan_and_shop: one-shot weekly plan plus shopping list (no budget cap)

### History
- log_meal / get_meal_history: track cooked meals to avoid repetition
- log_spend / get_spend_log: grocery budget tracking

### Account & profile persistence
- whoami: which account you are connected as, and whether a profile is loaded
- export_profile / import_profile: the durability story — the server stores nothing, the client keeps the blob between sessions

## Remote-server state model (IMPORTANT)

This server is stateless and keeps NO user data at rest. Your household/pantry/recipes/history profile lives only in a short-lived in-memory cache (~24h, wiped on redeploys). If a tool reports that no profile is loaded, ask the user whether to import their saved profile or start fresh with update_household.

## Workflow

First-time setup (the getting-started prompt walks the user through):
1. update_household (country, people, preferred stores)
2. update_pantry (salt, oil, etc.)
3. add_recipe (a few recipes)
4. plan_and_shop

Common queries:
- "Plan my week" -> plan_and_shop
- "What's on sale?" -> deals_this_week
- "Shopping list for Bolognese and Chili" -> generate_shopping_list
- "What should we cook?" -> score_recipes (optimize=true)

## Caveats

- Deal-aware tools require household stores to be configured first
- Search terms must be in the local language: 'hakket oksekød' (DK), 'kjøttdeig' (NO), 'köttfärs' (SE), 'jauheliha' (FI)
- Deals expiring within 2 days are flagged automatically
- Low-confidence ingredient matches are surfaced separately; verify before relying on them
`;

/** Register every prompt and tool on the given server instance. */
export function registerAll(server: McpServer): void {
  registerPrompts(server);
  registerDealTools(server);
  registerHouseholdTools(server);
  registerRecipeTools(server);
  registerScoringTools(server);
  registerTrackingTools(server);
  registerShoppingTools(server);
  registerPlannerTools(server);
  registerProfileTools(server);
  registerWhoamiTool(server);
}

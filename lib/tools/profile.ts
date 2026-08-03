// Client-held profile state: the server keeps nothing at rest, so these two
// tools are the durability story. export_profile hands the client AI a JSON
// blob to keep in its own memory/project notes; import_profile loads it back
// into the short-lived RAM cache next session.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { currentAccount } from "../http/context";
import * as store from "../store";
import { errorResult } from "./shared";

export function registerProfileTools(server: McpServer): void {
  server.tool(
    "export_profile",
    "Export the user's full Madtrolden profile (household, pantry, recipes, meal history, spend log) as one compact JSON blob. IMPORTANT FOR THE ASSISTANT: this server deliberately stores nothing permanently — after receiving the blob, save it somewhere durable on the user's side (conversation memory, project notes, a file) and pass it to import_profile at the start of the next session. USE WHEN: ending a session where anything profile-related changed, or the user asks to back up their setup.",
    {},
    async () => {
      try {
        const data = await store.load();
        return {
          content: [
            {
              type: "text" as const,
              text: `Profile blob (save this for the next session, then re-import with import_profile):\n\n${JSON.stringify(data)}`,
            },
          ],
        };
      } catch (err) {
        return errorResult(`Failed to export profile: ${err instanceof Error ? err.message : err}`);
      }
    },
  );

  server.tool(
    "import_profile",
    "Import a previously exported Madtrolden profile blob (from export_profile) into the server's session cache, restoring household, pantry, recipes, meal history and spend log in one call. The cache lives ~24h in server memory and is wiped on restarts — that is expected; just import again. USE WHEN: starting a session and whoami reports no profile is loaded, or the user provides their saved profile. NOT FOR: making changes (use update_household / update_pantry / add_recipe).",
    {
      profile: z
        .union([z.string(), z.record(z.string(), z.unknown())])
        .describe(
          "The profile blob from export_profile — either the JSON object itself or the JSON string",
        ),
    },
    async ({ profile }) => {
      try {
        const raw = typeof profile === "string" ? JSON.parse(profile) : profile;
        const parsed = store.DataStoreSchema.parse(raw);
        await store.save(parsed as store.DataStore);
        const account = currentAccount();
        const summary = [
          `Profile imported${account ? ` for ${account}` : ""}:`,
          `- household: ${parsed.household.people.length} people, ${parsed.household.stores.length} preferred stores, country ${parsed.household.country}`,
          `- pantry: ${parsed.pantry.length} items`,
          `- recipes: ${parsed.recipes.length}`,
          `- meal history: ${parsed.mealHistory.length} entries, spend log: ${parsed.spendLog.length} entries`,
        ].join("\n");
        return { content: [{ type: "text" as const, text: summary }] };
      } catch (err) {
        if (err instanceof z.ZodError) {
          const issues = err.issues
            .slice(0, 5)
            .map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("\n");
          return errorResult(
            `Profile blob failed validation — nothing was imported. Issues:\n${issues}`,
          );
        }
        return errorResult(`Failed to import profile: ${err instanceof Error ? err.message : err}`);
      }
    },
  );
}

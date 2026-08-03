import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { currentAccount } from "../http/context";
import { profileCacheInfo } from "../store";

function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

export function registerWhoamiTool(server: McpServer): void {
  server.tool(
    "whoami",
    "Show which account this connection is authenticated as, whether a profile is currently loaded in the server's short-lived memory cache, and how old that cache entry is. USE WHEN: starting a session, or when unsure whether the user's profile needs to be imported again.",
    {},
    async () => {
      const account = currentAccount();
      if (!account) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Running locally over stdio — no remote account. Profile is stored on disk (~/.tilbudstrolden.json).",
            },
          ],
        };
      }
      const info = profileCacheInfo(account);
      const profileLine = info.exists
        ? `A profile is loaded in the server's memory cache (age: ${formatAge(info.ageMs)}; cache expires after ~24h or on server restart).`
        : "No profile is loaded in the server's memory cache. Ask the user to import their saved profile, or start fresh with update_household.";
      return {
        content: [
          {
            type: "text" as const,
            text: `Connected as: ${account}\n${profileLine}\n\nNote: this server stores nothing permanently — the client keeps the durable copy of the profile.`,
          },
        ],
      };
    },
  );
}

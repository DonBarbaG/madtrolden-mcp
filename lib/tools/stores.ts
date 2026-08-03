// find_stores_near — which physical supermarket branches are near the user.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DAWA_ATTRIBUTION } from "../geo";
import { findStoresNear, REGIONAL_FLYER_CAVEAT } from "../location";
import { errorResult } from "./shared";

export function registerStoreLocationTools(server: McpServer): void {
  server.tool(
    "find_stores_near",
    "Find physical supermarket branches near a Danish address or lat,lng point, with distances in km, grouped by chain. USE WHEN: setting up preferred stores ('what's near Vesterbro?'), checking where to shop, or before location-aware planning (pass the same location to plan_week). Returns structured data — names, addresses, coordinates, distances — for the assistant to present. Denmark only (DAWA geocoding).",
    {
      location: z
        .string()
        .describe('Danish address ("Istedgade 50, København") or "lat,lng" (e.g. "55.667,12.545")'),
      radius_km: z
        .number()
        .positive()
        .max(25)
        .optional()
        .default(3)
        .describe("Search radius in km (default 3)"),
    },
    async ({ location, radius_km }) => {
      try {
        const nearby = await findStoresNear(location, radius_km);
        if (!nearby) {
          return errorResult(
            `Could not resolve "${location}" to a Danish location. Try a fuller address (street + number + city) or "lat,lng".`,
          );
        }
        if (nearby.branches.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No store branches found within ${radius_km} km of ${nearby.origin.label}. Try a bigger radius_km.`,
              },
            ],
          };
        }

        const byChain = new Map<string, typeof nearby.branches>();
        for (const b of nearby.branches) {
          const list = byChain.get(b.brand) ?? [];
          list.push(b);
          byChain.set(b.brand, list);
        }

        const lines: string[] = [
          `${nearby.branches.length} branches within ${radius_km} km of ${nearby.origin.label}:`,
          "",
        ];
        for (const [brand, branches] of [...byChain.entries()].sort(
          (a, b) => a[1][0].distanceKm - b[1][0].distanceKm,
        )) {
          lines.push(`## ${brand} (dealer id: ${branches[0].dealerId})`);
          for (const b of branches.slice(0, 3)) {
            lines.push(
              `- ${b.name || b.street} — ${b.street}, ${b.zip} ${b.city} (${b.distanceKm} km, lat ${b.lat.toFixed(5)}, lng ${b.lng.toFixed(5)})`,
            );
          }
          if (branches.length > 3) lines.push(`  …and ${branches.length - 3} more`);
          lines.push("");
        }
        lines.push(
          "Tip: use update_household to save the nearest chains as preferred stores (name + dealer id), and pass the same location to plan_week for distance-aware planning.",
        );
        lines.push(`\n_${REGIONAL_FLYER_CAVEAT}_`);
        lines.push(`_${DAWA_ATTRIBUTION}_`);

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (err) {
        return errorResult(`Failed to find stores: ${err instanceof Error ? err.message : err}`);
      }
    },
  );
}

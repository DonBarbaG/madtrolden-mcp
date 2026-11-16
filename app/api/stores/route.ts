// Store picker for the /plan UI: which grocery chains are near an address.
// Same key auth as /api/plan. GET ?location=…&radius=… →
// { resolvedLocation, chains: [{ brand, distanceKm, branch }] }; with no
// location → every grocery chain, no distances (pick chains nationwide).

import { GROCERY_CHAINS } from "@/lib/grocery-chains";
import { keyFromCookie, verifyKey } from "@/lib/http/auth";
import { takeToken } from "@/lib/http/rate-limit";
import { findStoresNear } from "@/lib/location";

export const dynamic = "force-dynamic";

function account(req: Request): string | null {
  const header = req.headers.get("authorization");
  const key = header?.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : keyFromCookie(req.headers.get("cookie"));
  return key ? verifyKey(key) : null;
}

export async function GET(req: Request): Promise<Response> {
  const who = account(req);
  if (who === null) return Response.json({ error: "unauthorized" }, { status: 401 });
  const rate = takeToken(who);
  if (!rate.ok) return Response.json({ error: "rate_limited" }, { status: 429 });

  const url = new URL(req.url);
  const location = url.searchParams.get("location")?.trim().slice(0, 200) ?? "";
  const radiusRaw = Number(url.searchParams.get("radius"));
  const radiusKm =
    Number.isFinite(radiusRaw) && radiusRaw > 0 ? Math.min(25, Math.max(1, radiusRaw)) : 3;

  if (location === "") {
    return Response.json({
      resolvedLocation: null,
      radiusKm: null,
      chains: [...GROCERY_CHAINS]
        .sort((a, b) => a.localeCompare(b, "da"))
        .map((brand) => ({ brand, distanceKm: null, branch: null })),
    });
  }

  try {
    const nearby = await findStoresNear(location, radiusKm, { groceryOnly: true });
    if (!nearby) {
      return Response.json(
        { error: `kunne ikke finde "${location}" — prøv vej + nummer + by` },
        { status: 404 },
      );
    }
    return Response.json({
      resolvedLocation: nearby.origin.label ?? location,
      radiusKm,
      chains: [...nearby.nearestByChain.entries()].map(([brand, b]) => ({
        brand,
        distanceKm: b.distanceKm,
        branch: `${b.street}, ${b.zip} ${b.city}`.trim(),
      })),
    });
  } catch (err) {
    console.error("[stores-api] failed:", err);
    return Response.json({ error: "butiksopslag fejlede — prøv igen" }, { status: 502 });
  }
}

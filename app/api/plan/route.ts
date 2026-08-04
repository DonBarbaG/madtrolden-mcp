// JSON endpoint for the private /plan web UI. Same key auth, same rate
// limits, same planning pipeline as the MCP tool — just structured JSON out.

import { keyFingerprint, verifyKey } from "@/lib/http/auth";
import { runWithAccount } from "@/lib/http/context";
import { takeToken } from "@/lib/http/rate-limit";
import { runPlanWeek } from "@/lib/plan-service";
import type { MealType } from "@/lib/planner";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

function authenticate(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) return null;
  return verifyKey(header.slice(7).trim());
}

/** Login check for the UI: 200 + account name with a valid key, uniform 401 otherwise. */
export async function GET(req: Request): Promise<Response> {
  const account = authenticate(req);
  if (account === null) {
    console.error(
      `[auth] 401 ui-login key=${keyFingerprint(req.headers.get("authorization") ?? "")}`,
    );
    return unauthorized();
  }
  return Response.json({ account });
}

const MEAL_TYPES = new Set(["breakfast", "lunch", "dinner"]);

export async function POST(req: Request): Promise<Response> {
  const account = authenticate(req);
  if (account === null) return unauthorized();

  const rate = takeToken(account);
  if (!rate.ok) {
    return new Response(JSON.stringify({ error: "rate_limited" }), {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": String(rate.retryAfterSec) },
    });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const budget = Number(body.budget);
  if (!Number.isFinite(budget) || budget <= 0) {
    return Response.json({ error: "budget (positive number, DKK) is required" }, { status: 400 });
  }
  const meals = Array.isArray(body.meals)
    ? (body.meals.filter((m) => typeof m === "string" && MEAL_TYPES.has(m)) as MealType[])
    : undefined;

  const num = (v: unknown): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };

  try {
    const outcome = await runWithAccount(account, () =>
      runPlanWeek({
        budget,
        people: num(body.people),
        days: num(body.days) ? Math.min(14, Math.round(num(body.days) as number)) : undefined,
        meals,
        kcalPerPersonPerDay: num(body.kcalPerPersonPerDay),
        excludeProteins: Array.isArray(body.excludeProteins)
          ? (body.excludeProteins.filter((e) => typeof e === "string") as string[])
          : undefined,
        maxCookMinutes: num(body.maxCookMinutes),
        mealPrep: body.mealPrep === true,
        cookDays: Array.isArray(body.cookDays)
          ? (body.cookDays.map(Number).filter((n) => Number.isInteger(n) && n >= 1) as number[])
          : undefined,
        location:
          typeof body.location === "string" && body.location.trim() !== ""
            ? body.location
            : undefined,
        radiusKm: num(body.radiusKm),
      }),
    );

    if (!outcome.ok) {
      return Response.json({ error: outcome.error }, { status: 422 });
    }

    // Maps don't serialize — flatten nearest branches for the UI.
    const nearest = outcome.nearby
      ? Object.fromEntries(
          [...outcome.nearby.nearestByChain.entries()].map(([brand, b]) => [
            brand,
            { name: b.name, street: b.street, zip: b.zip, city: b.city, distanceKm: b.distanceKm },
          ]),
        )
      : null;

    return Response.json({
      account,
      currency: outcome.currency,
      result: outcome.result,
      nearestByChain: nearest,
      resolvedLocation: outcome.nearby?.origin.label ?? null,
    });
  } catch (err) {
    console.error("[plan-api] failed:", err);
    return Response.json({ error: "planning failed — try again" }, { status: 500 });
  }
}

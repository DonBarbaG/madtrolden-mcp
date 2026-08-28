// JSON endpoint for the private /plan web UI. Same key auth, same rate
// limits, same planning pipeline as the MCP tool — just structured JSON out.

import { keyFingerprint, verifyKey } from "@/lib/http/auth";
import { runWithAccount } from "@/lib/http/context";
import { takeToken } from "@/lib/http/rate-limit";
import { runPlanWeek } from "@/lib/plan-service";
import type { MealType } from "@/lib/planner";

export const dynamic = "force-dynamic";
// AI mode can take two model round-trips; give the function real headroom.
export const maxDuration = 300;

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

  // AI planning holds the connection open for minutes with zero bytes sent;
  // phone carriers and proxies kill such idle sockets, so the browser saw
  // "mistede forbindelsen" mid-plan. Stream newline heartbeats while the
  // planner runs and emit the JSON payload as the last line (ndjson-ish).
  // Errors after this point ride inside the body as {error} — headers are
  // already sent, so the status is always 200 once streaming starts.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (s: string) => {
        try {
          controller.enqueue(encoder.encode(s));
        } catch {
          // Client went away; the planner finishes on its own.
        }
      };
      enqueue("\n"); // flush headers + first byte immediately
      const heartbeat = setInterval(() => enqueue("\n"), 10_000);
      try {
        const payload = await planPayload(account, body);
        enqueue(JSON.stringify(payload));
      } catch (err) {
        console.error("[plan-api] failed:", err);
        enqueue(JSON.stringify({ error: "planning failed — try again" }));
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function planPayload(
  account: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const budget = Number(body.budget);
  const meals = Array.isArray(body.meals)
    ? (body.meals.filter((m) => typeof m === "string" && MEAL_TYPES.has(m)) as MealType[])
    : undefined;

  const num = (v: unknown): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };

  const outcome = await runWithAccount(account, () =>
    runPlanWeek({
      budget,
      people: num(body.people),
      days: num(body.days) ? Math.min(14, Math.round(num(body.days) as number)) : undefined,
      meals,
      kcalPerPersonPerDay: num(body.kcalPerPersonPerDay),
      proteinPerPersonPerDay: num(body.proteinPerPersonPerDay),
      kcalPerPerson: Array.isArray(body.kcalPerPerson)
        ? (body.kcalPerPerson.map(Number).filter((n) => Number.isFinite(n) && n > 0) as number[])
        : undefined,
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
      // Hard store-radius: clamp to something a human actually drives.
      radiusKm: num(body.radiusKm)
        ? Math.min(25, Math.max(1, num(body.radiusKm) as number))
        : undefined,
      ai: body.ai === true,
      wishes:
        typeof body.wishes === "string" && body.wishes.trim() !== ""
          ? body.wishes.slice(0, 2000)
          : undefined,
    }),
  );

  if (!outcome.ok) {
    return { error: outcome.error };
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

  return {
    account,
    currency: outcome.currency,
    result: outcome.result,
    nearestByChain: nearest,
    resolvedLocation: outcome.nearby?.origin.label ?? null,
    ai: outcome.ai,
  };
}

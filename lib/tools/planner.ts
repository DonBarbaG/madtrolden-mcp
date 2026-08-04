// plan_week — budget-capped week planning with optional kcal targets (§6.1).

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BASELINE_NOTE } from "../baseline";
import { type NearbyStores, REGIONAL_FLYER_CAVEAT } from "../location";
import { NUTRITION_ATTRIBUTION } from "../nutrition";
import { runPlanWeek } from "../plan-service";
import { MEAL_KCAL_SHARE, type MealType, type PlanResult } from "../planner";
import { errorResult } from "./shared";

function formatDays(result: PlanResult, currency: string): string[] {
  const lines: string[] = ["## Ugeplan"];
  for (const day of result.days) {
    const parts = day.meals.map((m) => {
      const r = m.recipe;
      const kcal = r.nutrition.perServing ? ` · ~${r.nutrition.perServing.kcal} kcal/pers` : "";
      const leftover = m.leftover ? ` (rester fra dag ${m.cookedOnDay})` : "";
      return `${m.mealType}: ${r.scored.name}${leftover} (~${Math.round(r.fullCost)} ${currency}${kcal})`;
    });
    const dayKcal =
      day.kcalPerPerson !== null ? ` — dag i alt ~${day.kcalPerPerson} kcal/pers` : "";
    lines.push(`Dag ${day.day}: ${parts.join(" · ")}${dayKcal}`);
  }
  return lines;
}

function formatCookSchedule(result: PlanResult): string[] {
  if (!result.cookSchedule || result.cookSchedule.length === 0) return [];
  const lines = ["\n## Madlavningsplan (batch-dage)"];
  const byDay = new Map<number, typeof result.cookSchedule>();
  for (const block of result.cookSchedule) {
    const list = byDay.get(block.day) ?? [];
    list.push(block);
    byDay.set(block.day, list);
  }
  for (const [day, blocks] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
    for (const b of blocks) {
      const coverText =
        b.covers.length > 1
          ? `${b.mealType} dag ${b.covers.join("/")}`
          : `${b.mealType} dag ${b.covers[0]}`;
      lines.push(`Dag ${day}: lav ${b.portions} portioner ${b.recipeName} — ${coverText}`);
    }
  }
  return lines;
}

function formatShoppingByStore(
  result: PlanResult,
  currency: string,
  nearby?: NearbyStores | null,
): string[] {
  const byStore = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const day of result.days) {
    for (const meal of day.meals) {
      for (const ing of meal.recipe.scored.ingredients) {
        if (!ing.bestDeal) continue;
        const key = `${ing.bestDeal.store}|${ing.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const list = byStore.get(ing.bestDeal.store) ?? [];
        list.push(
          `- ${ing.name} (${ing.quantity}): ${ing.bestDeal.heading} — ~${Math.round(ing.bestDeal.price)} ${currency}${ing.confidence === "low" ? " [tjek matchet]" : ""}`,
        );
        byStore.set(ing.bestDeal.store, list);
      }
    }
  }
  const lines: string[] = ["\n## Indkøbsliste (tilbudsvarer, pr. butik)"];
  if (byStore.size === 0) lines.push("(ingen tilbudsvarer matchet i denne plan)");
  for (const [storeName, items] of [...byStore.entries()].sort()) {
    const branch = nearby?.nearestByChain.get(storeName);
    const branchNote = branch
      ? ` — nærmeste: ${branch.name || branch.street}, ${branch.street}, ${branch.zip} ${branch.city} (${branch.distanceKm} km)`
      : "";
    lines.push(`\n### ${storeName}${branchNote}`);
    lines.push(...items.sort());
  }
  if (nearby) {
    lines.push(`\n_${REGIONAL_FLYER_CAVEAT}_`);
  }
  if (result.baseline.lines.length > 0) {
    lines.push(`\n### Basisvarer (estimeret — intet aktuelt tilbud)`);
    for (const line of result.baseline.lines) {
      lines.push(
        `- ${line.item.name}: ${line.packs} × ${line.item.packSize}${line.item.unit} ≈ ${line.cost} ${currency}`,
      );
    }
  }
  return lines;
}

function formatTotals(result: PlanResult, currency: string): string[] {
  const lines = [
    `\n## Total (estimeret kassebon)`,
    `Tilbudsvarer: ${result.dealTotal} ${currency}`,
    `Estimerede basisvarer: ~${result.baseline.total} ${currency}`,
    `**I alt: ~${result.grandTotal} ${currency} (budget: ${result.budget} ${currency})**`,
  ];
  if (result.feasible) {
    lines.push(
      `✅ Inden for budget (${Math.round(result.budget - result.grandTotal)} ${currency} til overs).`,
    );
  } else {
    lines.push(
      `⚠️ BUDGET OVERSKREDET med ~${Math.ceil(result.budgetGap)} ${currency} — dette er den billigste gyldige plan. Forslag: ${result.relaxSuggestions.join("; ")}.`,
    );
  }
  return lines;
}

function formatKcal(result: PlanResult): string[] {
  const k = result.kcal;
  if (k.target === null) return [];
  const lines = [`\n## Kalorier`];
  lines.push(
    `Mål: ${k.target} kcal/person/dag; planlagte måltider dækker ~${Math.round(((k.effectiveTarget ?? 0) / k.target) * 100)}% af dagen → deleffektivt mål ${k.effectiveTarget} kcal.`,
  );
  if (k.avgPerDay !== null) {
    lines.push(`Planen giver i snit ~${k.avgPerDay} kcal/person/dag fra de planlagte måltider.`);
    lines.push(
      k.withinTolerance
        ? "✅ Inden for ±10% af det deleffektive mål."
        : `⚠️ Uden for ±10%-tolerancen (afvigelse ${Math.abs((k.avgPerDay ?? 0) - (k.effectiveTarget ?? 0))} kcal).`,
    );
  } else {
    lines.push("⚠️ Ingen af opskrifterne kunne kalorie-beregnes.");
  }
  if (k.portioning && k.portioning.length > 0) {
    lines.push("Individuelle portioner (fælles retter, forskellig portionsstørrelse):");
    for (const p of k.portioning) {
      lines.push(
        `- Person ${p.person}: mål ${p.targetKcal} kcal/dag → tag ${p.factor} portion${p.avgKcalPerDay !== null ? ` (~${p.avgKcalPerDay} kcal/dag fra de planlagte måltider)` : ""}`,
      );
    }
  }
  if (k.unscoredIngredients.length > 0) {
    lines.push(
      `Ikke-beregnede ingredienser (tæller 0 kcal — tallene er derfor minimumstal): ${k.unscoredIngredients.join(", ")}`,
    );
  }
  return lines;
}

export function formatPlanResult(
  result: PlanResult,
  currency: string,
  nearby?: NearbyStores | null,
): string {
  const noteLines =
    result.notes.length > 0 ? ["\n## Bemærk", ...result.notes.map((n) => `- ${n}`)] : [];
  return [
    ...formatDays(result, currency),
    ...formatCookSchedule(result),
    ...noteLines,
    ...formatKcal(result),
    ...formatShoppingByStore(result, currency, nearby),
    ...formatTotals(result, currency),
    `\n_${BASELINE_NOTE}_`,
    `_${NUTRITION_ATTRIBUTION}_`,
  ].join("\n");
}

export function registerPlannerTools(server: McpServer): void {
  server.tool(
    "plan_week",
    "Plan a week of meals under a HARD budget cap (DKK), optimized around live Danish grocery deals, with optional kcal targets per person. Totals = deal items + estimated staples (labeled). If the budget is infeasible, returns the cheapest valid plan, the gap in kr, and what to relax — it never silently blows the cap. USE WHEN: 'feed 2 people for 400 kr this week', budget meal planning, kcal-aware planning. NOT FOR: quick deal lookups (search_deals) or plain no-budget planning (plan_and_shop).",
    {
      budget: z.number().positive().describe("Hard cap on the estimated register total, in DKK"),
      people: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Number of people (defaults to household size)"),
      days: z
        .number()
        .int()
        .min(1)
        .max(14)
        .optional()
        .default(7)
        .describe("Days to plan (default 7)"),
      meals: z
        .array(z.enum(["breakfast", "lunch", "dinner"]))
        .optional()
        .default(["dinner"])
        .describe(
          "Which meals to plan (default dinner only; breakfast/lunch need recipes with those meal types)",
        ),
      kcal_per_person_per_day: z
        .number()
        .positive()
        .optional()
        .describe(
          "Daily kcal target per person (whole day). The planner scales it by the share of the day the planned meals cover (breakfast 25% / lunch 35% / dinner 40%), ±10% tolerance.",
        ),
      kcal_per_person: z
        .array(z.number().positive())
        .optional()
        .describe(
          "Individual kcal targets, one per person (e.g. [2500, 1800]). Meals are shared; the plan reports per-person portion factors. Overrides kcal_per_person_per_day.",
        ),
      excludeProteins: z
        .array(z.string())
        .optional()
        .describe(
          'Dietary exclusions, same system as score_recipes: pork, beef, lamb, fish, shellfish, dairy, gluten, beans, nuts, egg. "vegetarian" = exclude pork, beef, lamb, fish, shellfish.',
        ),
      max_cook_minutes: z
        .number()
        .positive()
        .optional()
        .describe("Skip slow recipes when under ~45 min; skip medium too when under ~25 min"),
      meal_prep: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Batch-cook mode: consolidate cooking onto 1-2 cook days (default day 1 + 4), prefer batchable recipes, scale portions so leftovers cover following days, and schedule every leftover portion as a real meal.",
        ),
      cook_days: z
        .array(z.number().int().min(1))
        .optional()
        .describe("1-indexed cook days for meal_prep (default [1, 4], e.g. Sunday + Wednesday)"),
      location: z
        .string()
        .optional()
        .describe(
          'Danish address or "lat,lng" — chains with a branch within radius_km rank higher, and the shopping list shows the nearest branch per store',
        ),
      radius_km: z
        .number()
        .positive()
        .max(25)
        .optional()
        .default(3)
        .describe("Radius for location-aware ranking (default 3 km)"),
      maxPerProtein: z.number().int().positive().optional().default(2),
      maxPerCuisine: z.number().int().positive().optional().default(2),
      maxSlowDays: z.number().int().min(0).optional().default(2),
      ai: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Let the server-side AI (GPT) compose the week with real judgment and audit deal matches; all totals are re-verified deterministically. Falls back to the deterministic planner with a note on any failure.",
        ),
      wishes: z
        .string()
        .optional()
        .describe(
          'Free-text wishes for the AI planner, e.g. "mere fisk, ingen supper, nem hverdagsmad"',
        ),
    },
    async ({
      budget,
      people,
      days,
      meals,
      kcal_per_person_per_day,
      kcal_per_person,
      excludeProteins,
      max_cook_minutes,
      meal_prep,
      cook_days,
      location,
      radius_km,
      maxPerProtein,
      maxPerCuisine,
      maxSlowDays,
      ai,
      wishes,
    }) => {
      try {
        const outcome = await runPlanWeek({
          ai,
          wishes,
          budget,
          people,
          days,
          meals: meals as MealType[],
          kcalPerPersonPerDay: kcal_per_person_per_day,
          kcalPerPerson: kcal_per_person,
          excludeProteins,
          maxCookMinutes: max_cook_minutes,
          mealPrep: meal_prep,
          cookDays: cook_days,
          location,
          radiusKm: radius_km,
          maxPerProtein,
          maxPerCuisine,
          maxSlowDays,
        });

        if (!outcome.ok) {
          const share = (meals as MealType[]).reduce((s, m) => s + (MEAL_KCAL_SHARE[m] ?? 0), 0);
          return errorResult(
            `${outcome.error} (Planned meals would cover ~${Math.round(share * 100)}% of daily kcal.)`,
          );
        }

        const text = formatPlanResult(outcome.result, outcome.currency, outcome.nearby);
        const locationNote =
          location && !outcome.nearby
            ? `\n\n⚠️ Kunne ikke finde "${location}" — planen er lavet uden lokations-boost.`
            : "";
        let aiSection = "";
        if (outcome.ai?.used) {
          const parts = [`\n\n## AI-planlægning (${outcome.ai.model ?? "gpt"})`];
          if (outcome.ai.reasoning) parts.push(outcome.ai.reasoning);
          if (outcome.ai.tips?.length) parts.push(`Tips: ${outcome.ai.tips.join(" · ")}`);
          if (outcome.ai.rejectedDeals?.length) {
            parts.push(
              `Afviste tilbudsmatch: ${outcome.ai.rejectedDeals.map((r) => `${r.ingredient} i ${r.recipe} (${r.reason})`).join("; ")}`,
            );
          }
          parts.push("Alle beløb er efterregnet deterministisk — AI'en vælger, koden reviderer.");
          aiSection = parts.join("\n");
        }
        return {
          content: [{ type: "text" as const, text: text + aiSection + locationNote }],
        };
      } catch (err) {
        return errorResult(`Failed to plan week: ${err instanceof Error ? err.message : err}`);
      }
    },
  );
}

// plan_week — budget-capped week planning with optional kcal targets (§6.1).

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BASELINE_NOTE } from "../baseline";
import { getLocale } from "../locales";
import { NUTRITION_ATTRIBUTION } from "../nutrition";
import {
  type EnrichedRecipe,
  enrichRecipes,
  MEAL_KCAL_SHARE,
  type MealType,
  type PlanResult,
  planWeek,
} from "../planner";
import * as store from "../store";
import { scoreAllRecipes } from "./scoring";
import { errorResult } from "./shared";

function formatDays(result: PlanResult, currency: string): string[] {
  const lines: string[] = ["## Ugeplan"];
  for (const day of result.days) {
    const parts = day.meals.map((m) => {
      const r = m.recipe;
      const kcal = r.nutrition.perServing ? ` · ~${r.nutrition.perServing.kcal} kcal/pers` : "";
      return `${m.mealType}: ${r.scored.name} (~${Math.round(r.fullCost)} ${currency}${kcal})`;
    });
    const dayKcal =
      day.kcalPerPerson !== null ? ` — dag i alt ~${day.kcalPerPerson} kcal/pers` : "";
    lines.push(`Dag ${day.day}: ${parts.join(" · ")}${dayKcal}`);
  }
  return lines;
}

function formatShoppingByStore(result: PlanResult, currency: string): string[] {
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
    lines.push(`\n### ${storeName}`);
    lines.push(...items.sort());
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
  if (k.unscoredIngredients.length > 0) {
    lines.push(
      `Ikke-beregnede ingredienser (tæller 0 kcal — tallene er derfor minimumstal): ${k.unscoredIngredients.join(", ")}`,
    );
  }
  return lines;
}

export function formatPlanResult(result: PlanResult, currency: string): string {
  const noteLines =
    result.notes.length > 0 ? ["\n## Bemærk", ...result.notes.map((n) => `- ${n}`)] : [];
  return [
    ...formatDays(result, currency),
    ...noteLines,
    ...formatKcal(result),
    ...formatShoppingByStore(result, currency),
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
      maxPerProtein: z.number().int().positive().optional().default(2),
      maxPerCuisine: z.number().int().positive().optional().default(2),
      maxSlowDays: z.number().int().min(0).optional().default(2),
    },
    async ({
      budget,
      people,
      days,
      meals,
      kcal_per_person_per_day,
      excludeProteins,
      max_cook_minutes,
      maxPerProtein,
      maxPerCuisine,
      maxSlowDays,
    }) => {
      try {
        const household = await store.getHousehold();
        const locale = getLocale(household.country);
        const pantry = await store.getPantry();
        const pantrySet = new Set(pantry.map((p) => p.toLowerCase()));
        const preferredStores = new Set(household.stores.map((s) => s.name));
        const householdSize = people ?? (household.people.length || household.defaultServings);

        // "vegetarian" shorthand expands to the concrete exclusion tags.
        let exclusions = excludeProteins;
        if (exclusions?.some((e) => e.toLowerCase() === "vegetarian")) {
          exclusions = [
            ...new Set([
              ...exclusions.filter((e) => e.toLowerCase() !== "vegetarian"),
              "pork",
              "beef",
              "lamb",
              "fish",
              "shellfish",
              "chicken",
            ]),
          ];
        }

        const recipes = await store.getRecipes();
        const { scored } = await scoreAllRecipes(preferredStores, pantrySet, householdSize, locale);
        let pool: EnrichedRecipe[] = enrichRecipes(scored, recipes, householdSize, pantrySet);

        if (max_cook_minutes !== undefined) {
          pool = pool.filter((e) => {
            if (max_cook_minutes < 25) return e.scored.complexity === "quick";
            if (max_cook_minutes < 45) return e.scored.complexity !== "slow";
            return true;
          });
        }

        const mealTypes = meals as MealType[];
        const result = planWeek(pool, {
          budget,
          people: householdSize,
          days,
          meals: mealTypes,
          kcalPerPersonPerDay: kcal_per_person_per_day,
          constraints: {
            maxPerProtein,
            maxPerCuisine,
            maxSlowDays,
            excludeProteins: exclusions,
            ingredientTags: locale.ingredientTags,
          },
        });

        if (result === null) {
          const share = mealTypes.reduce((s, m) => s + (MEAL_KCAL_SHARE[m] ?? 0), 0);
          return errorResult(
            `Not enough eligible recipes for ${days} day(s) × ${mealTypes.length} meal(s) after applying exclusions/time limits. ` +
              `Add more recipes (add_recipe), relax exclusions, or plan fewer days. ` +
              `(Planned meals would cover ~${Math.round(share * 100)}% of daily kcal.)`,
          );
        }

        return {
          content: [{ type: "text" as const, text: formatPlanResult(result, locale.currency) }],
        };
      } catch (err) {
        return errorResult(`Failed to plan week: ${err instanceof Error ? err.message : err}`);
      }
    },
  );
}

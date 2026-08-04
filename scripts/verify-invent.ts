// One-shot live verification of AI-invent mode (Ludwig's exact scenario that
// used to fail with "Not enough eligible recipes"). Run: npx tsx scripts/verify-invent.ts
import { runPlanWeek } from "../lib/plan-service";

async function main() {
  const outcome = await runPlanWeek({
    budget: 375,
    people: 1,
    days: 7,
    meals: ["breakfast", "lunch", "dinner"],
    kcalPerPersonPerDay: 1850,
    proteinPerPersonPerDay: 90,
    excludeProteins: ["vegetarian", "gluten", "dairy"],
    ai: true,
    wishes:
      "elsker at lave mad. har cancer. vejer meget lidt. mangler en tolvfingertarm post surgery. så vegetarisk skånekost.",
  });

  if (!outcome.ok) {
    console.log("FAILED:", outcome.error);
    process.exit(1);
  }
  const r = outcome.result;
  console.log(
    "feasible:",
    r.feasible,
    "| grandTotal:",
    r.grandTotal,
    "kr | budget:",
    r.budget,
    "| gap:",
    r.budgetGap,
  );
  console.log("kcal avg/day:", r.kcal.avgPerDay, "target(effective):", r.kcal.effectiveTarget);
  console.log(
    "protein avg/day:",
    r.protein.avgPerDay,
    "g, target(effective):",
    r.protein.effectiveTarget,
    "g",
  );
  console.log(
    "maybe-bucket:",
    r.maybe?.lines.map((l) => `${l.name}~${l.estimate ?? "?"}`).join(", ") || "(tom)",
    "| total",
    r.maybe?.total ?? 0,
  );
  console.log(
    "ai:",
    outcome.ai?.used,
    outcome.ai?.model,
    "|",
    outcome.ai?.reasoning?.slice(0, 200),
  );
  for (const d of r.days) {
    console.log(
      `dag ${d.day}: ${d.meals.map((m) => `${m.mealType}=${m.recipe.scored.name}${m.leftover ? " (rest)" : ""} ~${Math.round(m.recipe.fullCost)}kr`).join(" | ")}`,
    );
  }
  if (r.notes.length) console.log("noter:", r.notes.join(" · "));
}

main();

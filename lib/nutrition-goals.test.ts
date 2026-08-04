/**
 * Unit tests for lib/nutrition-goals.ts — the quick daily-needs estimator
 * (Mifflin-St Jeor + activity factor + goal delta, protein by g/kg).
 */

import { describe, expect, it } from "vitest";
import { estimateDailyNeeds } from "./nutrition-goals";

describe("estimateDailyNeeds", () => {
  it("computes Mifflin-St Jeor for a reference male", () => {
    // 80 kg, 180 cm, 30 y male: BMR = 800 + 1125 - 150 + 5 = 1780
    const r = estimateDailyNeeds({
      weightKg: 80,
      heightCm: 180,
      age: 30,
      sex: "male",
      activity: "sedentary",
      goal: "maintain",
    });
    expect(r?.bmr).toBe(1780);
    expect(r?.kcal).toBe(Math.round(1780 * 1.2));
    expect(r?.proteinG).toBe(Math.round(80 * 1.4));
  });

  it("computes the female offset and goal deltas", () => {
    // 60 kg, 165 cm, 25 y female: BMR = 600 + 1031.25 - 125 - 161 = 1345.25
    const maintain = estimateDailyNeeds({
      weightKg: 60,
      heightCm: 165,
      age: 25,
      sex: "female",
      activity: "moderate",
      goal: "maintain",
    });
    const gain = estimateDailyNeeds({
      weightKg: 60,
      heightCm: 165,
      age: 25,
      sex: "female",
      activity: "moderate",
      goal: "gain",
    });
    expect(maintain?.bmr).toBe(1345);
    expect((gain?.kcal ?? 0) - (maintain?.kcal ?? 0)).toBe(500);
    expect(gain?.proteinG).toBe(Math.round(60 * 1.8));
  });

  it("never estimates below the planning floor", () => {
    const r = estimateDailyNeeds({
      weightKg: 40,
      heightCm: 150,
      age: 80,
      sex: "female",
      activity: "sedentary",
      goal: "lose",
    });
    expect(r?.kcal).toBeGreaterThanOrEqual(1200);
  });

  it("returns null on missing or nonsense metrics", () => {
    expect(
      estimateDailyNeeds({
        weightKg: Number.NaN,
        heightCm: 180,
        age: 30,
        sex: "male",
        activity: "light",
        goal: "maintain",
      }),
    ).toBeNull();
    expect(
      estimateDailyNeeds({
        weightKg: 0,
        heightCm: 180,
        age: 30,
        sex: "male",
        activity: "light",
        goal: "maintain",
      }),
    ).toBeNull();
  });
});

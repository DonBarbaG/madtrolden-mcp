// Quick daily-needs estimator (atom, pure — runs client-side in the UI and
// is unit-tested server-side). Mifflin-St Jeor BMR × activity factor, plus a
// goal adjustment; protein target in g/kg by goal. Estimates for healthy
// adults — the UI says so and everything stays editable.

export type Sex = "male" | "female";
export type Activity = "sedentary" | "light" | "moderate" | "active" | "athlete";
export type Goal = "lose" | "maintain" | "gain";

export interface Metrics {
  weightKg: number;
  heightCm: number;
  age: number;
  sex: Sex;
  activity: Activity;
  goal: Goal;
}

export const ACTIVITY_FACTORS: Record<Activity, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  athlete: 1.9,
};

/** Daily kcal adjustment per goal (gentle, sustainable defaults). */
export const GOAL_KCAL_DELTA: Record<Goal, number> = {
  lose: -400,
  maintain: 0,
  gain: 500,
};

/** Protein target in g per kg bodyweight per goal. */
export const GOAL_PROTEIN_G_PER_KG: Record<Goal, number> = {
  lose: 2.0,
  maintain: 1.4,
  gain: 1.8,
};

/** Never estimate below this — a planning floor, not medical advice. */
const KCAL_FLOOR = 1200;

export interface DailyNeeds {
  kcal: number;
  proteinG: number;
  bmr: number;
}

export function estimateDailyNeeds(m: Metrics): DailyNeeds | null {
  if (
    !Number.isFinite(m.weightKg) ||
    m.weightKg <= 0 ||
    !Number.isFinite(m.heightCm) ||
    m.heightCm <= 0 ||
    !Number.isFinite(m.age) ||
    m.age <= 0
  ) {
    return null;
  }
  const bmr = 10 * m.weightKg + 6.25 * m.heightCm - 5 * m.age + (m.sex === "male" ? 5 : -161);
  const maintenance = bmr * ACTIVITY_FACTORS[m.activity];
  const kcal = Math.max(KCAL_FLOOR, Math.round(maintenance + GOAL_KCAL_DELTA[m.goal]));
  const proteinG = Math.round(m.weightKg * GOAL_PROTEIN_G_PER_KG[m.goal]);
  return { kcal, proteinG, bmr: Math.round(bmr) };
}

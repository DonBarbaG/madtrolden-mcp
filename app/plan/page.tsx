"use client";

// Private planner UI: key-gated, fog-styled, prints to PDF.
// The key is the same personal access key as the MCP connector; it lives in
// localStorage on Ludwig's own machine and is sent as a Bearer header.

import { useCallback, useEffect, useState } from "react";
import { type Activity, estimateDailyNeeds, type Goal, type Sex } from "@/lib/nutrition-goals";

type MealType = "breakfast" | "lunch" | "dinner";

interface PlannedMealJson {
  mealType: MealType;
  leftover: boolean;
  cookedOnDay: number;
  recipe: {
    fullCost: number;
    scored: { name: string };
    nutrition: { perServing: { kcal: number } | null; unscored: string[] };
  };
}

interface PlanJson {
  account: string;
  currency: string;
  resolvedLocation: string | null;
  nearestByChain: Record<
    string,
    { name: string; street: string; zip: string; city: string; distanceKm: number }
  > | null;
  result: {
    feasible: boolean;
    grandTotal: number;
    dealTotal: number;
    budget: number;
    budgetGap: number;
    baseline: {
      total: number;
      lines: Array<{
        item: { name: string; packSize: number; unit: string };
        packs: number;
        cost: number;
      }>;
    };
    days: Array<{ day: number; kcalPerPerson: number | null; meals: PlannedMealJson[] }>;
    kcal: {
      target: number | null;
      effectiveTarget: number | null;
      avgPerDay: number | null;
      withinTolerance: boolean | null;
      unscoredIngredients: string[];
      portioning?: Array<{
        person: number;
        targetKcal: number;
        factor: number;
        avgKcalPerDay: number | null;
      }>;
    };
    protein?: {
      target: number | null;
      effectiveTarget: number | null;
      avgPerDay: number | null;
    };
    notes: string[];
    relaxSuggestions: string[];
    maybe?: {
      lines: Array<{ name: string; estimate: number | null }>;
      total: number;
    };
    cookSchedule?: Array<{
      day: number;
      mealType: MealType;
      recipeName: string;
      portions: number;
      covers: number[];
    }>;
  };
  ai: {
    used: boolean;
    model?: string;
    reasoning?: string;
    tips?: string[];
    rejectedDeals?: Array<{ recipe: string; ingredient: string; reason: string }>;
    error?: string;
  } | null;
  shoppingByStore?: never;
}

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "morgenmad",
  lunch: "frokost",
  dinner: "aftensmad",
};

const DIET_OPTIONS = [
  { key: "vegetarian", label: "vegetarisk" },
  { key: "pork", label: "uden svinekød" },
  { key: "beef", label: "uden oksekød" },
  { key: "fish", label: "uden fisk" },
  { key: "gluten", label: "uden gluten" },
  { key: "dairy", label: "uden mejeriprodukter" },
];

export default function PlanPage() {
  const [key, setKey] = useState("");
  const [account, setAccount] = useState<string | null>(null);
  const [loginError, setLoginError] = useState("");
  const [checking, setChecking] = useState(true);

  const [budget, setBudget] = useState("500");
  const [people, setPeople] = useState("2");
  const [days, setDays] = useState("7");
  const [meals, setMeals] = useState<MealType[]>(["dinner"]);
  const [kcalPerPerson, setKcalPerPerson] = useState<string[]>(["", ""]);
  const [protein, setProtein] = useState("");
  // Quick daily-needs calculator — everything computes locally in the
  // browser; only the resulting kcal/protein targets ever hit the server.
  const [needCalc, setNeedCalc] = useState(false);
  const [calcWeight, setCalcWeight] = useState("");
  const [calcHeight, setCalcHeight] = useState("");
  const [calcAge, setCalcAge] = useState("");
  const [calcSex, setCalcSex] = useState<Sex>("female");
  const [calcActivity, setCalcActivity] = useState<Activity>("light");
  const [calcGoal, setCalcGoal] = useState<Goal>("maintain");
  const [diet, setDiet] = useState<string[]>([]);
  const [mealPrep, setMealPrep] = useState(false);
  const [location, setLocation] = useState("");
  const [useAi, setUseAi] = useState(true);
  const [wishes, setWishes] = useState("");

  const [loading, setLoading] = useState(false);
  const [planError, setPlanError] = useState("");
  const [plan, setPlan] = useState<PlanJson | null>(null);

  const tryLogin = useCallback(async (candidate: string): Promise<boolean> => {
    const res = await fetch("/api/plan", {
      headers: { authorization: `Bearer ${candidate}` },
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { account: string };
    setAccount(data.account);
    return true;
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem("madtrolden-key");
    if (!saved) {
      setChecking(false);
      return;
    }
    setKey(saved);
    tryLogin(saved).finally(() => setChecking(false));
  }, [tryLogin]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError("");
    const ok = await tryLogin(key.trim());
    if (ok) {
      window.localStorage.setItem("madtrolden-key", key.trim());
    } else {
      setLoginError("forkert kodeord — prøv igen");
    }
  }

  function logout() {
    window.localStorage.removeItem("madtrolden-key");
    setAccount(null);
    setKey("");
    setPlan(null);
  }

  function toggleMeal(m: MealType) {
    setMeals((prev) => {
      const next = prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m];
      const order: MealType[] = ["breakfast", "lunch", "dinner"];
      return order.filter((x) => next.includes(x));
    });
  }

  function toggleDiet(d: string) {
    setDiet((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }

  const calcResult = estimateDailyNeeds({
    weightKg: Number(calcWeight),
    heightCm: Number(calcHeight),
    age: Number(calcAge),
    sex: calcSex,
    activity: calcActivity,
    goal: calcGoal,
  });

  function applyCalcResult() {
    if (!calcResult) return;
    // Fill the first empty kcal field (or person 1 if all are set) + protein.
    setKcalPerPerson((prev) => {
      const target = prev.findIndex((v) => v.trim() === "");
      const i = target === -1 ? 0 : target;
      return prev.map((v, j) => (j === i ? String(calcResult.kcal) : v));
    });
    setProtein(String(calcResult.proteinG));
  }

  // One kcal field per person; the list follows the "personer" count.
  const peopleCount = Math.max(1, Math.min(8, Number(people) || 1));
  useEffect(() => {
    setKcalPerPerson((prev) => {
      if (prev.length === peopleCount) return prev;
      return Array.from({ length: peopleCount }, (_, i) => prev[i] ?? "");
    });
  }, [peopleCount]);

  async function handlePlan(e: React.FormEvent) {
    e.preventDefault();
    if (meals.length === 0) {
      setPlanError("vælg mindst ét måltid");
      return;
    }
    setLoading(true);
    setPlanError("");
    setPlan(null);
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: {
          authorization: `Bearer ${key.trim()}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          budget: Number(budget),
          people: Number(people) || undefined,
          days: Number(days) || undefined,
          meals,
          kcalPerPerson: kcalPerPerson.some((k) => k.trim() !== "")
            ? kcalPerPerson.map((k) => Number(k) || 0).filter((n) => n > 0)
            : undefined,
          proteinPerPersonPerDay: Number(protein) > 0 ? Number(protein) : undefined,
          excludeProteins: diet.length > 0 ? diet : undefined,
          mealPrep,
          location: location.trim() || undefined,
          ai: useAi,
          wishes: wishes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        let msg = `fejl (${res.status})`;
        try {
          const data = await res.json();
          if (data?.error) msg = String(data.error);
        } catch {
          if (res.status === 504) msg = "serveren brugte for lang tid — prøv igen (evt. uden ai)";
        }
        setPlanError(msg);
        return;
      }
      setPlan((await res.json()) as PlanJson);
    } catch {
      setPlanError("mistede forbindelsen til serveren undervejs — prøv igen");
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <main className="plan-wrap">
        <p className="meta">åbner…</p>
      </main>
    );
  }

  if (!account) {
    return (
      <main className="plan-wrap" style={{ maxWidth: 420 }}>
        <h1 style={{ fontWeight: 500, fontSize: 22 }}>madtrolden 🧌</h1>
        <p className="meta">privat planlægger — kun med kodeord</p>
        <hr className="rule" />
        <form onSubmit={handleLogin} className="field">
          <label htmlFor="key">kodeord</label>
          <input
            id="key"
            className="input"
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="troll_…"
            autoComplete="current-password"
          />
          <div style={{ marginTop: 10 }}>
            <button type="submit" className="btn">
              log ind
            </button>
          </div>
          {loginError && <p className="err">{loginError}</p>}
        </form>
      </main>
    );
  }

  const r = plan?.result;

  return (
    <main className="plan-wrap">
      <header
        className="no-print"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}
      >
        <div>
          <h1 style={{ fontWeight: 500, fontSize: 22, marginBottom: 2 }}>madtrolden 🧌</h1>
          <p className="meta">logget ind som {account}</p>
        </div>
        <button type="button" className="btn-ghost btn" onClick={logout}>
          log ud
        </button>
      </header>

      <form onSubmit={handlePlan} className="no-print">
        <hr className="rule" />

        <div
          className="card"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div>
            <p style={{ margin: 0, fontWeight: 500 }}>ai-planlægning</p>
            <p className="meta" style={{ margin: "2px 0 0" }}>
              gpt opfinder ugens retter ud fra de faktiske tilbud — billigst muligt, hårdt
              budgetloft. alle beløb efterregnes.
            </p>
          </div>
          <button
            type="button"
            className="chip"
            data-on={useAi}
            onClick={() => setUseAi((v) => !v)}
          >
            {useAi ? "til" : "fra"}
          </button>
        </div>

        {useAi && (
          <div style={{ marginTop: 14 }} className="field">
            <label htmlFor="wishes">ønsker til ai&apos;en (fritekst, valgfrit)</label>
            <input
              id="wishes"
              className="input"
              value={wishes}
              onChange={(e) => setWishes(e.target.value)}
              placeholder="fx mere fisk, ingen supper, nem hverdagsmad man-tors"
            />
          </div>
        )}

        <hr className="rule" />
        <div className="grid-3">
          <div className="field">
            <label htmlFor="budget">budget (kr, hårdt loft)</label>
            <input
              id="budget"
              className="input"
              inputMode="numeric"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="people">personer</label>
            <input
              id="people"
              className="input"
              inputMode="numeric"
              value={people}
              onChange={(e) => setPeople(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="days">dage</label>
            <input
              id="days"
              className="input"
              inputMode="numeric"
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </div>
        </div>

        <div style={{ marginTop: 16 }} className="field">
          <span className="field-label">måltider</span>
          <div className="chip-row">
            {(Object.keys(MEAL_LABELS) as MealType[]).map((m) => (
              <button
                key={m}
                type="button"
                className="chip"
                data-on={meals.includes(m)}
                onClick={() => toggleMeal(m)}
              >
                {MEAL_LABELS[m]}
              </button>
            ))}
            <button
              type="button"
              className="chip"
              data-on={mealPrep}
              onClick={() => setMealPrep((v) => !v)}
            >
              meal prep (2 madlavningsdage)
            </button>
          </div>
        </div>

        <div style={{ marginTop: 16 }} className="field">
          <span className="field-label">kost</span>
          <div className="chip-row">
            {DIET_OPTIONS.map((d) => (
              <button
                key={d.key}
                type="button"
                className="chip"
                data-on={diet.includes(d.key)}
                onClick={() => toggleDiet(d.key)}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 16 }} className="field">
          <span className="field-label">
            næring (valgfrit) — kender du dine mål, eller skal vi lige regne dem?
          </span>
          <div className="chip-row">
            <button
              type="button"
              className="chip"
              data-on={!needCalc}
              onClick={() => setNeedCalc(false)}
            >
              jeg kender mine mål
            </button>
            <button
              type="button"
              className="chip"
              data-on={needCalc}
              onClick={() => setNeedCalc(true)}
            >
              hurtig beregner
            </button>
          </div>
          {needCalc && (
            <div className="card" style={{ marginTop: 10 }}>
              <div className="chip-row">
                <input
                  className="input"
                  style={{ width: 110 }}
                  inputMode="numeric"
                  value={calcWeight}
                  onChange={(e) => setCalcWeight(e.target.value)}
                  placeholder="vægt kg"
                  aria-label="vægt i kg"
                />
                <input
                  className="input"
                  style={{ width: 110 }}
                  inputMode="numeric"
                  value={calcHeight}
                  onChange={(e) => setCalcHeight(e.target.value)}
                  placeholder="højde cm"
                  aria-label="højde i cm"
                />
                <input
                  className="input"
                  style={{ width: 90 }}
                  inputMode="numeric"
                  value={calcAge}
                  onChange={(e) => setCalcAge(e.target.value)}
                  placeholder="alder"
                  aria-label="alder"
                />
              </div>
              <div className="chip-row" style={{ marginTop: 8 }}>
                {(
                  [
                    ["female", "kvinde"],
                    ["male", "mand"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className="chip"
                    data-on={calcSex === value}
                    onClick={() => setCalcSex(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="chip-row" style={{ marginTop: 8 }}>
                {(
                  [
                    ["sedentary", "stillesiddende"],
                    ["light", "let aktiv"],
                    ["moderate", "moderat"],
                    ["active", "meget aktiv"],
                    ["athlete", "atlet"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className="chip"
                    data-on={calcActivity === value}
                    onClick={() => setCalcActivity(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="chip-row" style={{ marginTop: 8 }}>
                {(
                  [
                    ["lose", "tabe mig"],
                    ["maintain", "holde vægt"],
                    ["gain", "tage på"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className="chip"
                    data-on={calcGoal === value}
                    onClick={() => setCalcGoal(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {calcResult ? (
                <p style={{ margin: "10px 0 0" }}>
                  ≈ {calcResult.kcal} kcal/dag · {calcResult.proteinG} g protein/dag{" "}
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ marginLeft: 8 }}
                    onClick={applyCalcResult}
                  >
                    brug tallene
                  </button>
                </p>
              ) : (
                <p className="meta" style={{ margin: "10px 0 0" }}>
                  udfyld vægt, højde og alder — vi regner lokalt i din browser, kun målene sendes
                  med planen
                </p>
              )}
              <p className="meta" style={{ margin: "6px 0 0" }}>
                tommelfingerregning for raske voksne (Mifflin-St Jeor) — ikke lægefaglig rådgivning;
                ret tallene som du vil
              </p>
            </div>
          )}
        </div>

        <div style={{ marginTop: 16 }} className="field">
          <span className="field-label">
            kcal pr. dag, pr. person (valgfrit — fælles retter, portioner skaleres) + protein
          </span>
          <div className="chip-row">
            {kcalPerPerson.map((value, i) => (
              <input
                // The list is positional by nature (person 1..N) — index IS the identity.
                // biome-ignore lint/suspicious/noArrayIndexKey: positional inputs
                key={i}
                className="input"
                style={{ width: 130 }}
                inputMode="numeric"
                value={value}
                onChange={(e) =>
                  setKcalPerPerson((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))
                }
                placeholder={`person ${i + 1}`}
                aria-label={`kcal person ${i + 1}`}
              />
            ))}
            <input
              className="input"
              style={{ width: 170 }}
              inputMode="numeric"
              value={protein}
              onChange={(e) => setProtein(e.target.value)}
              placeholder="protein g/dag (fælles)"
              aria-label="protein gram pr. dag"
            />
          </div>
        </div>

        <div style={{ marginTop: 16 }} className="field">
          <label htmlFor="loc">adresse (valgfrit — viser nærmeste butikker)</label>
          <input
            id="loc"
            className="input"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="fx istedgade 50, københavn"
          />
        </div>

        <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
          <button type="submit" className="btn" disabled={loading}>
            {loading
              ? useAi
                ? "tænker… (op til et par minutter)"
                : "planlægger… (op til ½ minut)"
              : "planlæg ugen"}
          </button>
          {plan && (
            <button type="button" className="btn btn-ghost" onClick={() => window.print()}>
              hent som pdf
            </button>
          )}
        </div>
        {planError && (
          <p className="err" style={{ marginTop: 10 }}>
            {planError}
          </p>
        )}
      </form>

      {r && (
        <section style={{ marginTop: 8 }}>
          <hr className="rule" />

          <div
            className="card pop pop-1"
            style={{ display: "flex", gap: 32, flexWrap: "wrap", alignItems: "baseline" }}
          >
            <div>
              <p className="meta">estimeret total</p>
              <p className="bignum">
                ~{r.grandTotal} {plan.currency}
              </p>
              <p className="meta">
                tilbud {r.dealTotal} + basisvarer ~{r.baseline.total} · budget {r.budget}
              </p>
            </div>
            <p className={r.feasible ? "delta-ok" : "delta-bad"} style={{ fontSize: 13 }}>
              {r.feasible
                ? `inden for budget (${Math.round(r.budget - r.grandTotal)} ${plan.currency} til overs)`
                : `over budget med ~${Math.ceil(r.budgetGap)} ${plan.currency} — billigste gyldige plan`}
            </p>
          </div>

          {plan.ai?.used && (
            <div className="card pop pop-2" style={{ marginTop: 14 }}>
              <p className="meta">ai&apos;ens tanker ({plan.ai.model ?? "gpt"})</p>
              {plan.ai.reasoning && <p style={{ margin: "6px 0 0" }}>{plan.ai.reasoning}</p>}
              {plan.ai.tips && plan.ai.tips.length > 0 && (
                <p className="meta" style={{ marginTop: 8 }}>
                  tips: {plan.ai.tips.join(" · ")}
                </p>
              )}
              {plan.ai.rejectedDeals && plan.ai.rejectedDeals.length > 0 && (
                <p className="meta" style={{ marginTop: 4 }}>
                  afviste tilbudsmatch:{" "}
                  {plan.ai.rejectedDeals
                    .map((rd) => `${rd.ingredient} i ${rd.recipe} (${rd.reason})`)
                    .join("; ")}
                </p>
              )}
              <p className="meta" style={{ marginTop: 4 }}>
                ai&apos;en opfinder retterne ud fra ugens tilbud — koden efterregner alle beløb
              </p>
            </div>
          )}
          {plan.ai && !plan.ai.used && plan.ai.error && (
            <p className="err" style={{ marginTop: 10 }}>
              ai-laget kunne ikke bruges: {plan.ai.error} — deterministisk plan vist i stedet
            </p>
          )}

          {r.kcal.target !== null && (
            <p className="meta" style={{ marginTop: 12 }}>
              kalorier: mål {r.kcal.target}/dag (snit) → {r.kcal.effectiveTarget} for valgte
              måltider · planen giver ~{r.kcal.avgPerDay ?? "?"} ·{" "}
              {r.kcal.withinTolerance ? "inden for ±10%" : "uden for ±10%"}
              {r.kcal.unscoredIngredients.length > 0 &&
                ` · ikke talt med: ${r.kcal.unscoredIngredients.slice(0, 6).join(", ")}${r.kcal.unscoredIngredients.length > 6 ? "…" : ""}`}
            </p>
          )}
          {r.protein && r.protein.target !== null && (
            <p className="meta" style={{ marginTop: 4 }}>
              protein: mål {r.protein.target} g/dag → {r.protein.effectiveTarget} g for valgte
              måltider · planen giver ~{r.protein.avgPerDay ?? "?"} g/dag
            </p>
          )}
          {r.kcal.portioning && r.kcal.portioning.length > 0 && (
            <div className="card pop pop-2" style={{ marginTop: 12 }}>
              <p className="meta">portioner pr. person (fælles retter, forskellig størrelse)</p>
              {r.kcal.portioning.map((p) => (
                <p key={p.person} style={{ margin: "4px 0" }}>
                  person {p.person}: tag {p.factor} portion
                  <span className="meta">
                    {" "}
                    · mål {p.targetKcal} kcal/dag
                    {p.avgKcalPerDay !== null ? ` · får ~${p.avgKcalPerDay} fra planen` : ""}
                  </span>
                </p>
              ))}
            </div>
          )}

          <h2 className="pop pop-2" style={{ fontWeight: 500, fontSize: 16, marginTop: 28 }}>
            ugeplan
          </h2>
          <div className="plan-days pop pop-2">
            {r.days.map((d) => (
              <div key={d.day} className="plan-day">
                <span className="meta">
                  dag {d.day}
                  {d.kcalPerPerson !== null ? ` · ~${d.kcalPerPerson} kcal/pers` : ""}
                </span>
                {d.meals.map((m) => (
                  <span key={m.mealType}>
                    {MEAL_LABELS[m.mealType]}: {m.recipe.scored.name}
                    {m.leftover ? ` (rester fra dag ${m.cookedOnDay})` : ""}
                    <span className="meta">
                      {" "}
                      · ~{Math.round(m.recipe.fullCost)} {plan.currency}
                    </span>
                  </span>
                ))}
              </div>
            ))}
          </div>

          {r.cookSchedule && r.cookSchedule.length > 0 && (
            <div className="pop pop-3">
              <h2 style={{ fontWeight: 500, fontSize: 16, marginTop: 28 }}>madlavningsdage</h2>
              {r.cookSchedule.map((b) => (
                <p key={`${b.day}-${b.mealType}-${b.recipeName}`} style={{ margin: "4px 0" }}>
                  dag {b.day}: lav {b.portions} portioner {b.recipeName}
                  <span className="meta">
                    {" "}
                    · {MEAL_LABELS[b.mealType]} dag {b.covers.join("/")}
                  </span>
                </p>
              ))}
            </div>
          )}

          <div className="pop pop-4">
            <ShoppingList plan={plan} />
          </div>

          {r.notes.length > 0 && (
            <div className="pop pop-5">
              <h2 style={{ fontWeight: 500, fontSize: 16, marginTop: 28 }}>bemærk</h2>
              {r.notes.map((n) => (
                <p key={n} className="meta" style={{ margin: "4px 0" }}>
                  {n}
                </p>
              ))}
            </div>
          )}

          <hr className="rule" />
          <p className="meta">
            basisvarepriser er estimater (tilbud vinder altid) · næring: frida v6.1, dtu
            fødevareinstituttet, cc by 4.0 · tilbud: etilbudsavis/tjek · adresser: dawa
          </p>
        </section>
      )}
    </main>
  );
}

function ShoppingList({ plan }: { plan: PlanJson }) {
  const r = plan.result;
  // Deal items grouped by store, deduped per (store, ingredient).
  const byStore = new Map<
    string,
    Map<string, { heading: string; price: number; quantity: string }>
  >();
  for (const day of r.days) {
    for (const meal of day.meals) {
      const scored = (
        meal.recipe as unknown as {
          scored: {
            ingredients: Array<{
              name: string;
              quantity: string;
              bestDeal: { heading: string; price: number; store: string } | null;
            }>;
          };
        }
      ).scored;
      for (const ing of scored.ingredients) {
        if (!ing.bestDeal) continue;
        const store = byStore.get(ing.bestDeal.store) ?? new Map();
        if (!store.has(ing.name)) {
          store.set(ing.name, {
            heading: ing.bestDeal.heading,
            price: ing.bestDeal.price,
            quantity: ing.quantity,
          });
        }
        byStore.set(ing.bestDeal.store, store);
      }
    }
  }

  return (
    <>
      <h2 style={{ fontWeight: 500, fontSize: 16, marginTop: 28 }}>indkøbsliste</h2>
      {plan.resolvedLocation && (
        <p className="meta">nærmeste butikker ift. {plan.resolvedLocation}</p>
      )}
      {[...byStore.entries()].sort().map(([storeName, items]) => {
        const branch = plan.nearestByChain?.[storeName];
        return (
          <div key={storeName} className="card" style={{ marginTop: 12 }}>
            <p style={{ fontWeight: 500, margin: 0 }}>
              {storeName}
              {branch && (
                <span className="meta">
                  {" "}
                  · nærmeste: {branch.name || branch.street}, {branch.street}, {branch.zip}{" "}
                  {branch.city} ({branch.distanceKm} km)
                </span>
              )}
            </p>
            {[...items.entries()].sort().map(([name, item]) => (
              <p key={name} style={{ margin: "4px 0" }}>
                {name} <span className="meta">({item.quantity})</span> — {item.heading}{" "}
                <span className="meta">
                  ~{Math.round(item.price)} {plan.currency}
                </span>
              </p>
            ))}
          </div>
        );
      })}
      {r.maybe && r.maybe.lines.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <p style={{ fontWeight: 500, margin: 0 }}>
            måske-kurv{" "}
            <span className="meta">
              · krydderier m.m. du nok har — tjek skabet, ellers ~{r.maybe.total} {plan.currency}{" "}
              oveni (uden for budgettet)
            </span>
          </p>
          {r.maybe.lines.map((l) => (
            <p key={l.name} style={{ margin: "4px 0" }}>
              {l.name}{" "}
              <span className="meta">
                {l.estimate !== null ? `~${l.estimate} ${plan.currency}` : "pris ukendt"}
              </span>
            </p>
          ))}
        </div>
      )}
      {r.baseline.lines.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <p style={{ fontWeight: 500, margin: 0 }}>
            basisvarer <span className="meta">· estimeret, intet aktuelt tilbud</span>
          </p>
          {r.baseline.lines.map((l) => (
            <p key={l.item.name} style={{ margin: "4px 0" }}>
              {l.item.name}{" "}
              <span className="meta">
                {l.packs} × {l.item.packSize}
                {l.item.unit} ≈ {l.cost} {plan.currency}
              </span>
            </p>
          ))}
        </div>
      )}
      {plan.resolvedLocation && (
        <p className="meta" style={{ marginTop: 8 }}>
          tilbud kan variere regionalt — den nærmeste filial har ikke garanteret alle avisens varer.
        </p>
      )}
    </>
  );
}

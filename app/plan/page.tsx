"use client";

// Private planner UI: key-gated, fog-styled, prints to PDF.
// The key is the same personal access key as the MCP connector; it lives in
// localStorage on Ludwig's own machine and is sent as a Bearer header.

import { useCallback, useEffect, useState } from "react";

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
    };
    notes: string[];
    relaxSuggestions: string[];
    cookSchedule?: Array<{
      day: number;
      mealType: MealType;
      recipeName: string;
      portions: number;
      covers: number[];
    }>;
  };
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
  const [kcal, setKcal] = useState("");
  const [diet, setDiet] = useState<string[]>([]);
  const [mealPrep, setMealPrep] = useState(false);
  const [location, setLocation] = useState("");

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
          kcalPerPersonPerDay: kcal ? Number(kcal) : undefined,
          excludeProteins: diet.length > 0 ? diet : undefined,
          mealPrep,
          location: location.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPlanError(String(data.error ?? `fejl (${res.status})`));
        return;
      }
      setPlan(data as PlanJson);
    } catch {
      setPlanError("kunne ikke nå serveren — prøv igen");
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
          <label>måltider</label>
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
          <label>kost</label>
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

        <div style={{ marginTop: 16 }} className="grid-2">
          <div className="field">
            <label htmlFor="kcal">kcal pr. person pr. dag (valgfrit)</label>
            <input
              id="kcal"
              className="input"
              inputMode="numeric"
              value={kcal}
              onChange={(e) => setKcal(e.target.value)}
              placeholder="fx 2000"
            />
          </div>
          <div className="field">
            <label htmlFor="loc">adresse (valgfrit — viser nærmeste butikker)</label>
            <input
              id="loc"
              className="input"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="fx istedgade 50, københavn"
            />
          </div>
        </div>

        <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
          <button type="submit" className="btn" disabled={loading}>
            {loading ? "planlægger… (op til ½ minut)" : "planlæg ugen"}
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

          {r.kcal.target !== null && (
            <p className="meta" style={{ marginTop: 12 }}>
              kalorier: mål {r.kcal.target}/dag → {r.kcal.effectiveTarget} for valgte måltider ·
              planen giver ~{r.kcal.avgPerDay ?? "?"} ·{" "}
              {r.kcal.withinTolerance ? "inden for ±10%" : "uden for ±10%"}
              {r.kcal.unscoredIngredients.length > 0 &&
                ` · ikke talt med: ${r.kcal.unscoredIngredients.slice(0, 6).join(", ")}${r.kcal.unscoredIngredients.length > 6 ? "…" : ""}`}
            </p>
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

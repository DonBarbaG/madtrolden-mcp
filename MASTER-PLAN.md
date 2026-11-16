# madtrolden-mcp — MASTER PLAN (the one living list)

**Progress: 66.8 / 69 done — ~97%** (task-count, each item = 1; item 47 ~90%; last updated 2026-11-16)
Legend: [ ]/[x] · owner [you]/[me]/[both] · ⏾ = Claude can run unattended · ~NN% partial.
Guiding principles (not tasks): stateless server, no user data at rest, ever · invite-only, unknown callers learn nothing · 0 kr extra spend · be a good citizen to the Tjek API · keep base repo credits + MIT intact.

Spec: `../claude-code-prompt-madtrolden.md` · Phase-0 findings: `docs/api-notes.md`

## ✅ DONE

- [x] 1. Fork + clone [me] — forked olgasafonova/tilbudstrolden-mcp → DonBarbaG/madtrolden-mcp, upstream remote set.
- [x] 2. Baseline green [me] — `npm install && npm test` → 380/380 passing, Node 22.
- [x] 3. Probe Tjek API live [me] — /offers/search + /dealers match RawOffer; **/stores supports r_lat/r_lng/r_radius + dealer_id** (better than spec assumed). (docs/api-notes.md)
- [x] 4. Probe DAWA [me] — /adresser + /autocomplete work, no key; x=lng, y=lat. (docs/api-notes.md)
- [x] 5. Probe Frida [me] — dataset is on DTU Data/Figshare, DOI 10.11583/DTU.32312844, **CC BY 4.0**, direct xlsx download. mcp-handler v2.1.0 confirmed current name. (docs/api-notes.md)

## ESTIMATE (law-adjusted, measured — refreshed every session)

Session 1 (2026-08-03) shipped items 1–33 in ~1.5 h wall — far under the 17–24 h estimate (multiplier learned: this codebase + spec quality collapse Claude-hours hard). Remaining: item 34 only, all [you]-hours: try the connector from your own Claude (~10 min), genkey for family + hand out (~20 min), then tag v1.0.0. **Estimate to done: ~0.5 Ludwig-hours, 0 Claude-hours blocked.**

## PHASE 1 — Remote + auth + cache

- [x] 6. Next.js scaffold [me] ⏾ — minimal App Router project, no UI framework; keep vitest + biome working; stdio entrypoint stays (`npm run dev:stdio`).
- [x] 7. Port `src/` → `lib/` [me] ⏾ — move all base logic untouched, fix imports, 380 tests still green.
- [x] 8. `/api/mcp` via mcp-handler [me] ⏾ — Streamable HTTP, all existing tools registered.
- [x] 9. Auth [me] ⏾ — `ACCESS_KEYS` name:key pairs, Bearer + path-key fallback `/api/mcp/<key>`, `crypto.timingSafeEqual`, uniform 401, loud boot failure on malformed env. `npm run genkey <name>` script.
- [x] 10. Rate limiting [me] ⏾ — in-memory token bucket ~60/min per key + ~300/min global, 429 + Retry-After.
- [x] 11. Deals cache [me] ⏾ — shared Map, offers TTL 6h, dealers 24h, stores 24h; RAM only.
- [x] 12. `whoami` tool [me] ⏾ — account name, cached-profile exists?, cache age.
- [x] 13. Landing page `/` [me] ⏾ — one boring static page, zero data.
- [x] 14. Deploy to Vercel [both] — region arn1/fra1, env vars set. May need Ludwig if `vercel` CLI unauthed.
- [x] 15. Phase-1 acceptance [both] ~90% — verified vs deployed https://madtrolden-mcp.vercel.app with curl-as-MCP-client: live hakket-oksekød deals, wrong key → uniform 401, dup search cache-hit (log-proven in prod-mode locally, same build). Remaining 10%: Ludwig connecting from his own Claude app.

## PHASE 2 — Profiles (client-held state)

- [x] 16. Profile schema + zod [me] ⏾ — DataStore schema as zod, extended fields (§6) validated.
- [x] 17. `import_profile` / `export_profile` [me] ⏾ — RAM cache `Map<account,{profile,updatedAt}>` TTL 24h; tool descriptions teach client AIs the durability story.
- [x] 18. All tools read cached profile [me] ⏾ — replace `~/.tilbudstrolden.json` file store; grep-proof: no fs writes outside /tmp.
- [x] 19. Phase-2 acceptance [me] ⏾ — import → plan → export round-trip test; cold-start + re-import identical behavior.

## PHASE 3 — Budget + nutrition

- [x] 20. `data/baseline-prices.json` [me] ⏾ — ~150 danske stapler, conservative 2026 discount estimates, `"source": "estimates, user-editable"`.
- [x] 21. `npm run build:nutrition` + `data/nutrition.json` [me] ⏾ — Frida xlsx → ~200–300 ingredients, kcal/protein/fat/carbs per 100g, CC BY 4.0 attribution, JSON committed.
- [x] 22. `plan_week` solver [me] ⏾ — hard budget cap, kcal ±10%, greedy seed → local search, deterministic; infeasible → cheapest plan + gap + relax suggestions.
- [x] 23. Phase-3 acceptance [me] ⏾ — unit tests: cap-binding, infeasible, no-kcal-target; "2 pers, 500 kr, 2000 kcal, veg, dinners" scenario.

## PHASE 4 — Meals + meal prep

- [x] 24. `data/breakfast-lunch.json` [me] ⏾ — ~10 + ~10 danske billige templates; `mealType`/`batchable`/`keepsDays` fields, annotate the 32 dinners.
- [x] 25. Meal-prep mode [me] ⏾ — ≤2 cook days, portions scale, leftovers scheduled onto the calendar (never vanish).
- [x] 26. Phase-4 acceptance [me] ⏾ — `meal_prep=true, meals=[lunch,dinner]` → every cooked portion appears on some day.

## PHASE 5 — Location

- [x] 27. DAWA geocoding + `find_stores_near` [me] ⏾ — address/latlng → branches within radius, haversine distances.
- [x] 28. Distance-aware planning [me] ⏾ — chains with a branch in radius rank higher; shopping list shows nearest branch + km; regional-flyer caveat flagged.
- [x] 29. Phase-5 acceptance [me] ⏾ — København address → sane branches/distances end-to-end on deployed URL.

## PHASE 6 — Polish + ship

- [x] 30. ONBOARDING.md [me] ⏾ — for non-technical family: claude.ai connector, Desktop, Claude Code one-liner, first prompts, profile-saving habit.
- [x] 31. README rewrite [me] ⏾ — architecture, env vars, deploy, credits (tilbudstrolden MIT, Tjek, Frida/DTU CC BY, DAWA, OSM).
- [x] 32. CI [me] ⏾ — GitHub Actions: lint, typecheck, tests.
- [x] 33. Security pass §9 [me] ⏾ — full checklist incl. git-history secret scan, npm audit, 429 test, outbound-host audit.
- [ ] 34. Keys + family rollout [you] — generate per-person keys into Vercel env, hand out, tag v1.0.0 after Ludwig's own end-to-end run.

## PHASE 7 — privat web-UI (plottet ind 2026-08-04, Ludwigs ønske: "website med kodeord, kun mig, UI, download som PDF")

- [x] 35. Delt plan-service [me] ⏾ — lib/plan-service.ts, MCP-tool og UI kører samme pipeline.
- [x] 36. /api/plan JSON-endpoint [me] ⏾ — GET login-tjek + POST plan; samme nøgle-auth, rate limits og account-kontekst som MCP.
- [x] 37. /plan side [me] ⏾ — fog-styled, dansk, lys+mørk; kodeord (localStorage), form (budget/personer/dage/måltider/kost/kcal/meal prep/adresse), resultat med ugeplan, madlavningsdage, indkøbsliste m. nærmeste filialer, totaler.
- [x] 38. PDF-download [me] ⏾ — "hent som pdf" via print-stylesheet (formularen skjules, planen printes rent).

## PHASE 8 — ai på serveren (plottet ind 2026-08-04: "jeg vil have den tænker faktisk godt og ikke bare deterministisk")

- [x] 39. AI-klient [me] ⏾ — lib/ai.ts, Ludwigs egen OpenAI-nøgle (OPENAI_API_KEY + AI_MODEL=gpt-5.5 i Vercel env), JSON-mode, typede fejl.
- [x] 40. AI-planlægger [me] ⏾ — lib/ai-planner.ts: GPT får hele opskriftspuljen med ægte tilbudspriser, komponerer ugen med dømmekraft + auditerer tilbudsmatch (afviste matches ompristes som basisvarer); én reparationsrunde ved budgetoverskridelse; planen genopbygges deterministisk så alle tal er ægte.
- [x] 41. Gennemstik [me] ⏾ — ai + wishes i plan-service, MCP-værktøjet, /api/plan og UI ("tænk med ai"-chip + ønske-felt + ai-tanke-kort); ærligt fald-tilbage til deterministisk ved enhver fejl.
- [x] 42. Verificeret live [me] — gpt-5.5 planlagde 3 dage under budget og afviste 2 falske tilbudsmatch (kakaomælk≠mælk, cidereddike≠gurkemeje).

## PHASE 9 — ai opfinder maden (plottet ind 2026-08-04: "fuck opskriftsbogen — ai'en skal selv opfinde retterne ud fra tilbuddene og bruge færrest mulige penge; krydderier i en måske-kurv; hårdt loft er hårdt")

- [x] 43. AI-invent motor [me] ⏾ — lib/ai-invent.ts: bredt tilbuds-sweep → GPT opfinder ugens måltider fra de ægte tilbud (ingen opskriftsbog i ai-mode), målrettet tilbudsopslag på de opfundne ingredienser, alle beløb efterregnet af samme deal/baseline/næringsmotor.
- [x] 44. Måske-kurv [me] ⏾ — krydderier/olie/condiments klassificeres (flag + ordliste) ud af budgettet, prises som estimater, egen sektion i UI.
- [x] 45. Hårdt loft håndhævet [me] ⏾ — GPT-reparationsrunder ved overskridelse, derefter deterministisk trim (dyre slots → ugens billigste ret) til planen ER under loftet; kun hvis selv billigst muligt ikke kan, vises ærligt over-budget.
- [x] 46. Gennemstik + oprydning [me] ⏾ — plan-service kører invent-mode ved ai=true (biblioteksplanlæggeren er kun ikke-ai/fald-tilbage), lib/ai-planner.ts fjernet, UI-tekster opdateret, 13 nye unit tests (450 grønne i alt).
- [ ] 47. Verificeret live [both] ~90% (deployet til prod 2026-08-04, dpl_Cxtw…) — scenariet (375 kr / 7 dage / 3 måltider / veg+glutenfri+mælkefri / 1850 kcal) kørt lokalt mod ægte tilbud + gpt-5.5: 344 kr, feasible, kcal 1876, måske-kurv 134 kr udenfor loftet, trim håndhævede loftet (4 swaps), ~2m40s. Rest: Ludwig trykker planlæg i UI’et.

## PHASE 10 — næringsmål (plottet ind 2026-08-04: "calorie estimator og protein thing — toggle: kender jeg mine makromål eller skal der en quick calc til, lokalt regnet, kun målene sendes")

- [x] 48. Hurtig beregner [me] ⏾ — lib/nutrition-goals.ts (ren atom, unit-testet): Mifflin-St Jeor × aktivitet + mål-delta, protein g/kg pr. mål, 1200 kcal-gulv; regner LOKALT i browseren, kun kcal/protein-målene sendes til serveren.
- [x] 49. UI-toggle [me] ⏾ — "jeg kender mine mål" / "hurtig beregner" chips på /plan; beregneren har vægt/højde/alder/køn/aktivitet/mål og "brug tallene" der udfylder felterne; proteinfelt (g/dag, fælles) ved siden af kcal-felterne.
- [x] 50. Protein gennem motoren [me] ⏾ — proteinPerPersonPerDay: route → plan-service → PlanWeekOptions; ai-prompten sigter efter det; assembleResult rapporterer snit-protein/dag mod måltids-skaleret mål; vises i UI-resultatet. Live: 370/375 kr, 92 g mod 90 g mål.

## PHASE 11 — nemt og billigt (plottet ind 2026-08-04: "kald den noget dansk og godt, lav et logo, og indkøbslisten sender mig til Bilka 1-2 timer væk — der skal være en maks radius")

- [x] 51. Hård butiksradius [me] ⏾ — radius er nu en HÅRD grænse, ikke kun en scoring-boost: med adresse sat må kun kæder med filial inden for radiusKm (default 3, clamp 1-25) levere tilbud — i ai-kataloget, deal-matching og indkøbslisten. filterDealMapToStores-atom + ærlig note med de brugte kæder. Live-verificeret: Bilka/Fleggaard/CITTI røg ud på Istedgade/2 km.
- [x] 52. Radius i UI [me] ⏾ — "maks km til butik"-felt ved siden af adresse.
- [x] 53. Rebrand [me] ⏾ — madtrolden → **nemt og billigt** (titel nemtogbilligt.app); gpt-image-2-logo (indkøbskurv med ærtebælg-smil) som public/logo.png + app/icon.png favicon; headers på / og /plan. Repo/domæne/internals uændret.
- [x] 54. Deploy [me] — prod kører rebranded build (madtrolden-mcp.vercel.app).
- [ ] 55. Domæne [you] — nemtogbilligt.vercel.app-alias er sat men bag Vercels SSO-beskyttelse; tilføj det som project domain i Vercel-dashboardet (Settings → Domains, gratis, 1 min) — eller køb nemtogbilligt.app (koster penge, din beslutning).

## PHASE 12 — det har jeg allerede (plottet ind 2026-10-30: "type what you have in your fridge and it will pair it with whatever you want to buy or you have in your cupboards")

- [x] 56. On-hand-atomer [me] ⏾ — lib/on-hand.ts: fritekst → varer m. mængder (500 g / 1,5 l / 6 æg / "halv pose"), ord-match mod ingredienser, opgørelse af brugt/ubrugt/for-lidt. 15 nye tests (467 grønne).
- [x] 57. Gennem motoren [me] ⏾ — `onHand` på PlanRequest/route/MCP `on_hand`: ai-mode bygger ugen omkring varerne (letfordærvelige først), markerer `fromFridge`, koden godkender kun ægte køleskabsvarer, 0 kr, ude af indkøbslisten; mængdetjek med reparationsrunde; deterministisk mode regner dem som gratis. Varer der bryder kostvalget fjernes med note.
- [x] 58. UI [me] ⏾ — "det har jeg allerede"-felt + "fra dit køleskab"-kort (hvad blev brugt hvor, hvad blev ikke brugt). Live: 4 dage/2 pers → alle 5 varer brugt, 89 kr.
- [x] 59. DAWA er lukket [me] ⏾ — FIKSET 2026-10-30: geo.ts bruger nu OpenStreetMap (Nominatim, Photon som reserve), live-testet København/Aarhus. Oprindeligt: api.dataforsyningen.dk svarer 410 Gone (opdaget 2026-10-30): adresse → nærmeste butikker/radius virker ikke i prod. Skift geocoder (geo.ts) til efterfølgeren.

## PHASE 13 — telefon + mor (plottet ind 2026-10-30: "idk how to make it work on my phone · logo just a smiley · a log in for my mom · it should never log out")

- [x] 60. Aldrig logget ud [me] ⏾ — HttpOnly-cookie (400 dage, fornyes ved hvert besøg) + localStorage + #k=-fragment på /plan; log ud-knap fjernet; netværksfejl viser "prøv igen", aldrig login.
- [x] 61. Hjemmeskærm-app [me] ⏾ — appleWebApp-meta + apple-icon; "Føj til hjemmeskærm" gemmer login i ikonet.
- [x] 62. Smiley-logo [me] ⏾ — almindelig smiley på kurven (gpt-image-2), logo/favicon/apple-icon.
- [x] 63. Mors login [both] — per-person nøgle `ACCESS_KEY_MOR` (kode klar); Ludwig kører `npm run genkey mor` + `vercel env add ACCESS_KEY_MOR production` og sender hende linket `/plan#k=<nøgle>`.
- [x] 64. Deploy fase 12+13 [you] — Ludwigs ja til prod.

## PHASE 14 — butikkerne virker (plottet ind 2026-11-16: "does the location and getting the right supermarkets work? selecting the supermarkets too?")

- [x] 65. Kæde-loftet [me] ⏾ — dealer-listen læste kun side 1 (100 af 306), så ALLE tilbud fra Netto, REMA 1000, Lidl, føtex, SPAR, MENY, SuperBrugsen, Kvickly, Løvbjerg blev smidt væk. Pager nu hele listen.
- [x] 66. Hele radius + kun mad [me] ⏾ — /stores pages (100 butikker = ~1,3 km i KBH, så MENY/Kvickly forsvandt); opt-in `groceryOnly` dropper JYSK/Matas osv. (`lib/grocery-chains.ts`); tilbudssøgning spørger kun de valgte kæder (`dealer_ids`).
- [x] 67. Rigtig adresse [me] ⏾ — geokoderen vælger hittet hvis by matcher ("Vestergade 3 Skive" landede i Balling); Photon-fallback afviser vrøvl ("hjemme hos mor" → Rødovre møbelbutik); ukendt adresse giver en note i stedet for stille hele-landet.
- [x] 68. Vælg supermarkeder [me] ⏾ — `/api/stores` + chips under adressen (afstand pr. kæde, alle til, tryk = fra, huskes pr. enhed); valgte kæder sendes som `stores` → hårdt filter. Verificeret lokalt: Skive + kun Lidl/REMA → plan bruger kun Lidl/REMA.
- [x] 69. Deploy fase 14 [you] — live 2026-11-16 via `vercel deploy --prod` (git-push deployer IKKE automatisk på dette projekt).

## INBOX — unsorted brain-dumps

_(empty)_

## Deep references (linked, not archived)

- `docs/api-notes.md` — Phase 0 live-probe findings.
- `../claude-code-prompt-madtrolden.md` — the full build spec.

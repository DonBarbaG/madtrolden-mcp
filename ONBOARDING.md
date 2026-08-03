# Kom i gang med Madtrolden 🧌

Madtrolden er en privat madplanlægger, du taler med gennem din egen Claude. Den kender ugens danske tilbudsaviser og kan lave madplaner med budgetloft, indkøbslister og nærmeste butikker.

Du skal bruge **din personlige nøgle** (den ligner `troll_xxxxxxxx...`). Har du ikke fået en? Spørg Ludwig. Del den ikke med andre — den er din.

---

## 1. Tilslut Madtrolden til din Claude

### claude.ai (browseren) eller Claude-appen

1. Gå til **Settings → Connectors** (Indstillinger → Forbindelser).
2. Vælg **Add custom connector**.
3. Udfyld:
   - **Name:** `Madtrolden`
   - **URL:** `https://madtrolden-mcp.vercel.app/api/mcp/DIN_NØGLE`
     (sæt din nøgle ind i stedet for `DIN_NØGLE` — hele nøglen, med `troll_`)
4. Gem. Færdig.

> Nøglen står i selve adressen, fordi claude.ai ikke kan sende den separat. Det er okay: adressen ses kun af dig og af Ludwigs egen server-log.

### Claude Desktop (Mac/Windows)

Samme fremgangsmåde som claude.ai: **Settings → Connectors → Add custom connector** med samme URL.

### Claude Code (terminalen — for de tekniske)

```bash
claude mcp add --transport http madtrolden https://madtrolden-mcp.vercel.app/api/mcp \
  --header "Authorization: Bearer DIN_NØGLE"
```

---

## 2. Sig hej

Prøv en af disse som din første besked:

- *"Brug Madtrolden: hvem er jeg logget ind som?"* (tjekker at forbindelsen virker)
- *"Vi er 3 personer, ingen svinekød, vi handler i Netto og REMA på Vesterbro — sæt min husstand op."*
- *"Hvilke butikker ligger tæt på [din adresse]?"*
- *"Planlæg en uge aftensmad for os for max 500 kr."*
- *"Planlæg frokost og aftensmad hele ugen, meal prep — jeg gider kun lave mad søndag og onsdag."*

---

## 3. VIGTIGT: Gem din profil (én vane)

Madtrolden **gemmer ingenting permanent** — det er en feature: dine data ligger ikke og flyder på en server. Din husstand/opskrifter/historik ligger kun i serverens korttidshukommelse (~1 døgn).

Vanen, der gør alt nemt:

- **Når du er færdig med en session:** sig *"eksportér min profil"* og bed din Claude om at gemme den (i sin hukommelse eller i en note/projekt).
- **Når du starter en ny session** (og Madtrolden siger, at der ikke er nogen profil): sig *"importér min gemte profil"*.

Din Claude klarer resten selv — værktøjerne hedder `export_profile` og `import_profile`.

---

## 4. Hvad kan den?

- **Tilbudsjagt:** "Hvad er hakket oksekød på tilbud til i denne uge?"
- **Budgetplan:** "Mad til 2 for 400 kr denne uge" — budgettet er et hårdt loft; kan det ikke lade sig gøre, får du at vide præcis hvor meget der mangler.
- **Kalorier:** "…og ca. 2000 kcal om dagen per person."
- **Meal prep:** "Lav en plan hvor jeg kun laver mad 2 dage og spiser rester."
- **Butikker:** "Hvilke kæder ligger inden for 2 km af mig?" — indkøbslisten viser nærmeste filial.
- **Indkøbsliste:** altid grupperet per butik, tilbudsvarer adskilt fra estimerede basisvarer.

God fornøjelse! Problemer? Skriv til Ludwig.

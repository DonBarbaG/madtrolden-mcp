#!/usr/bin/env python3
"""Build data/nutrition.json from the Danish Food Composition Database (Frida).

Usage:  npm run build:nutrition          (or: python3 scripts/build-nutrition.py)

Downloads the published dataset from DTU Data (build-time only — the deployed
server never calls out to this), extracts kcal/protein/fat/carbs per 100 g for
a curated set of common Danish home-cooking ingredients, and writes
data/nutrition.json, which is committed so deploys never depend on the site.

Source: "The Danish Food Composition Database, version 6.1",
DTU Fødevareinstituttet, DOI 10.11583/DTU.32312844 — CC BY 4.0.
Only standard-library Python is used (the xlsx is unzipped by hand).
"""

import io
import json
import pathlib
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

DATASET_URL = "https://ndownloader.figshare.com/files/65016537"  # FCDB_6.1_Dataset.xlsx
OUT_PATH = pathlib.Path(__file__).resolve().parent.parent / "data" / "nutrition.json"
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

# Curated mapping: output ingredient -> aliases (match recipe searchTerms,
# lowercase) + Frida food candidates in priority order (first hit wins).
# Names must match the Frida "FødevareNavn" column exactly.
MAPPING = [
    # --- meat & poultry ---
    ("hakket oksekød", ["hakket oksekød", "oksefars", "oksekød", "fars"], ["Oksekød, hakket, 8-12% fedt, rå", "Oksekød, hakket, 10-15% fedt, rå"]),
    ("hakket svinekød", ["hakket svinekød", "svinefars", "grisefars", "grisekød"], ["Kalv- og svinekød, hakket kalv og flæsk, 15-20% fedt, råt"]),
    ("kyllingebryst", ["kyllingebryst", "kyllingefilet", "kylling", "hakket kylling"], ["Kylling, bryst, kød og skind, rå"]),
    ("hel kylling", ["hel kylling"], ["Kylling, kød og skind, rå"]),
    ("kyllingelår", ["kyllingelår", "kyllingeunderlår"], ["Kylling, lår, kød og skind, rå"]),
    ("svinekotelet", ["kotelet", "svinekotelet", "svinekoteletter", "nakkefilet", "nakkekotelet"], ["Grisekød, nakkefilet, helt afpudset (Nakkekotelet), rå"]),
    ("svinemørbrad", ["svinemørbrad", "mørbrad"], ["Grisekød, mørbrad, afpudset, rå"]),
    ("svinekam", ["flæskesteg", "svinekam"], ["Grisekød, kam uden svær, ca. 3 mm spæk, rå"]),
    ("brystflæsk", ["brystflæsk", "svinebryst", "pork belly"], ["Grisekød, stegestykke af bryst med svær, rå", "Grisekød, bryst med svær, rå"]),
    ("oksekød i tern", ["oksekød i tern", "grydekød", "bøf"], ["Oksekød, tykbov (marvpibebov), rå"]),
    ("oksemørbrad", ["oksemørbrad", "oksebøf", "ribeye"], ["Oksekød, mørbrad, afpudset, rå"]),
    ("bacon", ["bacon", "baconskiver", "røget bacon"], ["Bacon i skiver, rå"]),
    ("wienerpølser", ["wienerpølser", "pølser"], ["Wienerpølse"]),
    ("medisterpølse", ["medister", "medisterpølse", "italiensk pølse", "salsiccia", "chorizo"], ["Medisterpølse, rå"]),
    ("kogt skinke", ["skinke", "skinkepålæg"], ["Skinke, kogt, skiveskåret"]),
    ("spegepølse", ["spegepølse"], ["Spegepølse"]),
    ("hamburgerryg", ["hamburgerryg"], ["Hamburgerryg, røget"]),
    ("leverpostej", ["leverpostej"], ["Leverpostej"]),
    # --- fish ---
    ("laks", ["laks", "laksefilet", "laksfilet", "frossen laks"], ["Laks, atlantisk, vild, rå"]),
    ("torskefilet", ["torsk", "torskefilet", "fiskefilet"], ["Torsk, filet, rå"]),
    ("rødspættefilet", ["rødspætte", "rødspættefilet"], ["Rødspætte, rå", "Torsk, filet, rå"]),
    ("tun i vand", ["tun", "tun i vand"], ["Tun i vand, konserves"]),
    ("makrel i tomat", ["makrel", "makrel i tomat"], ["Makrel i tomat, konserves"]),
    ("marinerede sild", ["sild", "marinerede sild"], ["Sild, marineret"]),
    ("fiskefrikadelle", ["fiskefrikadeller", "fiskefrikadelle"], ["Fiskefrikadelle"]),
    ("rejer", ["rejer", "tigerrejer"], ["Reje, dybvands, kogt, i lage", "Reje, dybvands-, konserves"]),
    # --- dairy & eggs ---
    ("æg", ["æg", "frilandsæg", "skrabeæg"], ["Æg, høne, hele, rå", "Æg, høne, burhøns, rå"]),
    ("letmælk", ["letmælk", "mælk"], ["Letmælk, konventionel (ikke-økologisk)"]),
    ("sødmælk", ["sødmælk"], ["Sødmælk, konventionel (ikke-økologisk)"]),
    ("minimælk", ["minimælk"], ["Minimælk, 0.5 % fedt"]),
    ("smør", ["smør", "lurpak"], ["Smør, saltet"]),
    ("margarine", ["margarine"], ["Margarine, 80 %, bordbrug, blød, vegetabilsk fedt", "Plantemargarine, 80%, stege/bage"]),
    ("yoghurt naturel", ["yoghurt", "yoghurt naturel"], ["Yoghurt naturel, sødmælk"]),
    ("skyr", ["skyr"], ["Skyr, 0.2 % fedt"]),
    ("a38", ["a38", "tykmælk"], ["A38, acidophilus tykmælk af letmælk, 1,5% fedt"]),
    ("creme fraiche 18%", ["creme fraiche", "crème fraîche"], ["Creme fraiche 18 %"]),
    ("piskefløde", ["piskefløde", "fløde"], ["Fløde 38 %, piskefløde"]),
    ("madlavningsfløde", ["madlavningsfløde", "kaffefløde"], ["Fløde 9 %, kaffefløde", "Creme fraiche 18 %"]),
    ("hytteost", ["hytteost"], ["Hytteost, 20+"]),
    ("skiveost", ["ost", "skiveost", "danbo"], ["Ost, fast, 45+, alle typer"]),
    ("mozzarella", ["mozzarella", "revet ost"], ["Mozzarella, 45+"]),
    ("parmesan", ["parmesan", "parmesanost"], ["Parmesan, revet"]),
    ("feta", ["feta", "salatost"], ["Feta, 40+"]),
    # --- grains, bread, pasta ---
    ("havregryn", ["havregryn"], ["Havregryn, uspec."]),
    ("rugbrød", ["rugbrød"], ["Rugbrød, med sigtet mel (soft) og fedtrige frø, industrifremstillet", "Rugbrød, lyst"]),
    ("toastbrød", ["toastbrød", "franskbrød", "brød"], ["Franskbrød"]),
    ("knækbrød", ["knækbrød"], ["Knækbrød, rug-, groft"]),
    ("hvedemel", ["hvedemel", "mel"], ["Hvedemel"]),
    ("fuldkornsmel", ["fuldkornsmel", "grahamsmel"], ["Grahamsmel, fuldkornshvedemel"]),
    ("ris", ["ris", "jasminris", "basmatiris", "basmati", "løse ris"], ["Ris, polerede, rå"]),
    ("grødris", ["grødris", "risengryn"], ["Risengryn, grødris, polerede, rå"]),
    ("risottoris", ["risottoris", "arborio ris"], ["Ris, polerede, rå"]),
    ("pasta", ["pasta", "penne", "fusilli", "rigatoni", "pastaskaller", "spaghetti", "lasagneplader", "lasagne pasta", "nudler", "ægnudler", "wok nudler", "risnudler"], ["Pasta, rå"]),
    ("couscous", ["couscous", "bulgur"], ["Bulgur, parboiled, rå"]),
    ("quinoa", ["quinoa"], ["Quinoa, hvid, rå"]),
    ("perlebyg", ["perlebyg", "byggryn"], ["Perlebyg", "Byggryn, rå"]),
    ("müsli", ["müsli", "mysli"], ["Müsli, uspec."]),
    ("cornflakes", ["cornflakes"], ["Cornflakes, uspec."]),
    ("rasp", ["rasp", "brødkrummer"], ["Rasp"]),
    ("tortilla", ["tortilla", "tortilla wraps", "wraps"], ["Hvedebrød, italiensk type, stort, detailbageri"]),
    # --- vegetables ---
    ("kartofler", ["kartofler", "kogekartofler", "bagekartofler", "ovnkartofler"], ["Kartoffel, uspec., rå"]),
    ("løg", ["løg", "skalotteløg", "skalotte"], ["Løg, rå"]),
    ("hvidløg", ["hvidløg"], ["Hvidløg, rå"]),
    ("forårsløg", ["forårsløg", "grønne løg"], ["Forårsløg, rå"]),
    ("gulerødder", ["gulerødder", "gulerod"], ["Gulerod, uspec., rå"]),
    ("tomat", ["tomater", "tomat"], ["Tomat, uspec., rå"]),
    ("dåsetomater", ["dåsetomater", "hakkede tomater", "flåede tomater"], ["Tomat, flået, konserves"]),
    ("tomatpuré", ["tomatpuré", "tomat puré"], ["Tomatpure, koncentreret"]),
    ("agurk", ["agurk"], ["Agurk, rå"]),
    ("peberfrugt", ["peberfrugt", "rød peberfrugt"], ["Peberfrugt, rød, rå"]),
    ("icebergsalat", ["icebergsalat", "salat"], ["Salat, Iceberg, rå"]),
    ("rucola", ["rucola", "rucolasalat"], ["Salat, rucola, rå", "Salat, Iceberg, rå"]),
    ("spinat", ["spinat", "baby spinat", "babyspinat", "frossen spinat"], ["Spinat, rå"]),
    ("hvidkål", ["hvidkål", "kål"], ["Hvidkål, rå"]),
    ("spidskål", ["spidskål"], ["Spidskål, rå"]),
    ("rødkål", ["rødkål", "syltede rødbeder"], ["Rødkål, rå"]),
    ("broccoli", ["broccoli", "frossen broccoli"], ["Broccoli, rå"]),
    ("blomkål", ["blomkål"], ["Blomkål, uspecificeret, rå"]),
    ("squash", ["squash", "zucchini"], ["Squash, rå"]),
    ("aubergine", ["aubergine"], ["Aubergine, rå"]),
    ("champignon", ["champignon", "svampe"], ["Champignon, rå"]),
    ("porrer", ["porrer", "porre"], ["Porre, rå"]),
    ("bladselleri", ["bladselleri", "selleri"], ["Bladselleri, rå"]),
    ("knoldselleri", ["knoldselleri"], ["Selleri, rod, rå"]),
    ("rødbeder", ["rødbeder"], ["Rødbede, rå"]),
    ("fennikel", ["fennikel"], ["Fennikel, knold, rå"]),
    ("frisk ingefær", ["ingefær", "frisk ingefær"], ["Ingefær, rod, rå"]),
    ("frisk chili", ["chili", "frisk chili", "rød chili"], ["Peber, chili, rå"]),
    ("frosne ærter", ["ærter", "frosne ærter"], ["Ærter, grønne, dybfrost"]),
    ("majs", ["majs", "dåsemajs", "majskerner"], ["Majs, kerner, konserves"]),
    ("avocado", ["avocado"], ["Avocado, rå"]),
    # --- fruit ---
    ("æble", ["æbler", "æble"], ["Æble, uspec., råt"]),
    ("banan", ["bananer", "banan"], ["Banan, rå"]),
    ("appelsin", ["appelsiner", "appelsin"], ["Appelsin, rå"]),
    ("pære", ["pærer", "pære", "konferencepære"], ["Pære, rå"]),
    ("citron", ["citron", "citronsaft"], ["Citron, rå"]),
    ("lime", ["lime"], ["Lime, rå", "Citron, rå"]),
    ("mango", ["mango"], ["Mango, rå"]),
    ("frosne bær", ["frosne bær", "hindbær", "blåbær", "jordbær"], ["Hindbær, dybfrost", "Jordbær, dybfrost"]),
    ("rosiner", ["rosiner"], ["Rosin uden kerner"]),
    # --- legumes, nuts ---
    ("kidneybønner", ["kidneybønner", "bønner"], ["Bønner, røde kidney, kogte, konserves"]),
    ("kikærter", ["kikærter"], ["Kikærter, lyse, kogte, konserves"]),
    ("hvide bønner", ["hvide bønner", "bagte bønner"], ["Bønner, hvide, kogte, konserves", "Bønner, røde kidney, kogte, konserves"]),
    ("røde linser", ["røde linser", "linser"], ["Linser, røde, tørrede, rå"]),
    ("mandler", ["mandler"], ["Mandel, rå"]),
    ("cashewnødder", ["cashewnødder", "cashew"], ["Cashewnød, tørristet", "Cashewnød, olieristet"]),
    ("peanuts", ["peanuts", "jordnødder", "peanutbutter", "jordnøddesmør"], ["Peanuts, (jordnød, ristet og saltet)"]),
    ("sesamfrø", ["sesamfrø"], ["Sesamfrø, afskallede"]),
    # --- fats, condiments, sweeteners ---
    ("rapsolie", ["rapsolie", "olie", "solsikkeolie"], ["Rapsolie"]),
    ("olivenolie", ["olivenolie"], ["Olivenolie"]),
    ("sesamolie", ["sesamolie"], ["Sesamolie", "Rapsolie"]),
    ("kokosmælk", ["kokosmælk"], ["Kokosmælk", "Kokosnød, rå"]),
    ("kokosmel", ["kokosmel"], ["Kokosmel"]),
    ("sukker", ["sukker"], ["Sukker, stødt melis (sakkarose)"]),
    ("brun farin", ["brun farin", "farin"], ["Sukker, brun farin"]),
    ("honning", ["honning"], ["Honning"]),
    ("marmelade", ["marmelade"], ["Marmelade, engelsk type"]),
    ("ketchup", ["ketchup"], ["Tomatketchup"]),
    ("sennep", ["sennep", "dijonsennep", "dijon", "fransk sennep"], ["Sennep, gul, færdiglavet"]),
    ("mayonnaise", ["mayonnaise", "mayo"], ["Mayonnaise"]),
    ("remoulade", ["remoulade"], ["Remoulade"]),
    ("pesto", ["pesto", "basilikum pesto"], ["Pesto, grøn", "Olivenolie"]),
    ("sojasauce", ["sojasauce", "soja", "lys sojasauce", "mørk sojasauce", "ketjap manis", "sød soja"], ["Soja sauce"]),
    ("bouillon", ["bouillon", "hønsebouillon", "oksebouillon", "grøntsagsbouillon", "kyllingebouillon"], ["Bouillon, oksekød, terning, spiseklar"]),
    ("oliven", ["oliven"], ["Oliven, sorte, uden sten, i saltlage", "Oliven, grønne, marinerede, konserves"]),
]


def load_sheet_rows(zf: zipfile.ZipFile):
    root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    tag = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t"
    sst = ["".join(t.text or "" for t in si.iter(tag)) for si in root.findall("m:si", NS)]
    n = 0
    for _ev, el in ET.iterparse(zf.open("xl/worksheets/sheet2.xml")):
        if not el.tag.endswith("}row"):
            continue
        n += 1
        if n >= 5:  # data rows start at row 5 (1-3 headers, 4 column labels)
            row = {}
            for c in el:
                ref = c.get("r")
                v = c.find("m:v", NS)
                val = v.text if v is not None else None
                if c.get("t") == "s" and val is not None:
                    val = sst[int(val)]
                row[re.match(r"[A-Z]+", ref).group()] = val
            if row.get("A"):
                yield row
        el.clear()


def num(v):
    try:
        return round(float(v), 1)
    except (TypeError, ValueError):
        return None


def main():
    cache = pathlib.Path("/tmp/frida-dataset.xlsx")
    if cache.exists() and cache.stat().st_size > 1_000_000:
        blob = cache.read_bytes()
        print(f"Using cached dataset at {cache}")
    else:
        print(f"Downloading {DATASET_URL} ...")
        blob = urllib.request.urlopen(DATASET_URL, timeout=120).read()
        cache.write_bytes(blob)

    zf = zipfile.ZipFile(io.BytesIO(blob))
    by_name = {}
    for row in load_sheet_rows(zf):
        # A=Danish name, F=kcal, H=protein, O=fat, L=available carbs (K=by difference)
        by_name[row["A"]] = {
            "kcal": num(row.get("F")),
            "protein": num(row.get("H")),
            "fat": num(row.get("O")),
            "carbs": num(row.get("L")) if num(row.get("L")) is not None else num(row.get("K")),
        }
    print(f"Parsed {len(by_name)} Frida foods")

    entries, unresolved = [], []
    for name, aliases, candidates in MAPPING:
        chosen = next((c for c in candidates if c in by_name), None)
        if chosen is None:
            unresolved.append((name, candidates))
            continue
        macros = by_name[chosen]
        if macros["kcal"] is None:
            unresolved.append((name, [f"{chosen} (no kcal)"]))
            continue
        entries.append(
            {
                "name": name,
                "aliases": sorted(set(a.lower() for a in aliases + [name])),
                "fridaFood": chosen,
                "per100g": {k: (v if v is not None else 0) for k, v in macros.items()},
            }
        )

    if unresolved:
        print(f"\nWARNING: {len(unresolved)} entries had no Frida match and were SKIPPED:")
        for name, cands in unresolved:
            print(f"  - {name}: tried {cands}")

    out = {
        "source": "The Danish Food Composition Database (Frida), version 6.1",
        "publisher": "DTU Fødevareinstituttet (National Food Institute, Technical University of Denmark)",
        "doi": "10.11583/DTU.32312844",
        "license": "CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)",
        "note": "Derived subset for madtrolden-mcp: kcal/protein/fat/carbs per 100 g (carbs = available carbohydrates). Generated by scripts/build-nutrition.py.",
        "ingredients": sorted(entries, key=lambda e: e["name"]),
    }
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\nWrote {len(entries)} ingredients -> {OUT_PATH}")
    return 0 if len(entries) >= 100 else 1


if __name__ == "__main__":
    sys.exit(main())

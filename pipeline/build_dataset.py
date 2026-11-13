"""Merge yearly records, repair words glued at line wraps, derive search fields and stats."""
import json, re, collections, sys

recs = [json.loads(l) for y in (2025, 2026) for l in open(f"data/processed/items_{y}.jsonl")]
TOK = re.compile(r"[A-Z0-9À-Ü']+")
freq = collections.Counter(t for r in recs for it in r["items"] for t in TOK.findall(it))

def resplit(tok):
    """Split tokens glued at a line wrap, e.g. DICREDITO -> DI CREDITO, when both halves
    are common words and far more frequent than the glued form."""
    if len(tok) < 5 or any(ch.isdigit() for ch in tok):
        return tok
    best = None
    for i in range(2, len(tok) - 1):
        a, b = tok[:i], tok[i:]
        if len(b) < 2: continue
        lo = min(freq[a], freq[b])
        if lo >= 150 and lo >= 4 * freq[tok]:
            if not best or lo > best[0]: best = (lo, f"{a} {b}")
    return best[1] if best else tok

fix = lambda s: re.sub(r"\bE(CARTE|TESSERE)\b", r"E \1", TOK.sub(lambda m: resplit(m.group(0)), s))
CATS = [  # (category, keywords) used for facets; first match wins per object
    ("documenti", ["CARTA IDENTITA", "PASSAPORTO", "PATENTE", "PERMESSO DI SOGGIORNO", "TESSERA SANITARIA", "DOCUMENTO", "CODICE FISCALE", "CARTA DI CIRCOLAZIONE", "CERTIFICATO"]),
    ("carte di pagamento", ["CARTA DI CREDITO", "BANCOMAT", "CARTA PREPAGATA", "POSTEPAY"]),
    ("portafogli e borse", ["PORTAFOGLI", "PORTATESSERE", "PORTADOCUMENTI", "BORSA", "BORSELLO", "POCHETTE", "ZAINO", "TROLLEY", "VALIGIA", "BUSTA", "MARSUPIO"]),
    ("telefoni ed elettronica", ["TELEFONO", "CELLULARE", "SMARTPHONE", "IPAD", "TABLET", "PC PORTATILE", "AURICOLAR", "CUFFIE", "CARICA BATTERIA", "SIMCARD", "ELETTRONICA", "SMARTWATCH", "OROLOGIO", "MACCHINA FOTOGRAFICA", "POWERBANK"]),
    ("chiavi", ["CHIAVI", "PORTACHIAVI"]),
    ("denaro", ["DENARO"]),
    ("abbigliamento", ["INDUMENTI", "ABBIGLIAMENTO", "GIUBBOTTO", "GIACCA", "SCARPE", "CAPPELLO", "SCIARPA", "OMBRELLO"]),
    ("occhiali", ["OCCHIAL"]),
    ("gioielli", ["ANELLO", "COLLANA", "BRACCIALE", "ORECCHIN", "GIOIELL"]),
]
def categorize(obj):
    for cat, kws in CATS:
        if any(k in obj for k in kws): return cat
    return "altro"

out, stats = [], collections.Counter()
for r in recs:
    items = [fix(i) for i in r["items"]]
    cats = sorted({categorize(i) for i in items})
    foreign = any(re.search(r"\bESTER[AO]\b", i) for i in items)
    out.append({"id": r["id"], "n": r["number"], "year": r["year"], "date": r["date"], "page": r["page"],
                "objects": items, "categories": cats, "foreign": foreign})
    for c in cats: stats[c] += 1
json.dump(out, open("data/processed/catalogue.json", "w"), ensure_ascii=False, separators=(",", ":"))
print(len(out), dict(stats))
print([o["objects"] for o in out[100:104]])

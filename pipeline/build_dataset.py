"""Merge yearly records, repair words glued at line wraps, derive search fields and stats."""
import json, re, collections, sys

import os
recs = [json.loads(l) for y in (2025, 2026) for l in open(f"data/processed/items_{y}.jsonl")] if os.path.exists("data/processed/items_2026.jsonl") else []
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

ITA_DOC = re.compile(r"^(CARTA IDENTITA'|CARTA D'IDENTITA'|PATENTE DI GUIDA|TESSERA SANITARIA|CODICE FISCALE|PERMESSO DI SOGGIORNO|PASSAPORTO)(?!.*ESTER)")
FOR_DOC = re.compile(r"(PASSAPORTO ESTERO|CARTA IDENTITA' ESTERA|PATENTE DI GUIDA ESTERA|TESSERA SANITARIA ESTERA|DOCUMENTO DI IDENTITA' ESTER)")
PREFIX = re.compile(r"(?:\bNr|\bIMEI)\s*:\s*([A-Z0-9][A-Z0-9 ./\-]*?)\s*\*")


def norm_prefix(p: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", p.upper())


def id_doc_kind(objects):
    ita = any(ITA_DOC.search(o) for o in objects)
    fore = any(FOR_DOC.search(o) for o in objects)
    return "mixed" if ita and fore else "italian" if ita else "foreign" if fore else "none"


def prefixes(objects):
    out = []
    for o in objects:
        for m in PREFIX.finditer(o):
            p = norm_prefix(m.group(1))
            if len(p) >= 3 and p not in out:
                out.append(p)
    return out


if __name__ == "__main__":
    out, stats = [], collections.Counter()
    for r in recs:
        items = [fix(i) for i in r["items"]]
        cats = sorted({categorize(i) for i in items})
        out.append({"id": r["id"], "n": r["number"], "year": r["year"], "date": r["date"], "page": r["page"],
                    "objects": items, "categories": cats, "id_doc": id_doc_kind(items), "prefixes": prefixes(items)})
        for c in cats: stats[c] += 1
        stats["id_doc:" + out[-1]["id_doc"]] += 1
        stats["with_prefix"] += bool(out[-1]["prefixes"])
    json.dump(out, open("data/processed/catalogue.json", "w"), ensure_ascii=False, separators=(",", ":"))
    print(len(out), dict(stats))

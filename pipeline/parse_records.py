"""Turn decoded PDF lines (decode_pdf.py output) into structured found-item records.

Layout of every page: header block, a bold "REPERTO / DESCRIZIONE / DATA ACQUISIZIONE"
row, then records. Each record starts with its date (x~445), the reperto number sits at
x~88 and the description lines at x~144, wrapped at a fixed character width (so wrapped
lines are joined without adding spaces). A footer with the office address closes the
last page.
"""
import json
import re
import sys
from collections import defaultdict

DATE_RE = re.compile(r"^\d{2}/\d{2}/\d{4}$")
FOOTER_PREFIXES = ("Circonvallazione", "Via Prospero", "Tel.")
ITEM_SPLIT = re.compile(r"\s{2,}-\s*")


def fix_mojibake(s: str) -> str:
    try:
        return s.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return s.replace("Â°", "°")


def parse(lines_path: str, year: int):
    pages = defaultdict(list)
    with open(lines_path) as f:
        for raw in f:
            ln = json.loads(raw)
            pages[ln["p"]].append(ln)

    records = []
    current = None
    for pno in sorted(pages):
        lines = pages[pno]
        header_y = max((l["y"] for l in lines if l["bold"] and l["t"].startswith("REPERTO")), default=0)
        body = [l for l in lines if l["y"] > header_y + 1 and not l["t"].strip().startswith(FOOTER_PREFIXES)]
        dates = sorted((l for l in body if l["x"] > 400 and DATE_RE.match(l["t"].strip())), key=lambda l: l["y"])
        for l in sorted(body, key=lambda l: (l["y"], l["x"])):
            text = l["t"]
            if l["x"] > 400 and DATE_RE.match(text.strip()):
                d, m, y = text.strip().split("/")
                current = {"year": year, "page": pno, "date": f"{y}-{m}-{d}", "number": None, "_desc": defaultdict(list)}
                records.append(current)
                continue
            if current is None:
                continue
            if l["x"] < 130 and text.strip().isdigit():
                current["number"] = int(text.strip())
            elif l["x"] >= 130:
                current["_desc"][(l["page"] if "page" in l else pno, l["y"])].append((l["x"], text))
        del dates

    out = []
    for r in records:
        desc = "".join("".join(t for _, t in sorted(parts)) for _, parts in sorted(r.pop("_desc").items()))
        desc = fix_mojibake(desc)
        norm = lambda s: re.sub(r"\s+", " ", s).strip(" -")
        items = [norm(i) for i in ITEM_SPLIT.split(desc) if norm(i)]
        r["description"] = " | ".join(items)
        r["items"] = items
        r["id"] = f"{year}-{r['number']}"
        out.append(r)
    return out


if __name__ == "__main__":
    lines_path, year, out_path = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    recs = parse(lines_path, year)
    with open(out_path, "w") as f:
        for r in recs:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    nums = [r["number"] for r in recs if r["number"] is not None]
    missing_num = sum(1 for r in recs if r["number"] is None)
    gaps = sorted(set(range(min(nums), max(nums) + 1)) - set(nums))
    print(json.dumps({"records": len(recs), "missing_number": missing_num, "min": min(nums), "max": max(nums),
                      "gaps": len(gaps), "gap_sample": gaps[:10], "dupes": len(nums) - len(set(nums))}))

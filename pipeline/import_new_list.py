"""Sentinel importer: fetch the city's current found-items list, decode it, upsert new items, fingerprint
the list, anchor it onchain and check new items against citizens' alerts.

Run from the repo root:  python3 pipeline/import_new_list.py
Env: API_BASE and OPERATOR_TOKEN (Ritrovo API). Everything goes through the operator API: no database or
Supabase account credentials are needed. Idempotent: a list whose sha256 is already known is skipped.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))
os.chdir(ROOT)
import build_dataset as bd  # noqa: E402  (loads word frequencies from the committed records)
from load_supabase import merkle_proofs, merkle_root, record_leaf  # noqa: E402
from parse_records import parse  # noqa: E402

SERVICE_PAGE = "https://www.comune.roma.it/web/it/scheda-servizi.page?contentId=INF39645"
UA = {"User-Agent": "ritrovo-importer/1.0 (+open data reuse)"}


def http_get(url: str) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        return r.read()


def latest_list_url() -> str:
    html = http_get(SERVICE_PAGE).decode("utf-8", "replace")
    links = sorted(set(re.findall(r"/web-resources/cms/documents/(Rinvenimenti_(\d{8})_(\d{8})\.pdf)", html)),
                   key=lambda m: (m[2][4:], m[2][2:4], m[2][:2]))  # sort by end date yyyy, mm, dd
    if not links:
        raise SystemExit("no Rinvenimenti PDF found on the service page")
    return "https://www.comune.roma.it/web-resources/cms/documents/" + links[-1][0]


API_BASE = os.environ.get("API_BASE", "https://izrggntqsssfzazjfhht.supabase.co/functions/v1/api")


def api(path: str, body: dict, strict: bool = False):
    """Ritrovo operator API. strict=True: any error stops the import; otherwise (notifications) it is reported."""
    tok = os.environ.get("OPERATOR_TOKEN")
    if not tok:
        raise SystemExit("OPERATOR_TOKEN is not set")
    req = urllib.request.Request(API_BASE + path, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "x-operator-token": tok})
    try:
        with urllib.request.urlopen(req, timeout=150) as r:
            return json.loads(r.read())
    except Exception as e:
        if strict:
            detail = e.read().decode()[:300] if hasattr(e, "read") else ""
            raise SystemExit(f"{path} failed: {e} {detail}")
        return {"error": str(e)}


def step(name: str, **body):
    return api("/admin/import", {"step": name, **body}, strict=True)


def main():
    url = latest_list_url()
    pdf = http_get(url)
    sha = hashlib.sha256(pdf).hexdigest()
    if step("check", pdf_sha256=sha)["exists"]:
        print("list unchanged:", url)
        return
    year = int(re.search(r"Rinvenimenti_\d{4}(\d{4})_", url).group(1))
    with tempfile.TemporaryDirectory() as tmp:
        pdf_path, lines_path = Path(tmp) / "list.pdf", Path(tmp) / "lines.jsonl"
        pdf_path.write_bytes(pdf)
        out = subprocess.run([sys.executable, "-I", str(ROOT / "pipeline/decode_pdf.py"), str(pdf_path),
                              str(ROOT / "pipeline/glyph_table.json"), str(lines_path)], capture_output=True, text=True, check=True)
        unknown = json.loads(out.stdout.strip().splitlines()[-1])["unknown_glyphs"]
        if unknown:
            raise SystemExit(f"new glyph shapes need labelling: {list(unknown)[:5]}")
        records = parse(str(lines_path), year)

    built = []
    for r in records:
        objs = [bd.fix(i) for i in r["items"]]
        built.append({"id": r["id"], "year": year, "number": r["number"], "date": r["date"], "page": r["page"], "objects": objs,
                      "categories": sorted({bd.categorize(o) for o in objs}), "id_doc": bd.id_doc_kind(objs), "prefixes": bd.prefixes(objs)})
    existing = set(step("existing_ids", year=year)["ids"])
    new = [r for r in built if r["id"] not in existing]
    print(f"{url}: {len(built)} records, {len(new)} new")

    # Insert new records and update existing ones, so the database mirrors the latest list (and its proofs).
    for i in range(0, len(built), 500):
        step("items", items=built[i:i + 500])

    leaves = {r["id"]: record_leaf(r) for r in built}
    root = merkle_root(list(leaves.values()))
    ds = step("dataset", source_url=url, pdf_sha256=sha, records=len(built), merkle_root=root)["dataset_id"]
    print("fingerprint", sha[:16], root[:18], "dataset", ds)
    paths = merkle_proofs(list(leaves.values()))
    rows = [{"id": rid, "proof": paths[leaf]} for rid, leaf in leaves.items()]
    for i in range(0, len(rows), 500):
        step("proofs", dataset_id=ds, rows=rows[i:i + 500])

    print("anchor:", api("/chain/anchor-datasets", {}))
    if new:
        print("alerts:", api("/alerts/scan", {"item_ids": [r["id"] for r in new]}))


if __name__ == "__main__":
    main()

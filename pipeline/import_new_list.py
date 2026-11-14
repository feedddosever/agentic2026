"""Sentinel importer: fetch the city's current found-items list, decode it, upsert new items, fingerprint
the list, anchor it onchain and check new items against citizens' alerts.

Run from the repo root:  python3 pipeline/import_new_list.py <project_ref>
Env: SUPABASE_ACCESS_TOKEN (Management API), API_BASE and OPERATOR_TOKEN (Ritrovo API).
Idempotent: a list whose sha256 is already in `datasets` is skipped.
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
from load_supabase import lit, merkle_root, record_leaf, sql, store_proofs  # noqa: E402
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


def api(path: str, body: dict):
    base, tok = os.environ.get("API_BASE"), os.environ.get("OPERATOR_TOKEN")
    if not base or not tok:
        return None
    req = urllib.request.Request(base + path, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "x-operator-token": tok})
    try:
        with urllib.request.urlopen(req, timeout=150) as r:
            return json.loads(r.read())
    except Exception as e:  # never fail the import because a notification step failed
        return {"error": str(e)}


def main():
    ref = sys.argv[1]
    url = latest_list_url()
    pdf = http_get(url)
    sha = hashlib.sha256(pdf).hexdigest()
    if sql(ref, f"select 1 from public.datasets where pdf_sha256 = {lit(sha)}"):
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
    existing = {row["id"] for row in sql(ref, f"select id from public.items where year = {year} and source = 'official_list'") or []}
    new = [r for r in built if r["id"] not in existing]
    print(f"{url}: {len(built)} records, {len(new)} new")

    cols = "(id, source, year, number, date_acquired, page, objects, categories, id_doc, prefixes)"
    for i in range(0, len(new), 400):
        rows = ",".join(f"({lit(r['id'])},'official_list',{year},{r['number']},{lit(r['date'])}::date,{r['page']},"
                        f"{lit(r['objects'])},{lit(r['categories'])},{lit(r['id_doc'])},{lit(r['prefixes'])})" for r in new[i:i + 400])
        sql(ref, f"insert into public.items {cols} values {rows} on conflict (id) do nothing;")

    root = merkle_root([record_leaf(r) for r in built])
    sql(ref, f"insert into public.datasets (source_url, pdf_sha256, records, merkle_root) values "
             f"({lit(url)}, {lit(sha)}, {len(built)}, {lit(root)}) on conflict (pdf_sha256) do nothing;")
    print("fingerprint", sha[:16], root[:18])
    ds = sql(ref, f"select id from public.datasets where pdf_sha256 = {lit(sha)}")
    store_proofs(ref, built, ds[0]["id"])  # per-record proofs against the root anchored below

    print("anchor:", api("/chain/anchor-datasets", {}))
    if new:
        print("alerts:", api("/alerts/scan", {"item_ids": [r["id"] for r in new]}))


if __name__ == "__main__":
    main()

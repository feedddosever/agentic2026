"""Load the decoded catalogue into Supabase through the Management API SQL endpoint.

Usage: python3 pipeline/load_supabase.py <project_ref> [--migrate]
Auth: the Management API token is sent as `Authorization: Bearer $SUPABASE_ACCESS_TOKEN`
(in the hackathon cloud session the egress proxy injects it; any placeholder works there).
Also computes the dataset fingerprint (sha256 of each official PDF + Merkle root of records)
and stores it in `datasets`.
"""
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
API = "https://api.supabase.com/v1/projects/{ref}/database/query"
SOURCES = {
    2025: ("https://www.comune.roma.it/web-resources/cms/documents/Rinvenimenti_01012025_31122025.pdf",
           ROOT / "data/raw/Rinvenimenti_01012025_31122025.pdf"),
    2026: ("https://www.comune.roma.it/web-resources/cms/documents/Rinvenimenti_01012026_11112026.pdf",
           ROOT / "data/raw/Rinvenimenti_01012026_11112026.pdf"),
}


def sql(ref: str, query: str):
    req = urllib.request.Request(API.format(ref=ref), data=json.dumps({"query": query}).encode(),
                                 headers={"Authorization": f"Bearer {os.environ.get('SUPABASE_ACCESS_TOKEN', 'proxy-injected')}",
                                          "Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"SQL failed ({e.code}): {e.read().decode()[:800]}") from None


def lit(v):
    """SQL literal using dollar quoting (descriptions contain quotes)."""
    if v is None:
        return "null"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, list):
        return "array[" + ",".join(lit(x) for x in v) + "]::text[]" if v else "'{}'::text[]"
    s = str(v)
    tag = "$q$"
    assert tag not in s
    return f"{tag}{s}{tag}"


def record_leaf(r) -> bytes:
    canon = json.dumps({"id": r["id"], "date": r["date"], "objects": r["objects"]}, ensure_ascii=False,
                       separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(canon.encode()).digest()


def merkle_root(leaves):
    level = sorted(leaves)
    if not level:
        return "0x" + "00" * 32
    while len(level) > 1:
        if len(level) % 2:
            level.append(level[-1])
        level = [hashlib.sha256(min(a, b) + max(a, b)).digest() for a, b in zip(level[::2], level[1::2])]
    return "0x" + level[0].hex()


def merkle_proofs(leaves):
    """Proof (sibling hashes, leaf to root) for every leaf of the tree built by merkle_root()."""
    level = sorted(leaves)
    index = {leaf: i for i, leaf in enumerate(level)}
    paths = {leaf: [] for leaf in level}
    pos = dict(index)
    while len(level) > 1:
        if len(level) % 2:
            level.append(level[-1])
        for leaf, i in pos.items():
            paths[leaf].append("0x" + level[i ^ 1].hex())
        level = [hashlib.sha256(min(a, b) + max(a, b)).digest() for a, b in zip(level[::2], level[1::2])]
        pos = {leaf: i // 2 for leaf, i in pos.items()}
    return paths


def store_proofs(ref, recs, dataset_id, batch=400):
    """Save each record's Merkle proof so anyone can check it against the root anchored on Avalanche."""
    leaves = {r["id"]: record_leaf(r) for r in recs}
    paths = merkle_proofs(list(leaves.values()))
    rows = [(rid, paths[leaf]) for rid, leaf in leaves.items()]
    for i in range(0, len(rows), batch):
        values = ",".join(f"({lit(rid)}, {lit(p)})" for rid, p in rows[i:i + batch])
        sql(ref, f"update public.items set dataset_id = {int(dataset_id)}, merkle_proof = v.p "
                 f"from (values {values}) as v(id, p) where items.id = v.id;")


def main():
    ref = sys.argv[1]
    if "--migrate" in sys.argv:
        for f in sorted((ROOT / "supabase/migrations").glob("*.sql")):
            print("migrating", f.name)
            sql(ref, f.read_text())
    cat = json.load((ROOT / "data/processed/catalogue.json").open())
    cols = "(id, source, year, number, date_acquired, page, objects, categories, id_doc, prefixes)"
    batch = 400
    for i in range(0, len(cat), batch):
        rows = ",".join(
            f"({lit(r['id'])},'official_list',{r['year']},{r['n']},{lit(r['date'])}::date,{r['page']},"
            f"{lit(r['objects'])},{lit(r['categories'])},{lit(r['id_doc'])},{lit(r['prefixes'])})"
            for r in cat[i:i + batch])
        sql(ref, f"insert into public.items {cols} values {rows} on conflict (id) do update set "
                 "objects = excluded.objects, categories = excluded.categories, id_doc = excluded.id_doc, "
                 "prefixes = excluded.prefixes;")
        print(f"loaded {min(i + batch, len(cat))}/{len(cat)}", flush=True)
    for year, (url, path) in SOURCES.items():
        recs = [r for r in cat if r["year"] == year]
        sha = hashlib.sha256(path.read_bytes()).hexdigest()
        root = merkle_root([record_leaf(r) for r in recs])
        sql(ref, f"insert into public.datasets (source_url, pdf_sha256, records, merkle_root) values "
                 f"({lit(url)}, {lit(sha)}, {len(recs)}, {lit(root)}) on conflict (pdf_sha256) do nothing;")
        print(year, sha[:16], root[:18], len(recs))
    print(sql(ref, "select count(*) as items from public.items;"))


if __name__ == "__main__":
    main()

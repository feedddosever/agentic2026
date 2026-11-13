"""Write data/processed/datasets.json: sha256 of each official PDF + Merkle root of its decoded records.
The same values are stored in Supabase `datasets` (load_supabase.py) and anchored onchain (contracts/scripts/deploy.js)."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import hashlib  # noqa: E402
from load_supabase import SOURCES, merkle_root, record_leaf  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
cat = json.load((ROOT / "data/processed/catalogue.json").open())
out = []
for year, (url, path) in SOURCES.items():
    recs = [r for r in cat if r["year"] == year]
    out.append({"year": year, "source_url": url, "pdf_sha256": "0x" + hashlib.sha256(path.read_bytes()).hexdigest(),
                "records": len(recs), "merkle_root": merkle_root([record_leaf(r) for r in recs])})
(ROOT / "data/processed/datasets.json").write_text(json.dumps(out, indent=1))
print(json.dumps(out, indent=1))

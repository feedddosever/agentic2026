"""Regression tests for the decoder, parser and dataset builder (run: pytest -q)."""
import json, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))


def test_decoder_page_one(tmp_path):
    out = tmp_path / "lines.jsonl"
    pdf = ROOT / "data/raw/Rinvenimenti_01012026_11112026.pdf"
    res = subprocess.run([sys.executable, "-I", str(ROOT / "pipeline/decode_pdf.py"), str(pdf),
                          str(ROOT / "pipeline/glyph_table.json"), str(out)], capture_output=True, text=True, check=True)
    assert json.loads(res.stdout.strip().splitlines()[-1])["unknown_glyphs"] == {}
    texts = [json.loads(l)["t"] for l in out.open() if json.loads(l)["p"] == 1]
    assert "OGGETTI REPERTORIATI DAL 01/01/2026 AL 11/11/2026" in texts
    assert "02/01/2026" in texts and "CARTA DI CREDITO ITA BNL  -    " in texts


def test_parsed_records_complete():
    for year, count in ((2025, 8903), (2026, 6940)):
        nums = [json.loads(l)["number"] for l in (ROOT / f"data/processed/items_{year}.jsonl").open()]
        assert sorted(nums) == list(range(1, count + 1))


def test_prefix_and_doc_kind():
    import build_dataset as b
    objs = ["PORTAFOGLI", "CARTA IDENTITA' - Nr: CA718* * * *", "PASSAPORTO ESTERO - Nr: EL655* * * *",
            "TELEFONO CELLULARE CON SIM -LG - IMEI: 3536711115* * * * *", "TESSERE VARIE - Nr: N/D"]
    assert b.prefixes(objs) == ["CA718", "EL655", "3536711115"]
    assert b.id_doc_kind(objs) == "mixed"
    assert b.id_doc_kind(["PASSAPORTO ESTERO - Nr: X1* *"]) == "foreign"
    assert b.id_doc_kind(["ZAINO"]) == "none"


def test_catalogue_lookup_by_prefix():
    cat = json.load((ROOT / "data/processed/catalogue.json").open())
    assert len(cat) == 15843
    hit = [r for r in cat if "EL655" in r["prefixes"]]
    assert hit and hit[0]["id_doc"] == "foreign"

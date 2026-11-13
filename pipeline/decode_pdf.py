"""Decode Roma Capitale 'Rinvenimenti' PDFs whose Type 3 fonts have no Unicode map.
Each glyph is identified by a hash of its CharProc drawing stream; a hand-labelled
table maps hash -> character. Outputs one JSON line per text line with page and coords."""
import sys, re, hashlib, json, pymupdf
pdf, table_path, out_path = sys.argv[1:4]
table = json.load(open(table_path))
doc = pymupdf.open(pdf)
hc, fm, unknown = {}, {}, {}
def gh(x):
    if x not in hc: hc[x] = hashlib.sha1(doc.xref_stream(x)).hexdigest()[:12]
    return hc[x]
def font_map(fx):
    if fx not in fm:
        cp = doc.xref_get_key(fx, "CharProcs")[1]
        n2x = {a: int(b) for a, b in re.findall(r"/(\S+?) (\d+) 0 R", cp)}
        encx = int(doc.xref_get_key(fx, "Encoding")[1].split()[0])
        code, m = None, {}
        for t in re.findall(r"\d+|/[^\s/\]\[]+", doc.xref_get_key(encx, "Differences")[1]):
            if t.startswith("/"): m[code] = gh(n2x[t[1:]]); code += 1
            else: code = int(t)
        fm[fx] = m
    return fm[fx]
with open(out_path, "w") as out:
    for pno, page in enumerate(doc):
        fonts = page.get_fonts(full=True)
        m = font_map(fonts[0][0])
        for b in page.get_text("rawdict")["blocks"]:
            for l in b.get("lines", []):
                for s in l["spans"]:
                    txt, bold = [], 0
                    for ch in s["chars"]:
                        h = m.get(ord(ch["c"]))
                        g = table.get(h)
                        if g is None:
                            unknown.setdefault(h, (pno, ch["origin"])); txt.append("�")
                        else:
                            txt.append(g["c"]); bold += g["bold"]
                    if txt:
                        out.write(json.dumps({"p": pno + 1, "x": round(s["origin"][0], 1), "y": round(s["origin"][1], 1),
                                              "bold": bold > len(txt) / 2, "t": "".join(txt)}, ensure_ascii=False) + "\n")
print(json.dumps({"pages": len(doc), "unknown_glyphs": unknown}))

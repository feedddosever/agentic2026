"""Slides and overlays for the Italian demo video (1280x720)."""
import sys, textwrap
from PIL import Image, ImageDraw, ImageFont, ImageFilter
V = sys.argv[1]; S = f"{V}/slides"; GLYPHS = sys.argv[2]
W, H = 1280, 720
BG, INK, MUTED, TEAL, ORANGE, BORDER = "#fbf7f1", "#1c1f26", "#5b5f66", "#1d5f62", "#b44e2a", "#dddbd7"
F = lambda p, s: ImageFont.truetype(p, s)
SERIF = "/usr/share/fonts/truetype/crosextra/Caladea-Bold.ttf"
SANS = "/usr/share/fonts/opentype/inter/Inter-Regular.otf"; SANS_M = "/usr/share/fonts/opentype/inter/Inter-Medium.otf"
SANS_SB = "/usr/share/fonts/opentype/inter/Inter-SemiBold.otf"; MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"

def base():
    return Image.new("RGB", (W, H), BG)

def shadow_paste(im, card, xy, radius=18):
    sh = Image.new("RGBA", (card.width + 60, card.height + 60), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rectangle((30, 36, 30 + card.width, 36 + card.height), fill=(40, 30, 20, 60))
    sh = sh.filter(ImageFilter.GaussianBlur(radius))
    im.paste(sh, (xy[0] - 30, xy[1] - 30), sh); im.paste(card, xy)

def label(d, xy, text, color=TEAL):
    d.text(xy, " ".join(text.upper()).replace("   ", "  "), font=F(SANS_SB, 15), fill=color)

# Scene 1: the official PDF, then its copied text.
pdf = Image.open(f"{S}/pdf_p1.png").convert("RGB").crop((60, 0, 880, 1060))
pdf = pdf.resize((int(pdf.width * 600 / pdf.height), 600), Image.LANCZOS)
for variant in ("a", "b"):
    im = base(); d = ImageDraw.Draw(im)
    shadow_paste(im, pdf, (80, 60))
    x = 600
    label(d, (x, 92), "Elenco ufficiale · Roma Capitale")
    d.text((x, 122), "Oggetti rinvenuti", font=F(SERIF, 54), fill=INK)
    d.text((x, 186), "~600 al mese · 510 pagine di PDF", font=F(SANS_M, 24), fill=MUTED)
    if variant == "a":
        d.text((x, 250), "Pubblicato dal Reparto Oggetti Rinvenuti,\nun reperto per riga, aggiornato ogni mese.", font=F(SANS, 21), fill=MUTED, spacing=8)
    else:
        box = (x, 245, W - 70, 655)
        d.rounded_rectangle(box, 16, fill="#1c1f26")
        d.text((x + 24, 263), "Testo copiato dal PDF  (Ctrl+C → Ctrl+V)", font=F(SANS_M, 17), fill="#b9bec7")
        raw = open(f"{S}/garbage.txt", encoding="utf-8").read()
        vis = "".join("□" if ord(c) < 32 and c != "\n" else c for c in raw).replace("\n", " ")
        lines = textwrap.wrap(vis, 41)[:14]
        d.multiline_text((x + 24, 300), "\n".join(lines), font=F(MONO, 18), fill="#f0e6c8", spacing=7)
    im.save(f"{S}/s1{variant}.png")

# Scene 2 opener: the decoded glyph table.
im = base(); d = ImageDraw.Draw(im)
label(d, (80, 70), "La decifrazione")
d.text((80, 98), "Un font senza mappa: 102 glifi, riconosciuti uno per uno", font=F(SERIF, 40), fill=INK)
g = Image.open(GLYPHS).convert("RGB"); g = g.resize((int(g.width * 1.12), int(g.height * 1.12)), Image.LANCZOS)
shadow_paste(im, g, ((W - g.width) // 2, 170))
d.text((80, 170 + g.height + 34), "Ogni forma ha un'impronta (sha1 del disegno) → la lettera giusta. Risultato: 15.843 reperti, zero errori.",
       font=F(SANS, 20), fill=MUTED)
im.save(f"{S}/s2a.png")

# Closing card.
im = base(); d = ImageDraw.Draw(im)
d.rounded_rectangle((80, 150, 140, 210), 14, fill=ORANGE)
d.ellipse((96, 166, 116, 186), outline="white", width=4); d.line((112, 182, 126, 196), fill="white", width=5)
d.text((160, 140), "Ritrovo", font=F(SERIF, 72), fill=INK)
d.text((82, 250), "Smettiamo di aspettare che le persone cerchino.\nIniziamo a restituire.", font=F(SERIF, 44), fill=INK, spacing=10)
d.text((82, 400), "screenshot-to-spark-3870.lovable.app", font=F(SANS_SB, 26), fill=TEAL)
d.text((82, 442), "github.com/feedddosever/agentic2026  ·  open source", font=F(SANS_M, 22), fill=MUTED)
d.line((82, 520, W - 82, 520), fill=BORDER, width=2)
d.text((82, 540), "Claude  ·  ElevenLabs  ·  Exa  ·  Avalanche (ERC-8004)  ·  Supabase  ·  Lovable", font=F(SANS_M, 21), fill=MUTED)
d.text((82, 585), "Agentic Hack Rome 2026 · Sfida 03, Oggetti smarriti · Prototipo, non è un servizio ufficiale di Roma Capitale.",
       font=F(SANS, 16), fill=MUTED)
im.save(f"{S}/s6b.png")

# Call HUD (transparent overlay for scene 4).
hud = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(hud)
box = (W - 470, 78, W - 24, 128)
d.rounded_rectangle(box, 25, fill=(29, 95, 98, 235))
d.ellipse((box[0] + 20, 96, box[0] + 34, 110), fill="#ff6b57")
d.text((box[0] + 46, 91), "In chiamata con Ritrovo · parla inglese", font=F(SANS_SB, 19), fill="white")
hud.save(f"{S}/hud.png")
print("ok")

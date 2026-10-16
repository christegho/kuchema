"""Draw Figure 3 (artistic process with the AI process) as a hand-laid-out SVG.

Mermaid's automatic layouts reorder the phases around the two feedback loops,
so this figure places every element explicitly. Style matches figures 1 and 2.
Run: python3 diagrams/fig3-artistic-process.py  (writes fig3-artistic-process.svg)
"""
from html import escape
from pathlib import Path

W = 1420
BAND_X, BAND_W = 70, W - 140          # loop lanes run in the side margins
LEFT_LANE, RIGHT_LANE = 40, W - 40
FONT = "Helvetica Neue, Helvetica, Arial, sans-serif"
LINE, PAD_Y, PAD_X, CHAR = 17, 12, 18, 7.0

STYLE = {
    "community": dict(fill="#ffffff", stroke="#111", width=1.2, dash="2 3", shape="pill"),
    "artist":    dict(fill="#ffffff", stroke="#000", width=2.4, dash=None, shape="round"),
    "rule":      dict(fill="#ffffff", stroke="#111", width=1.2, dash=None, shape="bars"),
    "ai":        dict(fill="#e4e4e4", stroke="#111", width=1.4, dash=None, shape="rect"),
    "output":    dict(fill="#ffffff", stroke="#111", width=1.0, dash=None, shape="rect"),
    "visitor":   dict(fill="#ffffff", stroke="#000", width=1.6, dash=None, shape="pill"),
}

# (style, lines, first line bold)
BANDS = [
    ("I", "Situated research", "community contributors and the lead artist", [
        ("community", ["Community knowledge holders", "oral histories, water places,", "ecological practice"], True),
        ("community", ["Youth participants", "climate-futures workshop"], True),
        ("artist", ["Prior research", "how mainstream generative AI", "flattens culturally specific futures"], True),
    ]),
    ("II", "Curation and authorship", "lead artist", [
        ("artist", ["Photographic archive", "people · water places · landscape", "the artist's collages"], True),
        ("artist", ["Texts", "oral histories, mythologies,", "cosmologies, youth insights,", "scholarship"], True),
        ("artist", ["Permissions and restrictions", "for each photograph"], True),
        ("artist", ["Art direction", "visual language, creative", "directions, cultural safeguards"], True),
    ]),
    ("III", "Translation into rules", "lead artist with the AI developer", [
        ("rule", ["Only photographs of people", "enter the collage, as whole", "cut-out figures, never", "generated or altered"], False),
        ("rule", ["Photographs of water and", "land inform newly made", "material rather than", "being pasted"], False),
        ("rule", ["Withheld knowledge stays", "withheld; absence becomes", "a compositional principle"], False),
        ("rule", ["Rooted in place, not in", "generic “African” or", "science-fiction futures"], False),
        ("rule", ["Visibly assembled:", "irregular cuts, overlaps", "and shifts of scale"], False),
    ]),
    ("IV", "Machine collage-making", "AI system", [
        ("ai", ["Reading and composing", "gathers cited context, studies the", "archive and one of the artist's", "collages, plans every fragment"], True),
        ("ai", ["Making and cutting", "generates new water and land", "material, locates and cuts out", "each fragment"], True),
        ("ai", ["Arranging and stepping back", "layers fragments on a water and", "earth ground, critiques the draft", "and revises it"], True),
    ]),
]
OUTPUT = ("output", ["Speculative collage with its provenance", "photographs, passages and generated material"], True)
REVIEW = ("V", "Review and encounter", "visitors and the lead artist", [
    ("visitor", ["The Gathering", "visitors interact with ceremonial", "artefacts; each interaction starts", "a new collage, projected and animated"], True),
    ("artist", ["Studio review", "the artist rearranges fragments,", "re-cuts failed parts and gives", "creative feedback"], True),
])

svg = []
def add(s): svg.append(s)

def size(lines, bold):
    width = max(len(l) * (CHAR + (0.5 if bold and i == 0 else 0)) for i, l in enumerate(lines))
    return width + 2 * PAD_X, len(lines) * LINE + 2 * PAD_Y

def text_block(cx, top, lines, bold, size_px=13):
    y = top + PAD_Y + 13
    for i, line in enumerate(lines):
        weight = ' font-weight="bold"' if bold and i == 0 else ""
        add(f'<text x="{cx:.1f}" y="{y:.1f}" text-anchor="middle" font-size="{size_px}"{weight}>{escape(line)}</text>')
        y += LINE

def node(style, lines, bold, cx, top, h=None):
    s = STYLE[style]
    w, nh = size(lines, bold)
    if s["shape"] == "pill":
        w += 16
    h = h or nh
    x = cx - w / 2
    dash = f' stroke-dasharray="{s["dash"]}"' if s["dash"] else ""
    rx = {"pill": min(h / 2, 24), "round": 6}.get(s["shape"], 0)
    add(f'<rect x="{x:.1f}" y="{top:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{rx}" fill="{s["fill"]}" stroke="{s["stroke"]}" stroke-width="{s["width"]}"{dash}/>')
    if s["shape"] == "bars":
        for bx in (x + 7, x + w - 7):
            add(f'<line x1="{bx:.1f}" y1="{top:.1f}" x2="{bx:.1f}" y2="{top + h:.1f}" stroke="{s["stroke"]}" stroke-width="{s["width"]}"/>')
    text_block(cx, top + (h - nh) / 2, lines, bold)
    return dict(x=x, y=top, w=w, h=h, cx=cx, cy=top + h / 2)

def path(points, dashed=False, arrow=True):
    d = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in points)
    dash = ' stroke-dasharray="5 4"' if dashed else ""
    marker = ' marker-end="url(#arrow)"' if arrow else ""
    add(f'<path d="{d}" fill="none" stroke="#333" stroke-width="1.3"{dash}{marker}/>')

def band(numeral, title, actors, items, top, chain=False):
    heights = [size(lines, bold)[1] for _, lines, bold in items]
    row_h = max(heights)
    h = 40 + row_h + 18
    add(f'<rect x="{BAND_X}" y="{top}" width="{BAND_W}" height="{h}" fill="#f5f5f5" stroke="#a0a0a0" stroke-width="1"/>')
    add(f'<text x="{BAND_X + 16}" y="{top + 25}" font-size="15" font-weight="bold">{numeral} · {escape(title)}</text>')
    add(f'<text x="{BAND_X + BAND_W - 16}" y="{top + 25}" font-size="13" font-style="italic" fill="#444" text-anchor="end">{escape(actors)}</text>')
    slot = (BAND_W - 40) / len(items)
    nodes = [node(style, lines, bold, BAND_X + 20 + (i + 0.5) * slot, top + 40, row_h)
             for i, (style, lines, bold) in enumerate(items)]
    if chain:
        for a, b in zip(nodes, nodes[1:]):
            path([(a["x"] + a["w"], a["cy"]), (b["x"] - 2, b["cy"])])
    return nodes, top + h

GAP = 44
y = 20
rows = []
for i, (numeral, title, actors, items) in enumerate(BANDS):
    if i:
        path([(W / 2, y), (W / 2, y + GAP - 2)])
        y += GAP
    nodes, bottom = band(numeral, title, actors, items, y, chain=numeral == "IV")
    rows.append(nodes)
    y = bottom

# Machine output, then the two kinds of review.
arrange = rows[3][2]
out_top = y + GAP
path([(arrange["cx"], arrange["y"] + arrange["h"]), (arrange["cx"], y + GAP / 2), (W / 2, y + GAP / 2), (W / 2, out_top - 2)])
out = node(*OUTPUT, W / 2, out_top)
y = out_top + out["h"]
review_top = y + GAP
review, review_bottom = band(*REVIEW, review_top)
for target in review:
    path([(W / 2, y), (W / 2, y + GAP / 2), (target["cx"], y + GAP / 2), (target["cx"], target["y"] - 2)])

# Loops: each visitor interaction restarts the making; studio feedback returns to the art direction.
gathering, studio = review
reading, art_direction = rows[3][0], rows[1][3]
path([(gathering["x"], gathering["cy"]), (LEFT_LANE, gathering["cy"]), (LEFT_LANE, reading["cy"]), (reading["x"] - 2, reading["cy"])], dashed=True)
path([(studio["x"] + studio["w"], studio["cy"]), (RIGHT_LANE, studio["cy"]), (RIGHT_LANE, art_direction["cy"]), (art_direction["x"] + art_direction["w"] + 2, art_direction["cy"])], dashed=True)
mid = (gathering["cy"] + reading["cy"]) / 2
add(f'<text transform="translate({LEFT_LANE - 12},{mid:.1f}) rotate(-90)" text-anchor="middle" font-size="13" font-style="italic">each interaction starts a new collage</text>')
mid = (studio["cy"] + art_direction["cy"]) / 2
add(f'<text transform="translate({RIGHT_LANE + 20},{mid:.1f}) rotate(-90)" text-anchor="middle" font-size="13" font-style="italic">creative feedback refines the direction and rules</text>')

# Key.
key_y = review_bottom + 34
add(f'<text x="{BAND_X}" y="{key_y + 16}" font-size="13" font-weight="bold">Key</text>')
x = BAND_X + 46
for style, label in [("community", "Community contributors"), ("artist", "Lead artist"), ("rule", "Rule encoded by artist and AI developer"), ("ai", "AI system"), ("visitor", "Visitors")]:
    s = STYLE[style]
    dash = f' stroke-dasharray="{s["dash"]}"' if s["dash"] else ""
    rx = {"pill": 11, "round": 5}.get(s["shape"], 0)
    add(f'<rect x="{x}" y="{key_y}" width="40" height="22" rx="{rx}" fill="{s["fill"]}" stroke="{s["stroke"]}" stroke-width="{s["width"]}"{dash}/>')
    if s["shape"] == "bars":
        for bx in (x + 6, x + 34):
            add(f'<line x1="{bx}" y1="{key_y}" x2="{bx}" y2="{key_y + 22}" stroke="{s["stroke"]}" stroke-width="{s["width"]}"/>')
    add(f'<text x="{x + 50}" y="{key_y + 16}" font-size="13">{escape(label)}</text>')
    x += 50 + len(label) * CHAR + 34
path([(x, key_y + 11), (x + 40, key_y + 11)], dashed=True)
add(f'<text x="{x + 50}" y="{key_y + 16}" font-size="13">Feedback loop</text>')

H = key_y + 44
head = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="{FONT}" fill="#000">'
        '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
        '<path d="M0,0 L10,5 L0,10 z" fill="#333"/></marker></defs>'
        f'<rect width="{W}" height="{H}" fill="#ffffff"/>')
out_path = Path(__file__).with_name("fig3-artistic-process.svg")
out_path.write_text(head + "\n".join(svg) + "</svg>\n", encoding="utf-8")
print(f"{out_path.name}: {W} x {H}")

"""Draw Figure 3 (artistic process with the AI process) as a hand-laid-out SVG.

Mermaid's automatic layouts reorder the phases around the two feedback loops,
so this figure places every element explicitly. Style matches figures 1 and 2.
Run: python3 diagrams/fig3-artistic-process.py  (writes fig3-artistic-process.svg)
"""
from pathlib import Path

from svgfig import Figure, size

W = 1420
BAND_X, BAND_W = 70, W - 140          # loop lanes run in the side margins
LEFT_LANE, RIGHT_LANE = 40, W - 40

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

fig = Figure(W)
node, path = fig.node, fig.path

def band(numeral, title, actors, items, top, chain=False):
    heights = [size(lines, bold)[1] for _, lines, bold in items]
    row_h = max(heights)
    h = 40 + row_h + 18
    fig.group(BAND_X, top, BAND_W, h, f"{numeral} · {title}", actors)
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
fig.label(LEFT_LANE - 12, mid, "each interaction starts a new collage", rotate=-90)
mid = (studio["cy"] + art_direction["cy"]) / 2
fig.label(RIGHT_LANE + 20, mid, "creative feedback refines the direction and rules", rotate=-90)

# Key.
key_y = review_bottom + 34
fig.key(BAND_X, key_y, [("community", "Community contributors"), ("artist", "Lead artist"), ("rule", "Rule encoded by artist and AI developer"), ("ai", "AI system"), ("visitor", "Visitors")], "Feedback loop")
fig.save(Path(__file__).with_name("fig3-artistic-process.svg"), key_y + 44)

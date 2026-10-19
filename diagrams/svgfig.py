"""Shared drawing helpers for the hand-laid-out figures (grayscale, print-safe).

Figures whose loops or groupings defeat Mermaid's automatic layout place every
element explicitly with these helpers, in the same style as figures 1 and 2.
"""
from html import escape
from pathlib import Path

FONT = "Helvetica Neue, Helvetica, Arial, sans-serif"
LINE, PAD_Y, PAD_X, CHAR = 17, 12, 18, 7.0

STYLE = {
    "community": dict(fill="#ffffff", stroke="#111", width=1.2, dash="2 3", shape="pill"),
    "artist":    dict(fill="#ffffff", stroke="#000", width=2.4, dash=None, shape="round"),
    "rule":      dict(fill="#ffffff", stroke="#111", width=1.2, dash=None, shape="bars"),
    "ai":        dict(fill="#e4e4e4", stroke="#111", width=1.4, dash=None, shape="rect"),
    "output":    dict(fill="#ffffff", stroke="#111", width=1.0, dash=None, shape="rect"),
    "visitor":   dict(fill="#ffffff", stroke="#000", width=1.6, dash=None, shape="pill"),
    "client":    dict(fill="#ffffff", stroke="#111", width=1.4, dash=None, shape="round"),
    "component": dict(fill="#ffffff", stroke="#555", width=1.0, dash=None, shape="rect"),
    "core":      dict(fill="#ffffff", stroke="#000", width=2.2, dash=None, shape="rect"),
    "local":     dict(fill="#ffffff", stroke="#111", width=1.4, dash="5 3", shape="rect"),
    "store":     dict(fill="#ffffff", stroke="#111", width=1.0, dash=None, shape="cylinder"),
}


def size(lines, bold):
    width = max(len(l) * (CHAR + (0.5 if bold and i == 0 else 0)) for i, l in enumerate(lines))
    return width + 2 * PAD_X, len(lines) * LINE + 2 * PAD_Y


class Figure:
    def __init__(self, width):
        self.width, self.parts = width, []

    def add(self, s):
        self.parts.append(s)

    def text_block(self, cx, top, lines, bold, size_px=13):
        y = top + PAD_Y + 13
        for i, line in enumerate(lines):
            weight = ' font-weight="bold"' if bold and i == 0 else ""
            self.add(f'<text x="{cx:.1f}" y="{y:.1f}" text-anchor="middle" font-size="{size_px}"{weight}>{escape(line)}</text>')
            y += LINE

    def node(self, style, lines, bold, cx, top, h=None, w=None):
        """Draw a labelled shape centred on cx; returns its box for routing edges."""
        s = STYLE[style]
        nw, nh = size(lines, bold)
        if s["shape"] == "pill":
            nw += 16
        w, h = w or nw, h or nh
        x = cx - w / 2
        dash = f' stroke-dasharray="{s["dash"]}"' if s["dash"] else ""
        paint = f'fill="{s["fill"]}" stroke="{s["stroke"]}" stroke-width="{s["width"]}"{dash}'
        if s["shape"] == "cylinder":
            ry = 7
            self.add(f'<path d="M{x:.1f},{top + ry:.1f} L{x:.1f},{top + h - ry:.1f} A{w / 2:.1f},{ry} 0 0 0 {x + w:.1f},{top + h - ry:.1f} L{x + w:.1f},{top + ry:.1f}" {paint}/>')
            self.add(f'<ellipse cx="{cx:.1f}" cy="{top + ry:.1f}" rx="{w / 2:.1f}" ry="{ry}" {paint}/>')
            self.text_block(cx, top + (h - nh) / 2 + ry / 2, lines, bold)
            return dict(x=x, y=top, w=w, h=h, cx=cx, cy=top + h / 2)
        rx = {"pill": min(h / 2, 24), "round": 6}.get(s["shape"], 0)
        self.add(f'<rect x="{x:.1f}" y="{top:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{rx}" {paint}/>')
        if s["shape"] == "bars":
            for bx in (x + 7, x + w - 7):
                self.add(f'<line x1="{bx:.1f}" y1="{top:.1f}" x2="{bx:.1f}" y2="{top + h:.1f}" stroke="{s["stroke"]}" stroke-width="{s["width"]}"/>')
        self.text_block(cx, top + (h - nh) / 2, lines, bold)
        return dict(x=x, y=top, w=w, h=h, cx=cx, cy=top + h / 2)

    def group(self, x, y, w, h, title, subtitle=None, fill="#f5f5f5", title_size=15):
        """A titled container; nested groups use a white fill to stay distinct."""
        self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}" stroke="#a0a0a0" stroke-width="1"/>')
        self.add(f'<text x="{x + 16}" y="{y + 25}" font-size="{title_size}" font-weight="bold">{escape(title)}</text>')
        if subtitle:
            self.add(f'<text x="{x + w - 16}" y="{y + 25}" font-size="13" font-style="italic" fill="#444" text-anchor="end">{escape(subtitle)}</text>')

    def path(self, points, dashed=False, arrow=True, both=False):
        d = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in points)
        dash = ' stroke-dasharray="5 4"' if dashed else ""
        marker = (' marker-end="url(#arrow)"' if arrow else "") + (' marker-start="url(#arrow)"' if both else "")
        self.add(f'<path d="{d}" fill="none" stroke="#333" stroke-width="1.3"{dash}{marker}/>')

    def label(self, x, y, text, anchor="middle", italic=True, size_px=13, rotate=None):
        style = ' font-style="italic"' if italic else ""
        where = f'transform="translate({x:.1f},{y:.1f}) rotate({rotate})"' if rotate is not None else f'x="{x:.1f}" y="{y:.1f}"'
        self.add(f'<text {where} text-anchor="{anchor}" font-size="{size_px}"{style}>{escape(text)}</text>')

    def key(self, x, y, items, loop_label=None):
        """A one-line key of sample shapes; returns the y below it."""
        self.add(f'<text x="{x}" y="{y + 16}" font-size="13" font-weight="bold">Key</text>')
        x += 46
        for style, label in items:
            s = STYLE[style]
            dash = f' stroke-dasharray="{s["dash"]}"' if s["dash"] else ""
            paint = f'fill="{s["fill"]}" stroke="{s["stroke"]}" stroke-width="{s["width"]}"{dash}'
            if s["shape"] == "cylinder":
                self.add(f'<path d="M{x},{y + 4} L{x},{y + 18} A20,4 0 0 0 {x + 40},{y + 18} L{x + 40},{y + 4}" {paint}/>')
                self.add(f'<ellipse cx="{x + 20}" cy="{y + 4}" rx="20" ry="4" {paint}/>')
            else:
                rx = {"pill": 11, "round": 5}.get(s["shape"], 0)
                self.add(f'<rect x="{x}" y="{y}" width="40" height="22" rx="{rx}" {paint}/>')
            if s["shape"] == "bars":
                for bx in (x + 6, x + 34):
                    self.add(f'<line x1="{bx}" y1="{y}" x2="{bx}" y2="{y + 22}" stroke="{s["stroke"]}" stroke-width="{s["width"]}"/>')
            self.add(f'<text x="{x + 50}" y="{y + 16}" font-size="13">{escape(label)}</text>')
            x += 50 + len(label) * CHAR + 34
        if loop_label:
            self.path([(x, y + 11), (x + 40, y + 11)], dashed=True)
            self.add(f'<text x="{x + 50}" y="{y + 16}" font-size="13">{escape(loop_label)}</text>')
        return y + 22

    def save(self, path, height):
        head = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.width}" height="{height}" viewBox="0 0 {self.width} {height}" font-family="{FONT}" fill="#000">'
                '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
                '<path d="M0,0 L10,5 L0,10 z" fill="#333"/></marker></defs>'
                f'<rect width="{self.width}" height="{height}" fill="#ffffff"/>')
        Path(path).write_text(head + "\n".join(self.parts) + "</svg>\n", encoding="utf-8")
        print(f"{Path(path).name}: {self.width} x {height}")

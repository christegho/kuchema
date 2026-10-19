"""Draw the software architecture: processes, storage and external services.

Complements fig1 (AI roles) with the deployment view a technical collaborator
needs to run the installation. Laid out by hand so connections never cross.
Run: python3 diagrams/software-architecture.py  (writes software-architecture.svg)
"""
from pathlib import Path

from svgfig import Figure

fig = Figure(1680)
node, path, group, label = fig.node, fig.path, fig.group, fig.label

# Clients.
group(20, 150, 250, 245, "Clients")
web = node("client", ["Studio web app", "React and Konva canvas", "in the browser"], True, 145, 190, w=200)
td = node("client", ["TouchDesigner", "installation display,", "Web Client DAT"], True, 145, 285, w=200)

# Studio computer: the Node server and its services, the vision worker and local files.
group(350, 20, 990, 780, "Studio computer")
group(370, 56, 950, 404, "Node.js server · Express", fill="#ffffff", title_size=14)
api = node("component", ["HTTP API", "studio, creations,", "archive, project,", "media"], True, 465, 200, h=140)
pipe = node("core", ["Creation pipeline", "orchestrates one", "collage at a time"], True, 680, api["cy"] - 37.5)
group(820, 90, 480, 350, "Pipeline services", title_size=13)
router = node("component", ["Provider router", "health-ordered failover between providers"], True, 1060, 130, w=420)
node("component", ["Validation", "Zod schemas and project rules"], True, 1060, 200, w=420)
node("component", ["Image processing", "sharp: treatments, layout repair, compositing"], True, 1060, 270, w=420)
store = node("component", ["Studio store", "assets, studies,", "provenance"], True, 965, 345, w=260)
research = node("component", ["Research index", "pdf.js text", "extraction"], True, 1200, 345, w=170)

group(370, 490, 390, 120, "Python vision worker · child process", fill="#ffffff", title_size=14)
yolo = node("local", ["YOLO11n", "person detection"], True, 470, 535, w=150)
sam = node("local", ["SAM 2.1 tiny", "segmentation"], True, 660, 535, w=150)

group(370, 640, 950, 140, "Local files", fill="#ffffff", title_size=14)
models = node("store", ["models/", "YOLO and SAM", "weights"], True, 565, 680, h=84, w=130)
archive = node("store", ["archive/", "photographs"], True, 895, 680, h=84, w=120)
data = node("store", ["data/", "state and media"], True, 1032, 680, h=84, w=140)
texts = node("store", ["training-data/", "texts, papers,", "art direction"], True, 1200, 680, h=84, w=140)

# External services, reached only through OpenRouter.
group(1360, 56, 300, 470, "External services")
openrouter = node("component", ["OpenRouter API", "model catalogue,", "chat, images"], True, 1510, router["cy"] - 37.5, w=220)
group(1380, 225, 260, 281, "via OpenRouter", fill="#ffffff", title_size=13)
node("ai", ["Language and vision", "Qwen3-30B-A3B-Instruct-2507", "Qwen3-VL-235B-A22B-Instruct"], True, 1510, 265, w=240)
node("ai", ["Image generation", "Seedream 4.5"], True, 1510, 355, w=240)
node("ai", ["Web search", "Exa"], True, 1510, 428, w=240)

# Connections.
right = lambda n: n["x"] + n["w"]
bottom = lambda n: n["y"] + n["h"]
for client, text in [(web, "HTTP, JSON, polling"), (td, "start, poll, load PNG")]:
    path([(right(client) + 2, client["cy"]), (api["x"] - 2, client["cy"])], both=True)
    label((right(client) + api["x"]) / 2, client["cy"] - 7, text, size_px=12)
path([(right(api), api["cy"]), (pipe["x"] - 2, pipe["cy"])])
path([(right(pipe), pipe["cy"]), (818, pipe["cy"])])
path([(pipe["cx"], bottom(pipe) + 2), (pipe["cx"], 488)], both=True)
label(pipe["cx"] - 10, 392, "JSON lines over", anchor="end", size_px=12)
label(pipe["cx"] - 10, 408, "stdin and stdout", anchor="end", size_px=12)
path([(right(yolo), yolo["cy"]), (sam["x"] - 2, sam["cy"])])
path([(models["cx"], models["y"]), (models["cx"], 612)])
path([(archive["cx"], archive["y"]), (archive["cx"], bottom(store) + 2)])
label(archive["cx"] - 8, 556, "imported", anchor="end", size_px=12)
label(archive["cx"] - 8, 572, "at start", anchor="end", size_px=12)
path([(data["cx"], data["y"] - 2), (data["cx"], bottom(store) + 2)], both=True)
path([(texts["cx"], texts["y"]), (texts["cx"], bottom(research) + 2)])
path([(right(router), router["cy"]), (openrouter["x"] - 2, router["cy"])])
label(1330, router["cy"] - 7, "HTTPS", size_px=12)
path([(openrouter["cx"], bottom(openrouter)), (openrouter["cx"], 223)])

key_y = 830
fig.key(20, key_y, [("client", "Client application"), ("component", "Server component"), ("core", "Orchestrator"),
                    ("local", "Local model"), ("ai", "Hosted model or service"), ("store", "Files on disk")])
fig.save(Path(__file__).with_name("software-architecture.svg"), key_y + 44)

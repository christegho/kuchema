On Mac

git clone https://github.com/christegho/kuchema.git
cd kuchema
npm ci
cp .env.example .env

python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements-vision.txt
.venv/bin/python scripts/setup-vision.py

Set OPENROUTER_API_KEY in .env 
Copy the complete archive into kuchema/archive/, preserving its subfolders.
The archive folder should have these folders
Chikukwa Water Sites/
collages-style-guide/
people/
and other images

Start on Mac:
npm run dev


On Windows - Powershell

git clone https://github.com/christegho/kuchema.git
cd kuchema
npm.cmd ci
Copy-Item .env.example .env

py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-vision.txt
.\.venv\Scripts\python.exe scripts/setup-vision.py

Add-Content .env "`nVISION_PYTHON=./.venv/Scripts/python.exe"
notepad .env

Set OPENROUTER_API_KEY in .env 

Start on Windows:
npm.cmd run dev

Open http://127.0.0.1:3000. The first archive import can take several minutes. Keep the terminal open; use Ctrl+C to stop.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data \
    VISION_PYTHON=/app/.venv/bin/python VISION_DEVICE=cpu YOLO_AUTOINSTALL=false
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
COPY requirements-vision.txt ./
COPY scripts ./scripts
RUN python3 -m venv .venv && .venv/bin/pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu && .venv/bin/pip install --no-cache-dir -r requirements-vision.txt && .venv/bin/python scripts/setup-vision.py
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "server/index.js"]

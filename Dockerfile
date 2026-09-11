FROM node:22-bookworm-slim

# Install system dependencies, system Chromium, FFmpeg, and native build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    chromium \
    fonts-noto-cjk \
    fonts-kacst \
    ca-certificates \
    python3 \
    make \
    g++ \
    build-essential \
    libsqlite3-dev \
    zip \
    && rm -rf /var/lib/apt/lists/*

# Prevent Puppeteer from attempting browser downloads (covers both old and new flags)
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PYTHON=/usr/bin/python3

WORKDIR /app

# 1. Copy package manifests
COPY package.json ./

# 2. Install dependencies without triggering the Puppeteer chrome downloader
RUN npm install --include=dev --legacy-peer-deps --ignore-scripts

# 3. Explicitly compile native SQLite bindings
RUN npm rebuild better-sqlite3 --build-from-source

# 4. Production environment
ENV NODE_ENV=production

# 5. Copy source files
COPY . .

EXPOSE 5000

CMD ["node", "server.js"]
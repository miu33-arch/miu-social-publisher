FROM node:22-bookworm-slim

# Install system dependencies, Chromium, FFmpeg, build tools, and native Linux zip utility
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

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    NODE_ENV=production

WORKDIR /app

# 1. Copy package manifests
COPY package*.json ./

# 2. Install ALL dependencies from package.json, then build native C++ modules
RUN npm install
RUN npm rebuild better-sqlite3 --build-from-source

# 3. Copy application files
COPY . .

EXPOSE 5000

CMD ["node", "server.js"]
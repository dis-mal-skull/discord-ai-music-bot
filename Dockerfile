FROM node:20-slim

# yt-dlp standalone requiere Python no; ffmpeg-static provee el binario de ffmpeg.
# Instalamos ffmpeg del sistema como respaldo (opcional, robusto).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
CMD ["node", "src/index.js"]

FROM node:22-slim

# ffmpeg (audio) + python3 (requerido por el binario yt-dlp de youtube-dl-exec)
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN YOUTUBE_DL_SKIP_PYTHON_CHECK=1 npm install --omit=dev

COPY . .

ENV NODE_ENV=production
CMD ["node", "src/index.js"]

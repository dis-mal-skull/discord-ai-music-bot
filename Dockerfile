FROM node:22-slim

# ffmpeg del sistema como respaldo (ffmpeg-static también provee su binario)
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
# youtube-dl-exec chequea Python en el preinstall; usamos el binario yt-dlp standalone, así que lo salteamos.
RUN YOUTUBE_DL_SKIP_PYTHON_CHECK=1 npm install --omit=dev

COPY . .

ENV NODE_ENV=production
CMD ["node", "src/index.js"]

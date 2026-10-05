# --- Proveedor de PO Token (bgutil) reutilizado como stage ---
FROM brainicism/bgutil-ytdlp-pot-provider:latest AS pot

# --- Imagen del bot ---
FROM node:22-slim

# ffmpeg (audio), python3 (yt-dlp), curl (descarga del plugin)
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

# Plugin de yt-dlp para el proveedor de PO Token
RUN mkdir -p /root/.config/yt-dlp/plugins \
  && curl -fsSL -o /root/.config/yt-dlp/plugins/bgutil-ytdlp-pot-provider.zip \
     https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/latest/download/bgutil-ytdlp-pot-provider.zip

# Servidor del proveedor de PO Token (corre en 127.0.0.1:4416)
COPY --from=pot /app /opt/pot

WORKDIR /app

COPY package*.json ./
# youtube-dl-exec chequea Python en el preinstall; usamos el binario yt-dlp standalone, así que lo salteamos.
RUN YOUTUBE_DL_SKIP_PYTHON_CHECK=1 npm install --omit=dev

# YouTube cambia con frecuencia; nightly recibe antes las correcciones del extractor.
RUN curl -fsSL -o node_modules/youtube-dl-exec/bin/yt-dlp \
      https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp \
  && chmod +x node_modules/youtube-dl-exec/bin/yt-dlp

COPY . .

ENV NODE_ENV=production
# Arranca el proveedor de PO Token en segundo plano y luego el bot.
CMD ["sh", "-c", "node /opt/pot/build/main.js --host 127.0.0.1 >/tmp/pot.log 2>&1 & exec node src/index.js"]

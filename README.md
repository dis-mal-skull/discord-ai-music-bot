# Discord AI Music Bot

A Discord bot that combines a **Mistral-powered assistant** (with per-channel memory and a daily diary) and its **own music player** (no third-party music bot needed). Music requests are detected from natural language and played in voice channels, with on-screen control buttons.

> The bot replies in Spanish (Rioplatense) by default — change `src/prompts.js` to localize it.

## Features

- **@mention assistant**: mention the bot in any channel and it answers using Mistral.
- **Memory**: keeps recent conversation history per channel (`data/history-*.json`).
- **Diary**: logs every exchange to `data/diary-YYYY-MM-DD.jsonl`.
- **Own music player**: plays YouTube audio in voice (via `yt-dlp` + `ffmpeg`), with a per-guild queue.
- **Now-playing panel** with buttons: Pause/Resume, Skip, Queue, Stop.
- **History** of played tracks (`data/music-history.jsonl`).
- **Auto-disconnect** after 1 minute idle.

## Music commands

Mention the bot, then:

| Command | Aliases | Action |
| --- | --- | --- |
| `play <query>` | `pon`, `poneme`, `toca`, `reproduce`, `colocame`, `suena`, `manda`, `agregá`, `añadí`, `sumá`, `encolá`, `meté`, `música` | Play / enqueue |
| `skip` | `salta`, `siguiente`, `next` | Next track |
| `pause` / `resume` | `pausa` / `seguí`, `continúa` | Pause / resume |
| `queue` | `cola`, `lista` | Show the queue |
| `stop` | `para`, `salir`, `chau` | Stop and leave |

Examples:

```
@bot play darude sandstorm
@bot agregá una lista de 3 canciones de Chrono Trigger
@bot pone estas canciones:
Corridors of Time
Schala's Theme
Frog's Theme
```

You can enqueue multiple songs in one message (one per line, or separated by `;`). Asking for "*N songs of X*" makes the assistant pick concrete titles via Mistral.

Anything that is **not** a music command is answered by the AI assistant.

## Requirements

- Node.js 20+
- A Discord bot token (**Message Content Intent** enabled)
- A [Mistral](https://console.mistral.ai/) API key
- `ffmpeg` and `yt-dlp` — both are bundled via `ffmpeg-static` and `youtube-dl-exec` (no system install needed)

## Setup

```bash
git clone <this-repo>
cd discord-ai-music-bot
npm install
cp .env.example .env
# edit .env with your DISCORD_TOKEN and MISTRAL_API_KEY
npm start
```

In the Discord Developer Portal → your app → **Bot**:
- Enable **Message Content Intent**.
- Invite the bot with the `bot` + `applications.commands` scopes and the **Connect** + **Speak** voice permissions.

## Run 24/7 with Docker

```bash
docker build -t discord-ai-music-bot .
docker run -d --restart unless-stopped \
  -e DISCORD_TOKEN=xxx \
  -e MISTRAL_API_KEY=yyy \
  -v $(pwd)/data:/app/data \
  --name dismal-bot discord-ai-music-bot
```

### EasyPanel / any PaaS

1. Create an **App** pointing to this repository (Dockerfile build).
2. Set the environment variables `DISCORD_TOKEN` and `MISTRAL_API_KEY` (and optionally `MUSIC_CHANNEL_ID`).
3. Mount a volume at `/app/data` to persist memory/history.
4. Deploy.

## Project structure

```
src/
  index.js    # bot entry: mentions, music commands, control buttons
  music.js    # music player (voice, queue, now-playing panel)
  mistral.js  # Mistral API client
  store.js    # per-channel memory + diary
  prompts.js  # assistant personality/instructions
  config.js   # environment config
data/         # runtime data (gitignored): memory, diary, music history
```

## Security

- **Never commit `.env`.** It is gitignored. Put secrets in environment variables.
- Rotate your Discord token if it was ever exposed.
- The bot only reads messages that mention it.

## License

MIT — do whatever you want.

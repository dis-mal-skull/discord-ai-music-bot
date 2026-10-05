import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
} from '@discordjs/voice';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import ffmpegStatic from 'ffmpeg-static';
import youtubedl from 'youtube-dl-exec';
import { config } from './config.js';

// ffmpeg-static segfaultea en algunos Linux; preferimos el ffmpeg del sistema si existe.
const FFMPEG = process.env.FFMPEG_PATH || (process.platform === 'win32' ? ffmpegStatic : 'ffmpeg');

/** Colas por guild. */
const queues = new Map();

function getQueue(guildId) {
  let q = queues.get(guildId);
  if (!q) {
    q = {
      connection: null,
      player: null,
      tracks: [],
      current: null,
      playing: false,
      controlChannel: null,
      lastMessage: null,
      idleTimer: null,
      startedAt: null,
    };
    queues.set(guildId, q);
  }
  return q;
}

const COOKIES_FILE = path.join(config.memoryDir, 'cookies.txt');

/** Opciones para yt-dlp: usa otro client y cookies si están disponibles. */
function ytOpts(extra = {}) {
  const opts = { noWarnings: true, noCheckCertificates: true, retries: 1, ...extra };
  if (process.env.YT_EXTRACTOR_ARGS) opts.extractorArgs = process.env.YT_EXTRACTOR_ARGS;
  if (process.env.YT_PROXY) opts.proxy = process.env.YT_PROXY;
  if (fs.existsSync(COOKIES_FILE)) opts.cookies = COOKIES_FILE;
  return opts;
}

/** Resuelve una búsqueda. Si es una URL, la reproduce directo (sin buscar ni fallback). */
async function resolve(query) {
  const trimmed = query.trim();
  const isUrl = /^https?:\/\//i.test(trimmed);

  if (isUrl) {
    const src = /soundcloud\./i.test(trimmed) ? 'soundcloud' : /youtu\.?be/i.test(trimmed) ? 'youtube' : 'link';
    console.log(`[music] URL directa (${src})`);
    const info = await youtubedl(trimmed, ytOpts({ dumpSingleJson: true, skipDownload: true }));
    const v = (info.entries && info.entries[0]) || info;
    const direct = await youtubedl(trimmed, ytOpts({ getUrl: true, format: 'bestaudio/best' }));
    const url = String(direct).trim().split('\n')[0];
    if (!url.startsWith('http')) throw new Error('sin url reproducible');
    return { title: v.title, url, webpage: v.webpage_url || trimmed, source: src, duration: v.duration };
  }

  const sources = (process.env.MUSIC_SOURCE || 'youtube,soundcloud')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  let lastErr;
  for (const src of sources) {
    const prefix = src === 'youtube' ? 'ytsearch1' : 'scsearch1';
    try {
      const search = await youtubedl(`${prefix}:${trimmed}`, ytOpts({ dumpSingleJson: true, skipDownload: true }));
      const info = (search && search.entries && search.entries[0]) || search;
      if (!info || !info.title) throw new Error('sin resultados');
      const target = info.webpage_url || info.url || `https://www.youtube.com/watch?v=${info.id}`;
      const direct = await youtubedl(target, ytOpts({ getUrl: true, format: 'bestaudio/best' }));
      const url = String(direct).trim().split('\n')[0];
      if (!url.startsWith('http')) throw new Error('sin url reproducible');
      console.log(`[music] fuente=${src} -> ${info.title}`);
      return { title: info.title, url, webpage: info.webpage_url || info.url || '', source: src, duration: info.duration };
    } catch (e) {
      lastErr = e;
      console.log(`[music] fuente=${src} falló: ${String(e.message).slice(0, 100)}`);
    }
  }
  throw lastErr || new Error('No se pudo resolver la búsqueda');
}

/** Crea un AudioResource con ffmpeg (PCM crudo 48k estéreo). */
function streamResource(url) {
  const env = { ...process.env };
  if (process.env.YT_PROXY) {
    env.http_proxy = process.env.YT_PROXY;
    env.https_proxy = process.env.YT_PROXY;
  }
  const ffmpeg = spawn(
    FFMPEG,
    [
      '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
      '-i', url,
      '-analyzeduration', '0', '-vn', '-loglevel', '0',
      '-f', 's16le', '-ar', '48000', '-ac', '2',
      'pipe:1',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], env },
  );
  let total = 0;
  ffmpeg.stdout.once('data', () => console.log('[music] ffmpeg emitiendo audio'));
  ffmpeg.stdout.on('data', (d) => { total += d.length; });
  ffmpeg.on('error', (e) => console.error('[music] ffmpeg error:', e.message));
  ffmpeg.on('close', (code) => {
    if (code !== 0 && total === 0) console.error(`[music] tema falló (ffmpeg code=${code})`);
  });
  ffmpeg.stderr.on('data', (d) => {
    const s = d.toString().trim();
    if (s) console.error('[ffmpeg]', s.slice(0, 200));
  });
  return createAudioResource(ffmpeg.stdout, { inputType: StreamType.Raw });
}

function logHistory(track) {
  try {
    fs.appendFileSync(
      path.join(config.memoryDir, 'music-history.jsonl'),
      `${JSON.stringify({ ts: new Date().toISOString(), title: track.title, source: track.source ?? null, url: track.webpage ?? null, requester: track.requester ?? null })}\n`,
    );
  } catch (e) {
    console.error('[music] history:', e.message);
  }
}

export function isPaused(guild) {
  const s = queues.get(guild.id)?.player?.state?.status;
  return s === AudioPlayerStatus.Paused || s === AudioPlayerStatus.AutoPaused;
}

export function isConnected(guild) {
  return Boolean(queues.get(guild.id)?.connection);
}

/** Fila de botones de control. `disabled` la grisea. */
export function buildControls(guild, disabled = false) {
  const q = queues.get(guild.id);
  const paused = isPaused(guild);
  const len = q?.tracks?.length ?? 0;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('m:toggle').setEmoji(paused ? '▶️' : '⏸️').setLabel(paused ? 'Reanudar' : 'Pausa').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId('m:skip').setEmoji('⏭️').setLabel('Saltar').setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId('m:queue').setEmoji('📋').setLabel(len ? `Cola (${len})` : 'Cola').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId('m:stop').setEmoji('⏹️').setLabel('Parar').setStyle(ButtonStyle.Danger).setDisabled(disabled),
  );
}

function disableLastMessage(guild) {
  const q = getQueue(guild.id);
  if (q.lastMessage) {
    q.lastMessage.edit({ components: [] }).catch(() => {});
    q.lastMessage = null;
  }
}

function postNowPlaying(guild, track) {
  const q = getQueue(guild.id);
  if (!q.controlChannel) return;
  // Deshabilita el panel del tema anterior.
  if (q.lastMessage) {
    q.lastMessage.edit({ components: [buildControls(guild, true)] }).catch(() => {});
    q.lastMessage = null;
  }
  const srcLabel = track.source ? track.source.charAt(0).toUpperCase() + track.source.slice(1) : 'fuente';
  const link = track.webpage ? `\n[${srcLabel} ↗](${track.webpage})` : '';
  const embed = new EmbedBuilder()
    .setColor(0x1db954)
    .setAuthor({ name: '🎶 Reproduciendo ahora' })
    .setDescription(`**${track.title}**${link}`)
    .setFooter({ text: `Fuente: ${track.source ?? '?'} · Pedido por ${track.requester ?? 'alguien'} · ${q.tracks.length} en cola` });
  q.controlChannel
    .send({ embeds: [embed], components: [buildControls(guild)] })
    .then((m) => { q.lastMessage = m; })
    .catch(() => {});
}

/** Se desconecta, limpia la cola y desactiva los botones. */
function leaveGuild(guild, note) {
  const q = getQueue(guild.id);
  if (q.idleTimer) {
    clearTimeout(q.idleTimer);
    q.idleTimer = null;
  }
  const conn = q.connection;
  q.connection = null; // antes de player.stop() para que el Idle no reprograme
  q.player?.stop();
  conn?.destroy();
  q.playing = false;
  q.current = null;
  q.tracks = [];
  disableLastMessage(guild);
  if (note && q.controlChannel) q.controlChannel.send(note).catch(() => {});
}

async function ensureConnection(guild, voiceChannel) {
  const q = getQueue(guild.id);

  if (!q.connection || q.connection.joinConfig.channelId !== voiceChannel.id) {
    if (q.connection) q.connection.destroy();
    console.log(`[music] uniendo a la voz: ${voiceChannel.name}`);
    q.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    q.connection.on('stateChange', (o, n) => console.log(`[music] voz ${o.status} -> ${n.status}`));
    q.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(q.connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(q.connection, VoiceConnectionStatus.Connecting, 5000),
        ]);
      } catch {
        q.connection?.destroy();
        q.connection = null;
      }
    });
  }

  if (!q.player) {
    q.player = createAudioPlayer();
    q.player.on(AudioPlayerStatus.Idle, () => {
      if (q.startedAt) {
        console.log(`[music] terminó: sonó ${((Date.now() - q.startedAt) / 1000).toFixed(1)}s`);
        q.startedAt = null;
      }
      playNext(guild);
    });
    q.player.on('stateChange', (o, n) => console.log(`[music] player ${o.status} -> ${n.status}`));
    q.player.on('error', (e) => {
      console.error('[music] player error:', e.message);
      playNext(guild);
    });
  }
  // IMPORTANTE: re-suscribir siempre (la conexión puede haberse recreado).
  q.connection.subscribe(q.player);
  return q.connection;
}

function playNext(guild) {
  const q = getQueue(guild.id);
  if (q.idleTimer) {
    clearTimeout(q.idleTimer);
    q.idleTimer = null;
  }

  const track = q.tracks.shift();
  if (!track) {
    q.playing = false;
    q.current = null;
    if (!q.connection) return; // ya desconectado (stop)
    q.idleTimer = setTimeout(() => leaveGuild(guild, '💤 Me desconecté: no quedó nada en la cola.'), 60000);
    return;
  }

  q.current = track;
  q.playing = true;
  q.startedAt = Date.now();
  console.log(`[music] reproduciendo: ${track.title} (${track.duration ?? '?'}s)`);
  try {
    q.player.play(streamResource(track.url));
    logHistory(track);
    postNowPlaying(guild, track);
  } catch (e) {
    console.error('[music] play:', e.message);
    q.playing = false;
    playNext(guild);
  }
}

export async function enqueue(guild, voiceChannel, query, requester, controlChannel) {
  const q = getQueue(guild.id);
  const track = await resolve(query);
  console.log(`[music] resuelto: ${track.title}`);
  track.requester = requester;
  q.tracks.push(track);
  if (controlChannel) q.controlChannel = controlChannel;
  await ensureConnection(guild, voiceChannel);
  if (!q.playing) playNext(guild);
  return track;
}

export function skip(guild) {
  const q = queues.get(guild.id);
  if (q?.player && q.connection) {
    q.player.stop();
    return true;
  }
  return false;
}

export function stop(guild) {
  const q = queues.get(guild.id);
  if (!q || !q.connection) return false;
  leaveGuild(guild, '⏹️ Corté la música y me fui.');
  return true;
}

export function pause(guild) {
  const q = queues.get(guild.id);
  if (q?.player) {
    q.player.pause();
    return true;
  }
  return false;
}

export function resume(guild) {
  const q = queues.get(guild.id);
  if (q?.player) {
    q.player.unpause();
    return true;
  }
  return false;
}

export function list(guild) {
  const q = queues.get(guild.id);
  return { current: q?.current?.title ?? null, tracks: (q?.tracks ?? []).map((t) => t.title) };
}

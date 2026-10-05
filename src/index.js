import { Client, GatewayIntentBits, Partials, Events, MessageFlags } from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { chat } from './mistral.js';
import { getHistory, appendHistory, logDiary } from './store.js';
import { buildSystemPrompt } from './prompts.js';
import * as music from './music.js';

// Si hay cookies de YouTube en base64, las escribe en disco para yt-dlp.
if (config.ytCookiesB64) {
  try {
    fs.mkdirSync(config.memoryDir, { recursive: true });
    fs.writeFileSync(path.join(config.memoryDir, 'cookies.txt'), Buffer.from(config.ytCookiesB64, 'base64'));
    console.log('[dismal] cookies de YouTube cargadas desde YT_COOKIES_B64');
  } catch (e) {
    console.error('[dismal] no pude escribir las cookies:', e.message);
  }
}

/** Pide a Mistral que arme una lista de títulos a partir de una descripción. */
async function suggestSongs(payload) {
  const out = await chat(
    [
      {
        role: 'system',
        content:
          'Sos un DJ experto. El usuario pide una lista de canciones describiendo un artista, juego o estilo. Devolvés SOLO los títulos de canciones, uno por línea, sin numeración, sin comillas y sin texto extra. Respetá la cantidad si la menciona (máximo 10).',
      },
      { role: 'user', content: `Pedido: "${payload}"` },
    ],
    { temperature: 0.5 },
  );
  return out
    .split('\n')
    .map((s) => s.replace(/^\s*[-•*\d.)]+\s*/, '').replace(/^["'“”]+|["'“”]+$/g, '').trim())
    .filter(Boolean)
    .slice(0, 10);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel],
});

client.once(Events.ClientReady, (c) => {
  console.log(`[dismal] conectado como ${c.user.tag} | modo=${config.musicOnly ? 'solo-musica' : `ia:${config.mistralModel}`} | PID=${process.pid}`);
  console.log(`[dismal] menciones: <@${c.user.id}>  | comandos: play, skip, stop, pause, resume, queue`);
  console.log('[dismal] IMPORTANTE: si ves otro proceso con el mismo bot, cerralo (causa doble respuesta).');
});

client.on(Events.MessageCreate, (message) => {
  if (message.author.bot) return;
  console.log(`[msg] #${message.channel?.name ?? '?'} @${message.author.username}: ${(message.content || '').slice(0, 100)}`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;
  const mentionsBot =
    message.mentions.has(client.user.id) ||
    [...message.mentions.roles.values()].some((r) => r.tags?.botId === client.user.id);
  if (!mentionsBot) return;

  const text = message.content.replace(/<@[!&]?\d+>/g, '').trim();
  const voiceChannel = message.member?.voice?.channel;

  // ---- Comandos de música ----
  const playMatch = text.match(/^(?:play|pon[\p{L}]*|toc[\p{L}]*|reproduc[\p{L}]*|coloc[\p{L}]*|suen[\p{L}]*|mand[\p{L}]*|a[ñn]ad[\p{L}]*|agreg[\p{L}]*|sum[\p{L}]*|encol[\p{L}]*|met[\p{L}]*|m[uú]sica)\s+([\s\S]+)$/iu);
  if (playMatch) {
    const clean = (s) => s
      .replace(/^[\s\-•*]+/, '')
      .replace(/^\d+[.)]\s*/, '')
      .replace(/^["'“”]+|["'“”]+$/g, '')
      .trim();
    const payload = playMatch[1].trim();
    let songs;
    if (/[\n;]/.test(payload)) {
      songs = payload.split(/[\n;]+/).map(clean).filter(Boolean);
    } else if (!config.musicOnly && /(lista|canci[oó]n(es)?|temas?)/i.test(payload)) {
      try {
        songs = await suggestSongs(payload);
        console.log(`[dismal] lista sugerida por IA: ${songs.join(' | ')}`);
      } catch (err) {
        console.error('[dismal] suggestSongs:', err.message);
        songs = [payload];
      }
    } else {
      songs = [payload];
    }
    songs = songs.slice(0, 10);
    console.log(`[dismal] música (${songs.length}): ${songs.join(' | ')} | voz=${voiceChannel?.name ?? 'N/A'}`);
    if (!voiceChannel) {
      return void message.reply('Entrá primero a un canal de voz y volvé a pedirme la música.').catch(() => {});
    }
    await message.channel.sendTyping().catch(() => {});
    const controlChannel = message.guild.channels.cache.get(config.musicChannelId) ?? message.channel;
    const added = [];
    const failed = [];
    let lastError = '';
    for (const song of songs) {
      try {
        const track = await music.enqueue(message.guild, voiceChannel, song, message.author.username, controlChannel);
        added.push(track.title);
      } catch (err) {
        console.error('[music] enqueue:', err.message);
        lastError = err.message;
        failed.push(song);
      }
    }
    const q = music.list(message.guild);
    let reply = added.length
      ? `✅ Agregué ${added.length} tema(s):\n${added.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
      : 'No pude agregar esos temas.';
    if (failed.length) reply += `\n⚠️ No encontré: ${failed.join(', ')}`;
    if (lastError) reply += `\n🐞 \`${String(lastError).slice(0, 350)}\``;
    reply += `\n📋 En cola: ${q.tracks.length}`;
    await message.reply(reply).catch(() => {});
    return;
  }

  if (/^(skip|salta|saltá|siguiente|next)$/i.test(text)) {
    const ok = music.skip(message.guild);
    return void message.reply(ok ? '⏭️ Saltando al siguiente.' : 'No hay nada reproduciéndose.').catch(() => {});
  }
  if (/^(stop|para|pará|salir|leave|chau)$/i.test(text)) {
    const ok = music.stop(message.guild);
    return void message.reply(ok ? '⏹️ Corto la música y me voy.' : 'No estoy reproduciendo nada.').catch(() => {});
  }
  if (/^(pause|pausa|pausar)$/i.test(text)) {
    return void message.reply(music.pause(message.guild) ? '⏸️ Pausado.' : 'No hay nada reproduciéndose.').catch(() => {});
  }
  if (/^(resume|seguí|segui|continúa|continua|reanudar)$/i.test(text)) {
    return void message.reply(music.resume(message.guild) ? '▶️ Sigo.' : 'No hay nada pausado.').catch(() => {});
  }
  if (/^(queue|cola|lista)$/i.test(text)) {
    const q = music.list(message.guild);
    const body = q.current
      ? `🎶 Sonando: **${q.current}**\n📋 En cola: ${q.tracks.length ? q.tracks.map((t, i) => `${i + 1}. ${t}`).join(' · ') : 'nada'}`
      : 'No hay nada en la cola.';
    return void message.reply(body).catch(() => {});
  }

  if (config.musicOnly) {
    return void message.reply('Solo reproduzco música. Usá `play <tema o URL>` o `queue`, `skip`, `pause`, `resume` y `stop`.').catch(() => {});
  }

  // ---- Consulta libre -> Mistral ----
  console.log(`[dismal] IA en #${message.channel?.name}`);
  await message.channel.sendTyping().catch(() => {});

  const messages = [
    { role: 'system', content: buildSystemPrompt({ guildName: message.guild.name }) },
    ...getHistory(message.channelId),
    { role: 'user', content: `${message.author.username}: ${text || '(sin texto)'}` },
  ];

  let reply;
  try {
    reply = await chat(messages);
  } catch (err) {
    console.error('[dismal] error de Mistral:', err.message);
    reply = 'Uy, tuve un problema para responder. Probá de nuevo en un momento.';
  }
  if (!reply) reply = 'No se me ocurrió nada para decir. Probá reformulando.';
  if (reply.length > 1900) reply = `${reply.slice(0, 1900)}…`;

  await message.reply({ content: reply, allowedMentions: { repliedUser: false } }).catch(() => {});
  appendHistory(message.channelId, { role: 'user', content: text });
  appendHistory(message.channelId, { role: 'assistant', content: reply });
  logDiary({
    guildId: message.guildId,
    channelId: message.channelId,
    userId: message.author.id,
    userTag: message.author.username,
    userMessage: text,
    botMessage: reply,
  });
});

// ---- Botones de control del reproductor ----
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton() || !interaction.customId.startsWith('m:')) return;
  const guild = interaction.guild;
  if (!guild) return;
  const action = interaction.customId.slice(2);

  if (action !== 'queue' && !music.isConnected(guild)) {
    return void interaction
      .reply({ content: '💤 El bot no está reproduciendo nada.', flags: MessageFlags.Ephemeral })
      .catch(() => {});
  }

  try {
    if (action === 'toggle') {
      if (music.isPaused(guild)) music.resume(guild);
      else music.pause(guild);
      await interaction.update({ components: [music.buildControls(guild)] }).catch(() => {});
    } else if (action === 'skip') {
      music.skip(guild);
      await interaction.deferUpdate().catch(() => {});
    } else if (action === 'stop') {
      music.stop(guild);
      await interaction.deferUpdate().catch(() => {});
    } else if (action === 'queue') {
      const q = music.list(guild);
      await interaction
        .reply({
          content: q.current
            ? `🎶 Sonando: **${q.current}**\n📋 En cola: ${q.tracks.length ? q.tracks.map((t, i) => `${i + 1}. ${t}`).join(' · ') : 'nada'}`
            : 'No hay nada en la cola.',
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    }
  } catch (err) {
    console.error('[music] botón:', err.message);
    if (!interaction.replied && !interaction.deferred) {
      interaction.reply({ content: 'No pude hacer eso.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
});

client.login(config.token).catch((err) => {
  console.error('[dismal] no se pudo iniciar sesión:', err.message);
  process.exit(1);
});

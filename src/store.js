import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(config.memoryDir, { recursive: true });

function historyFile(channelId) {
  return path.join(config.memoryDir, `history-${channelId}.json`);
}

function diaryFile(date = new Date()) {
  const day = date.toISOString().slice(0, 10);
  return path.join(config.memoryDir, `diary-${day}.jsonl`);
}

/** Historial de conversación de un canal (array de {role, content}). */
export function getHistory(channelId) {
  try {
    return JSON.parse(fs.readFileSync(historyFile(channelId), 'utf8'));
  } catch {
    return [];
  }
}

/** Agrega una entrada al historial y recorta a los últimos maxHistory*2. */
export function appendHistory(channelId, entry) {
  const history = getHistory(channelId);
  history.push(entry);
  const trimmed = history.slice(-config.maxHistory * 2);
  fs.writeFileSync(historyFile(channelId), JSON.stringify(trimmed, null, 2));
}

/** Registra el intercambio en el diario del día (una línea JSON por evento). */
export function logDiary({ channelId, userId, userTag, userMessage, botMessage, guildId }) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    guildId,
    channelId,
    userId,
    userTag,
    userMessage,
    botMessage,
  });
  fs.appendFileSync(diaryFile(), `${line}\n`);
}

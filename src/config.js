import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name} (revisá tu .env)`);
  return value;
}

export const config = {
  token: required('DISCORD_TOKEN'),
  mistralKey: required('MISTRAL_API_KEY'),
  mistralModel: process.env.MISTRAL_MODEL || 'mistral-small-latest',
  guildId: process.env.GUILD_ID || '',
  musicChannelId: process.env.MUSIC_CHANNEL_ID || '',
  memoryDir: process.env.MEMORY_DIR || './data',
  maxHistory: Number.parseInt(process.env.MAX_HISTORY || '12', 10),
};

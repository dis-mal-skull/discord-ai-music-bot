import { config } from './config.js';

const ENDPOINT = 'https://api.mistral.ai/v1/chat/completions';

/**
 * Llama al API de Mistral y devuelve el texto de la respuesta.
 * @param {{role:string, content:string}[]} messages
 */
export async function chat(messages, { model = config.mistralModel, temperature = 0.7 } = {}) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.mistralKey}`,
    },
    body: JSON.stringify({ model, messages, temperature }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Mistral ${res.status}: ${detail}`);
  }

  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.trim() ?? '';
}

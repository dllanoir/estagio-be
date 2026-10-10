export const GEMINI_MODELS = {
  chat: [
    { id: 'gemini-3.5-flash-lite', label: 'gemini-3.5-flash-lite (Padrão)', default: true },
    { id: 'gemini-3.8-flash', label: 'gemini-3.8-flash' },
    { id: 'gemini-3.1-flash-lite', label: 'gemini-3.1-flash-lite' },
    { id: 'gemini-2.5-flash-lite', label: 'gemini-2.5-flash-lite' }
  ],
  embed: [
    { id: 'gemini-embedding-2', label: 'gemini-embedding-2 (Padrão)', default: true }
  ],
  fallback: [
    'gemini-3.5-flash-lite',
    'gemini-3.8-flash',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash-lite'
  ]
};

export function getChatModel() {
  return localStorage.getItem('gemini_chat_model_v1') || 'gemini-3.5-flash-lite';
}

export function getEmbedModel() {
  return localStorage.getItem('gemini_embed_model_v1') || 'gemini-embedding-2';
}

export function populateAiModelSelect() {
  const sel = document.getElementById('ai-model-select');
  if (!sel) return;
  const current = getChatModel();
  sel.innerHTML = GEMINI_MODELS.chat.map(m =>
    `<option value="${m.id}" ${m.id === current ? 'selected' : ''}>${m.label}</option>`
  ).join('');
}

export async function validateGeminiModel(model, key) {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}?key=${key}`);
    return res.ok;
  } catch {
    return true;
  }
}


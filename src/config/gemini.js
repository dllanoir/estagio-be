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

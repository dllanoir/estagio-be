// Etapas de atendimento
export const STAGES = [
  ['triagem', 'Novo contato', '#7b8794'],
  ['docs', 'Cobrar documentos', '#b7791f'],
  ['guia', 'Guia a emitir/pagar', '#2b6cb0'],
  ['entrada', 'Dar entrada', '#6b46c1'],
  ['inss', 'Em análise', '#0f766e'],
  ['deferido', 'Deferido, a receber', '#2f855a'],
  ['fim', 'Finalizada', '#4a5568'],
  ['indef', 'Indeferido', '#c53030']
];

export const STAGE_MAP = Object.fromEntries(STAGES.map(s => [s[0], s]));

// Tags rápidas de histórico
export const QUICK_HISTORY_TAGS = [
  'Enviou documentos',
  'Faltando: ',
  'Guia paga',
  'Informou data: ',
  'Retornou contato',
  'Entrada feita',
  'Sem resposta'
];

// Nomes e labels de meses
export const MONTH_NAMES = 'janeiro fevereiro marco abril maio junho julho agosto setembro outubro novembro dezembro'.split(' ');
export const MONTH_LABELS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

// Cores para etiquetas
export const COLORS = [
  ['green', 'Verde', '#61bd4f'],
  ['yellow', 'Amarelo', '#f2d600'],
  ['orange', 'Laranja', '#ff9f1a'],
  ['red', 'Vermelho', '#eb5a46'],
  ['purple', 'Roxo', '#c377e0'],
  ['blue', 'Azul', '#0079bf'],
  ['sky', 'Azul-claro', '#00c2e0'],
  ['lime', 'Lima', '#51e898'],
  ['pink', 'Rosa', '#ff78cb'],
  ['black', 'Preto', '#344563']
];

export const COLOR_HEX = Object.fromEntries(COLORS.map(c => [c[0], c[2]]));

// Chaves de armazenamento LocalStorage
export const STORAGE_KEYS = {
  DB: 'sm_atendimentos_v1',
  GEMINI_API_KEY: 'gemini_api_key_v1',
  CHAT_MODEL: 'gemini_chat_model_v1',
  EMBED_MODEL: 'gemini_embed_model_v1',
  CHAT_HISTORY: 'gemini_chat_history_v1',
  CHAT_UI_MSGS: 'gemini_chat_ui_msgs_v1',
  REPORTS: 'sm_ai_reports_v1',
  OFFLINE_QUEUE: 'sm_offline_sync_queue_v1',
  EMBED_COOL: 'gemini_embed_cool_v1',
  EMBED_USAGE: 'gemini_embed_usage_v1',
  GEMINI_VAULT_ACTIVE: 'gemini_vault_active_v1'
};

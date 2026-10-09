import { storage, logError } from '../services/storage.service.js';
import { saveDbToIdb, loadDbFromIdb } from '../services/indexeddb.service.js';
import { STORAGE_KEYS } from '../config/constants.js';
import { safeLabelColor } from '../domain/label.js';
import { okm } from '../utils/date.js';

export const APP = {
  notifications: [],
  labelPicker: {
    vl: [],
    ua: {}
  },
  pendingAi: null,
  isAiGenerating: false
};

export let st = {
  mes: '*',
  et: 'ativos',
  q: '',
  lb: [],
  mode: 'e',
  lopen: false,
  sort: 'etapa',
  ls: [],
  lq: '',
  mm: false,
  open: null,
  bulk: false,
  sel: []
};

export let db = {
  cards: {},
  labels: {},
  meses: [],
  mnotes: {},
  gone: [],
  del: [],
  snooze: {}
};

export let curCards = [];

export function setCurCards(list) {
  curCards = list;
}

export function setDb(newVal) {
  if (!newVal || typeof newVal !== 'object') return db;
  for (const k of Object.keys(db)) {
    delete db[k];
  }
  Object.assign(db, newVal);
  db.cards = (db.cards && typeof db.cards === 'object') ? db.cards : {};
  db.labels = (db.labels && typeof db.labels === 'object')
    ? Object.fromEntries(Object.entries(db.labels).map(([l, v]) => [String(l), safeLabelColor(v)]).filter(([l]) => l))
    : {};
  db.meses = Array.isArray(db.meses) ? db.meses.filter(okm) : [];
  db.mnotes = (db.mnotes && typeof db.mnotes === 'object') ? db.mnotes : {};
  db.gone = Array.isArray(db.gone) ? db.gone.map(String) : [];
  db.del = Array.isArray(db.del) ? db.del.map(String) : [];
  db.snooze = (db.snooze && typeof db.snooze === 'object') ? db.snooze : {};
  if (typeof window !== 'undefined') window.db = db;
  return db;
}

export function initLocalDb() {
  try {
    const raw = storage.getItem(STORAGE_KEYS.DB);
    if (raw) setDb(JSON.parse(raw));
  } catch (e) {
    logError('init_parse_db', e);
  }
  return db;
}

export function save() {
  const json = JSON.stringify(db);
  try {
    storage.setItem(STORAGE_KEYS.DB, json);
  } catch (e) {
    const isQuota = e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014);
    if (!isQuota) logError('save_local_storage', e);
  }
  saveDbToIdb(db);

  if (typeof window.enqueueMutation === 'function') {
    window.enqueueMutation({ type: 'app_state', state: { snooze: db.snooze, gone: db.gone, del: db.del, bk: db.bk } });
    window.enqueueMutation({ type: 'labels', labels: db.labels });
    window.enqueueMutation({ type: 'meses', meses: db.meses, mnotes: db.mnotes });
  }
  return true;
}

// Inicializa no escopo global para compatibilidade com helpers existentes
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'db', { get: () => db, set: v => { db = v; }, configurable: true });
  Object.defineProperty(window, 'st', { get: () => st, set: v => { st = v; }, configurable: true });
  window.APP = APP;
  window.save = save;
}

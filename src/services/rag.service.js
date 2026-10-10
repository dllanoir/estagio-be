import { storage, logError } from './storage.service.js';
import { openVecDB, IDB_STORE } from './indexeddb.service.js';
import { sb } from './supabase.service.js';
import { db, all } from '../ui/state.js';
import { STORAGE_KEYS, STAGE_MAP } from '../config/constants.js';
import { getEmbedModel } from '../config/gemini.js';
import { norm, plain, txt } from '../utils/text.js';
import { mlabel } from '../utils/date.js';
import { isCardPend } from '../ui/components/alerts.js';
import { toast } from '../ui/toast.js';

const $ = s => document.querySelector(s);
const SN = STAGE_MAP;
const KEY_GEMINI = STORAGE_KEYS.GEMINI_API_KEY;
const EMBED_DIM = 768, EMBED_BATCH = 32, EMBED_IDLE_MS = 30000, SEM_MARGIN = 0.1;
const embedTag = () => getEmbedModel() + '|' + EMBED_DIM + '|sha256';

export function cardToText(c) {
  const hist = (c.hist || []).slice(0, 30).map(h => h.t).join('; ');
  const body = `Etapa: ${(SN[c.etapa] || [])[1] || c.etapa}\nMês: ${mlabel(c.mes)}\nParto: ${c.parto || 'Não informado'}\nPagamento: ${c.saque || 'Não informado'}\nLabels: ${c.labels.join(', ')}\nAnotações: ${txt(c.obs)}\nHistórico: ${hist}`;
  return `title: ${c.nome} | text: ${body}`.slice(0, 6000);
}

export async function hashText(str) {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
      const data = new TextEncoder().encode(str);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (e) { logError('hashText', e); }
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash) + str.charCodeAt(i) | 0;
  return 'fb_' + hash.toString();
}

export async function getAllVectors() {
  if (sb) {
    try {
      const { data, error } = await sb.from('card_vectors').select('id, tag, hash, vector');
      if (!error && Array.isArray(data)) {
        return data.map(row => ({
          id: row.id,
          tag: row.tag,
          hash: row.hash,
          vector: typeof row.vector === 'string' ? JSON.parse(row.vector) : row.vector
        }));
      }
    } catch (e) {
      logError('sb_getAllVectors', e);
    }
  }
  try {
    const idb = await openVecDB();
    const tx = idb.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).getAll();
    return new Promise(res => req.onsuccess = () => res(req.result || []));
  } catch (e) { return []; }
}

export async function deleteVector(id) {
  if (sb) {
    try {
      await sb.from('card_vectors').delete().eq('id', id);
    } catch (e) {
      logError('sb_deleteVector', e);
    }
  }
  try {
    const idb = await openVecDB();
    const tx = idb.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(id);
    return new Promise(res => { tx.oncomplete = res; tx.onerror = res; });
  } catch (e) { logError('indexeddb.deleteVector', e); }
}

const _sl = ms => new Promise(r => setTimeout(r, ms));
const EMBED_LIMITS = { rpm: 100, tpm: 100000, rpd: 50000 };
const EMBED_BATCH_TOK = 8000;
const _estTok = t => Math.ceil(String(t).length / 3);
const _ptDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

function _msToPTMidnight() {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false }).formatToParts(new Date());
  const g = t => (+p.find(x => x.type === t).value) % 24;
  return Math.max(60000, ((24 - g('hour')) * 3600 - g('minute') * 60 - g('second')) * 1000);
}

const KEY_EMBED_USAGE = 'gemini_embed_usage_v2';
const KEY_EMBED_COOL = 'gemini_embed_cool_v1';
let _semCool = Number(storage.getItem(KEY_EMBED_COOL)) || 0;

function _usageLoad() {
  try {
    const u = JSON.parse(storage.getItem(KEY_EMBED_USAGE) || 'null');
    if (u && u.day === _ptDay()) return { day: u.day, rpd: u.rpd || 0, log: Array.isArray(u.log) ? u.log : [] };
  } catch (e) {}
  return { day: _ptDay(), rpd: 0, log: [] };
}

export function embedUsage() {
  const u = _usageLoad(), now = Date.now(), l = u.log.filter(x => now - x[0] < 60000);
  return { rpm: l.reduce((a, x) => a + x[1], 0), tpm: l.reduce((a, x) => a + x[2], 0), rpd: u.rpd, limits: EMBED_LIMITS };
}

async function embedAcquire(units, tokens, { share = 1, maxWait = Infinity } = {}) {
  const lim = { rpm: EMBED_LIMITS.rpm * share, tpm: EMBED_LIMITS.tpm * share }, t0 = Date.now();
  for (;;) {
    const u = _usageLoad(), now = Date.now();
    u.log = u.log.filter(x => now - x[0] < 60000);
    if (u.rpd + units > EMBED_LIMITS.rpd) {
      const e = new Error('Cota diária de embeddings atingida (margem de segurança)');
      e.status = 429;
      e.daily = true;
      throw e;
    }
    const rpm = u.log.reduce((a, x) => a + x[1], 0), tpm = u.log.reduce((a, x) => a + x[2], 0);
    if ((rpm + units <= lim.rpm && tpm + tokens <= lim.tpm) || !u.log.length) {
      u.log.push([now, units, tokens]);
      u.rpd += units;
      try { storage.setItem(KEY_EMBED_USAGE, JSON.stringify(u)); } catch (e) {}
      return;
    }
    const wait = Math.max(500, 60000 - (now - u.log[0][0]) + 200);
    if (Date.now() - t0 + wait > maxWait) {
      const e = new Error('Fila de embeddings cheia; tente de novo em instantes');
      e.status = 429;
      e.local = true;
      throw e;
    }
    await _sl(wait);
  }
}

const _norm = v => {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  return Float32Array.from(v, x => x / n);
};

const _dot = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

function embedReq(model, text, kind) {
  const r = { model: `models/${model}`, content: { parts: [{ text }] }, outputDimensionality: EMBED_DIM };
  if (!/embedding-2/.test(model)) r.taskType = kind === 'q' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT';
  return r;
}

async function embedChunk(chunk, kind, apiKey, model, attempt = 1, opts = {}) {
  await embedAcquire(chunk.length, chunk.reduce((a, t) => a + _estTok(t), 0), { share: 1, maxWait: kind === 'q' ? 4000 : Infinity });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error("demorou demais")), 30000);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ requests: chunk.map(t => embedReq(model, t, kind)) }),
      signal: ctrl.signal
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err.error?.message || `Erro ${res.status} no modelo de embedding (${model})`;
      if (res.status === 429) {
        const raw = JSON.stringify(err), m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(raw);
        const e = new Error(msg);
        e.status = 429;
        e.daily = /PerDay/i.test(raw);
        e.retryAfter = m ? Math.ceil(+m[1]) * 1000 + 1000 : 65000;
        throw e;
      }
      if (res.status >= 500 && attempt < 3) {
        await _sl(1500 * 2 ** attempt + Math.random() * 400);
        return embedChunk(chunk, kind, apiKey, model, attempt + 1, opts);
      }
      if (res.status === 400 && !/api key/i.test(msg)) {
        if (chunk.length > 1) {
          const h = chunk.length >> 1, o = { bisect: true };
          const out = [...await embedChunk(chunk.slice(0, h), kind, apiKey, model, 1, o), ...await embedChunk(chunk.slice(h), kind, apiKey, model, 1, o)];
          if (out.every(v => !v)) { const e = new Error(msg); e.status = 400; throw e; }
          return out;
        }
        if (opts.bisect && kind !== 'q') { console.warn('Embedding ignorou 1 item (400):', msg); return [null]; }
      }
      const e = new Error(msg);
      e.status = res.status;
      throw e;
    }
    const embs = (await res.json()).embeddings || [];
    if (embs.length !== chunk.length) throw new Error(`Embedding devolveu ${embs.length} vetores para ${chunk.length} textos`);
    return embs.map(e => _norm(e.values));
  } finally {
    clearTimeout(timer);
  }
}

async function putVectors(items) {
  if (sb) {
    try {
      const payload = items.map(it => ({
        id: it.id,
        tag: it.tag,
        hash: it.hash,
        vector: Array.isArray(it.vector) ? it.vector : Array.from(it.vector)
      }));
      for (let i = 0; i < payload.length; i += 50) {
        const chunk = payload.slice(i, i + 50);
        await sb.from('card_vectors').upsert(chunk);
      }
    } catch (e) {
      logError('sb_putVectors', e);
    }
  }
  try {
    const idb = await openVecDB();
    const tx = idb.transaction(IDB_STORE, 'readwrite');
    items.forEach(it => tx.objectStore(IDB_STORE).put(it));
    return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  } catch (e) {}
}

const STOP = new Set('a o as os um uma de da do das dos em no na nos nas por para com sem e ou que quem qual quais me meu minha mais ja ainda tem tenho esta estao foi ser sao ao aos se'.split(' '));
const _qCache = new Map();
const _badHash = new Map();

function setSemCool(ts) {
  _semCool = ts;
  try { storage.setItem(KEY_EMBED_COOL, String(ts)); } catch (e) {}
}

export function lexRank(pool, q) {
  const tk = [...new Set(norm(q).split(/[^a-z0-9]+/).filter(t => t.length > 1 && !STOP.has(t)))];
  if (!tk.length) return { list: [], nameHit: false };
  const need = tk.length > 2 ? Math.ceil(tk.length / 2) : 1, out = [];
  for (const c of pool) {
    const nm = norm(c.nome), lb = norm(c.labels.join(' ')), bd = norm([plain(c.obs), ...c.hist.map(h => h.t)].join(' '));
    let m = 0, sc = 0, nameAll = true;
    for (const t of tk) {
      const a = nm.includes(t), b = lb.includes(t), d = bd.includes(t);
      if (a || b || d) m++;
      sc += (a ? 3 : 0) + (b ? 2 : 0) + (d ? 1 : 0);
      if (!a) nameAll = false;
    }
    if (m >= need) out.push({ c, s: sc, nameAll });
  }
  out.sort((x, y) => y.s - x.s || x.c.nome.localeCompare(y.c.nome));
  return { list: out, nameHit: out.some(x => x.nameAll) };
}

export async function semanticRank(q, apiKey, pool) {
  if (!apiKey || Date.now() < _semCool) return null;
  const model = getEmbedModel(), tag = embedTag();
  const ck = tag + '|' + norm(q);
  let qv = _qCache.get(ck);
  if (!qv) {
    const qt = /embedding-2/.test(model) ? `task: search result | query: ${q}` : q;
    try {
      [qv] = await embedChunk([qt], 'q', apiKey, model, 4);
    } catch (e) {
      if (e.status === 429 && !e.local) setSemCool(Date.now() + (e.daily ? _msToPTMidnight() : Math.max(e.retryAfter || 0, 65e3)));
      throw e;
    }
    _qCache.set(ck, qv);
    if (_qCache.size > 60) _qCache.delete(_qCache.keys().next().value);
  }
  const ids = new Set(pool.map(c => c.id));

  if (sb) {
    try {
      const qvArr = Array.isArray(qv) ? qv : Array.from(qv);
      const { data, error } = await sb.rpc('match_card_vectors', {
        query_embedding: qvArr,
        match_threshold: 0.0,
        match_count: 50
      });
      if (!error && Array.isArray(data) && data.length > 0) {
        const matched = data
          .filter(r => ids.has(r.id) && db.cards[r.id])
          .map(r => ({ c: db.cards[r.id], s: Number(r.similarity) }));
        if (matched.length > 0) {
          matched.sort((a, b) => b.s - a.s);
          const top = matched[0].s;
          return matched.filter(x => x.s >= top - SEM_MARGIN);
        }
      }
    } catch (err) {
      console.warn('Fallback para busca vetorial local:', err);
    }
  }

  const vecs = (await getAllVectors()).filter(v => v.tag === tag && db.cards[v.id]);
  if (!vecs.length) return null;
  const sc = vecs.filter(v => ids.has(v.id)).map(v => ({ c: db.cards[v.id], s: _dot(qv, v.vector) })).sort((a, b) => b.s - a.s);
  const top = sc.length ? sc[0].s : 0;
  return sc.filter(x => x.s >= top - SEM_MARGIN);
}

export async function searchContacts(a, apiKey) {
  const max = Math.min(Math.max(1, Number(a.limite) || 10), 20);
  const q = String(a.consulta || '').trim();
  const f = [];
  let pool = all();

  if (a.etapa && SN[a.etapa]) { pool = pool.filter(c => c.etapa === a.etapa); f.push('etapa'); }
  if (a.mes && a.mes !== '*') { const m = a.mes === 'sem_data' ? '' : String(a.mes); pool = pool.filter(c => c.mes === m); f.push('mês'); }
  if (a.etiqueta) { const e = norm(a.etiqueta); pool = pool.filter(c => c.labels.some(l => norm(l) === e)); f.push('etiqueta'); }
  if (typeof a.arquivado === 'boolean') { pool = pool.filter(c => c.arq === a.arquivado); f.push('arquivado'); }
  if (typeof a.pendentes === 'boolean') { pool = pool.filter(c => !!isCardPend(c) === a.pendentes); f.push('pendentes'); }
  for (const [k, fl, ge] of [['parto_de', 'parto', 1], ['parto_ate', 'parto', 0], ['saque_de', 'saque', 1], ['saque_ate', 'saque', 0]]) {
    const v = String(a[k] || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { pool = pool.filter(c => c[fl] && (ge ? c[fl] >= v : c[fl] <= v)); f.push(k); }
  }
  const total = pool.length, fl = f.length ? 'filtros (' + f.join(', ')+')' : '';
  if (!q) {
    return {
      total_no_filtro: total,
      estrategia: fl || 'sem filtros',
      contatos: [...pool].sort((x, y) => x.nome.localeCompare(y.nome)).slice(0, max).map(c => ({ id: c.id, nome: c.nome, etapa: c.etapa, mes: c.mes }))
    };
  }

  const lx = lexRank(pool, q), skip = lx.nameHit;
  let sem = null, aviso = '';
  if (!skip) {
    try {
      sem = await semanticRank(q, apiKey, pool);
    } catch (e) {
      aviso = 'Busca semântica indisponível (' + (e.status === 429 ? 'limite de cota do Gemini' : 'erro') + '); resultado só por texto e filtros.';
    }
  }

  const sc = new Map(), K = 60, add = (arr, get) => arr.forEach((x, i) => { const id = get(x).id; sc.set(id, (sc.get(id) || 0) + 1 / (K + i + 1)); });
  add(lx.list, x => x.c);
  if (sem) add(sem, x => x.c);
  const byId = new Map(pool.map(c => [c.id, c])), out = [...sc.entries()].sort((x, y) => y[1] - x[1]).slice(0, max).map(([id]) => byId.get(id));
  if (!out.length && !sem && !aviso) aviso = 'Nada encontrado por texto; índice semântico vazio, sem chave ou em pausa por cota.';
  const est = [fl, 'texto local', sem ? 'semântica (RRF)' : skip ? 'semântica dispensada (nome encontrado)' : ''].filter(Boolean).join(' + ');
  return { total_no_filtro: total, estrategia: est, ...(aviso ? { aviso } : {}), contatos: out.map(c => ({ id: c.id, nome: c.nome, etapa: c.etapa, mes: c.mes })) };
}

const _dirty = new Set();
let _dirtyT = 0, _again = false;
let isSyncing = false;

export async function syncEmbeddings(forceAll = false) {
  const key = storage.getItem(KEY_GEMINI);
  if (!key) return;
  if (!forceAll && Date.now() < _semCool) return;
  if (isSyncing) { _again = true; return; }
  const cards = Object.values(db.cards);
  if (!cards.length) return;
  isSyncing = true;
  clearTimeout(_dirtyT);
  const bar = $('#ai-sync-bar'), cnt = $('#ai-sync-count');
  try {
    const have = new Map((await getAllVectors()).map(v => [v.id, v])), tag = embedTag();
    have.forEach((v, id) => { if (!db.cards[id]) deleteVector(id); });
    const itemsWithHash = await Promise.all(cards.map(async c => {
      const text = cardToText(c);
      const hash = await hashText(text);
      return { c, text, hash };
    }));
    const todo = itemsWithHash.filter(x => {
      const v = have.get(x.c.id);
      if (_badHash.get(x.c.id) === x.hash) return false;
      return forceAll || !v || v.tag !== tag || v.hash !== x.hash;
    });
    _dirty.clear();
    if (todo.length && bar && cnt) {
      bar.classList.add('on');
      let i = 0, done = 0, rl = 0;
      while (i < todo.length) {
        const part = []; let tk = 0;
        while (i + part.length < todo.length && part.length < EMBED_BATCH) {
          const x = todo[i + part.length], t = _estTok(x.text);
          if (part.length && tk + t > EMBED_BATCH_TOK) break;
          part.push(x); tk += t;
        }
        cnt.textContent = `${done + part.length} de ${todo.length}`;
        let vecs;
        try {
          vecs = await embedChunk(part.map(x => x.text), 'd', key, getEmbedModel());
        } catch (e) {
          if (e.status === 429 && !e.daily && rl < 2) {
            rl++;
            cnt.textContent = `aguardando cota (${Math.round((e.retryAfter || 65000) / 1000)}s)…`;
            await _sl(e.retryAfter || 65000);
            continue;
          }
          throw e;
        }
        rl = 0;
        const okItems = [];
        part.forEach((x, j) => {
          if (vecs[j]) okItems.push({ id: x.c.id, vector: vecs[j], hash: x.hash, tag });
          else _badHash.set(x.c.id, x.hash);
        });
        if (okItems.length) await putVectors(okItems);
        i += part.length;
        done += part.length;
        updateRagConfigStatus();
        await _sl(1200);
      }
    }
  } catch (e) {
    console.warn('Indexação falhou:', e);
    if (e.status === 429) {
      const wait = e.daily ? _msToPTMidnight() : Math.max(e.retryAfter || 0, 65e3);
      setSemCool(Date.now() + wait);
      toast(e.daily ? 'Cota diária de embeddings esgotada; a indexação continua amanhã.' : 'Limite por minuto do Gemini atingido; a indexação continua em instantes.');
    }
  } finally {
    if (bar) bar.classList.remove('on');
    isSyncing = false;
    updateRagConfigStatus();
    if (_again) { _again = false; setTimeout(syncEmbeddings, 1500); }
  }
}

export function queueCardEmbedding(c) {
  if (!c || !storage.getItem(KEY_GEMINI)) return;
  _dirty.add(c.id);
  clearTimeout(_dirtyT);
  _dirtyT = setTimeout(syncEmbeddings, EMBED_IDLE_MS);
}

export async function getRagStatusInfo() {
  const key = storage.getItem(KEY_GEMINI);
  if (!key) return { status: 'desligada', label: 'desligada' };
  if (_semCool && Date.now() < _semCool) {
    const d = new Date(_semCool);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return { status: 'pausada', label: `pausada por cota (volta às ${hh}:${mm})` };
  }
  const total = Object.keys(db.cards || {}).length;
  let count = 0;
  try {
    const vecs = await getAllVectors();
    count = vecs ? vecs.length : 0;
  } catch (e) { logError('getRagStatusInfo_vecs', e); }
  if (isSyncing || (_dirty.size > 0 && count < total)) {
    return { status: 'indexando', label: `indexando ${count} de ${total}` };
  }
  return { status: 'ativa', label: 'ativa' };
}

export async function updateRagConfigStatus() {
  try {
    const info = await getRagStatusInfo();
    const vecs = await getAllVectors();
    if (typeof window !== 'undefined' && window.APP) window.APP.vectorCount = vecs ? vecs.length : 0;
    const statusEl = document.getElementById('cfg-rag-status');
    if (statusEl) statusEl.textContent = info.label;
    const aiRagEl = document.getElementById('ai-rag-status');
    if (aiRagEl) {
      aiRagEl.textContent = 'IA: ' + info.label;
      aiRagEl.title = 'Status da busca por significado: ' + info.label;
    }
  } catch (e) {
    logError('updateRagConfigStatus', e);
  }
}

if (typeof window !== 'undefined') {
  window.syncEmbeddings = syncEmbeddings;
  window.queueCardEmbedding = queueCardEmbedding;
  window.getRagStatusInfo = getRagStatusInfo;
  window.updateRagConfigStatus = updateRagConfigStatus;
}

import { storage } from './storage.service.js';
import { sb } from './supabase.service.js';
import { STORAGE_KEYS } from '../config/constants.js';
import { normCard } from '../domain/card.js';
import { db, save } from '../ui/state.js';

export const SYNC_ENGINE = {
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  isSyncing: false,
  pendingQueue: [],
  lastSyncTime: null,
  syncDebounceTimer: null
};

if (typeof window !== 'undefined') window.SYNC_ENGINE = SYNC_ENGINE;

export function loadSyncQueue() {
  try {
    const raw = storage.getItem(STORAGE_KEYS.OFFLINE_QUEUE);
    SYNC_ENGINE.pendingQueue = raw ? JSON.parse(raw) : [];
  } catch (e) {
    SYNC_ENGINE.pendingQueue = [];
  }
}

export function saveSyncQueue() {
  try {
    storage.setItem(STORAGE_KEYS.OFFLINE_QUEUE, JSON.stringify(SYNC_ENGINE.pendingQueue));
  } catch (e) {}
  updateSyncBadge();
}

export function enqueueMutation(action) {
  if (action.type === 'upsert_card') {
    const idx = SYNC_ENGINE.pendingQueue.findIndex(q => q.type === 'upsert_card' && q.id === action.id);
    if (idx >= 0) SYNC_ENGINE.pendingQueue.splice(idx, 1);
    const delIdx = SYNC_ENGINE.pendingQueue.findIndex(q => q.type === 'delete_card' && q.id === action.id);
    if (delIdx >= 0) SYNC_ENGINE.pendingQueue.splice(delIdx, 1);
  } else if (action.type === 'delete_card') {
    const upIdx = SYNC_ENGINE.pendingQueue.findIndex(q => q.type === 'upsert_card' && q.id === action.id);
    if (upIdx >= 0) SYNC_ENGINE.pendingQueue.splice(upIdx, 1);
    const delIdx = SYNC_ENGINE.pendingQueue.findIndex(q => q.type === 'delete_card' && q.id === action.id);
    if (delIdx >= 0) SYNC_ENGINE.pendingQueue.splice(delIdx, 1);
  } else if (action.type === 'labels' || action.type === 'meses' || action.type === 'app_state') {
    const idx = SYNC_ENGINE.pendingQueue.findIndex(q => q.type === action.type);
    if (idx >= 0) SYNC_ENGINE.pendingQueue.splice(idx, 1);
  }

  SYNC_ENGINE.pendingQueue.push({ ...action, ts: Date.now() });
  saveSyncQueue();

  if (SYNC_ENGINE.isOnline && !SYNC_ENGINE.isSyncing) {
    clearTimeout(SYNC_ENGINE.syncDebounceTimer);
    SYNC_ENGINE.syncDebounceTimer = setTimeout(() => {
      syncHybrid();
    }, 800);
  }
}

if (typeof window !== 'undefined') window.enqueueMutation = enqueueMutation;

export function updateSyncBadge() {
  const modalBadge = document.getElementById('cfg-modal-sync-badge');
  const sbStatusEl = document.getElementById('cfg-sb-status-txt');
  const sbQueueEl = document.getElementById('cfg-sb-queue-txt');
  const sbLastEl = document.getElementById('cfg-sb-last-txt');
  const count = SYNC_ENGINE.pendingQueue.length;

  if (sbStatusEl) {
    if (!SYNC_ENGINE.isOnline) {
      sbStatusEl.innerHTML = '<span style="color:var(--warn,#d97706);font-weight:700">🔴 Offline (Operando localmente)</span>';
    } else if (SYNC_ENGINE.isSyncing) {
      sbStatusEl.innerHTML = '<span style="color:var(--ac,#0f5c6e);font-weight:700">🔄 Sincronizando com Supabase...</span>';
    } else {
      sbStatusEl.innerHTML = '<span style="color:var(--good,#16a34a);font-weight:700">🟢 Supabase Conectado (meu-cantinho)</span>';
    }
  }

  if (sbQueueEl) {
    sbQueueEl.textContent = count === 0
      ? '0 pendências (100% em dia)'
      : `${count} alteração(ões) pendente(s) aguardando conexão`;
    sbQueueEl.style.color = count === 0 ? 'var(--good,#16a34a)' : 'var(--warn,#d97706)';
  }

  if (sbLastEl && SYNC_ENGINE.lastSyncTime) {
    sbLastEl.textContent = new Date(SYNC_ENGINE.lastSyncTime).toLocaleTimeString('pt-BR');
  }

  if (modalBadge) {
    if (!SYNC_ENGINE.isOnline) {
      modalBadge.className = 'badge-pill warn';
      modalBadge.textContent = count > 0 ? `🔴 Offline (${count})` : '🔴 Offline';
    } else if (SYNC_ENGINE.isSyncing) {
      modalBadge.className = 'badge-pill';
      modalBadge.textContent = '🔄 Sincronizando...';
    } else if (count > 0) {
      modalBadge.className = 'badge-pill';
      modalBadge.textContent = `🟡 Pendente (${count})`;
    } else {
      modalBadge.className = 'badge-pill good';
      modalBadge.textContent = '🟢 Conectado';
    }
  }
}

export async function syncHybrid(manual = false) {
  if (SYNC_ENGINE.isSyncing) return false;
  if (!navigator.onLine) {
    SYNC_ENGINE.isOnline = false;
    updateSyncBadge();
    if (manual && typeof window.toast === 'function') {
      window.toast('Sem conexão à internet. Operando em modo local seguro.', 'warn', 4000);
    }
    return false;
  }

  SYNC_ENGINE.isSyncing = true;
  updateSyncBadge();

  try {
    if (SYNC_ENGINE.pendingQueue.length > 0) {
      const queueCopy = [...SYNC_ENGINE.pendingQueue];
      for (const item of queueCopy) {
        try {
          if (item.type === 'upsert_card' && item.card) {
            const c = item.card;
            await sb.from('cards').upsert([{
              id: c.id,
              nome: c.nome || '',
              etapa: c.etapa || 'triagem',
              mes: c.mes || '',
              parto: c.parto || '',
              saque: c.saque || '',
              labels: Array.isArray(c.labels) ? c.labels : [],
              tl: Array.isArray(c.tl) ? c.tl : [],
              hist: Array.isArray(c.hist) ? c.hist : [],
              obs: c.obs || '',
              rich: c.rich ? 1 : 0,
              td: c.td || '',
              arq: !!c.arq,
              parto_ok: !!c.parto_ok,
              pend: !!c.pend,
              upd: c.upd || new Date().toISOString()
            }]);
          } else if (item.type === 'delete_card' && item.id) {
            await sb.from('cards').delete().eq('id', item.id);
            await sb.from('card_vectors').delete().eq('id', item.id);
          } else if (item.type === 'labels' && item.labels) {
            const rows = Object.entries(item.labels).map(([name, color]) => ({ name, color }));
            if (rows.length) await sb.from('labels').upsert(rows);
          } else if (item.type === 'meses' && item.meses) {
            const rows = item.meses.map(m => ({ mes: m, notes: (item.mnotes || {})[m] || {} }));
            if (rows.length) await sb.from('meses').upsert(rows);
          } else if (item.type === 'app_state' && item.state) {
            await sb.from('app_state').upsert([
              { key: 'snooze', value: item.state.snooze || {} },
              { key: 'gone', value: item.state.gone || [] },
              { key: 'del', value: item.state.del || [] },
              { key: 'bk', value: { timestamp: item.state.bk || null } }
            ]);
          } else if (item.type === 'upsert_vector' && item.item) {
            await sb.from('card_vectors').upsert([item.item]);
          } else if (item.type === 'delete_vector' && item.id) {
            await sb.from('card_vectors').delete().eq('id', item.id);
          }
        } catch (itemErr) {
          console.warn('Erro ao processar item pendente:', itemErr);
          throw itemErr;
        }
      }
      SYNC_ENGINE.pendingQueue = [];
      saveSyncQueue();
    }

    const { data: cloudCards, error: cardsErr } = await sb.from('cards').select('*');
    if (cardsErr) throw cardsErr;

    const { data: cloudLabels } = await sb.from('labels').select('*');
    const { data: cloudMeses } = await sb.from('meses').select('*');
    const { data: cloudState } = await sb.from('app_state').select('*');

    let localModified = false;
    let cloudUploadNeeded = [];

    if (Array.isArray(cloudCards)) {
      const cloudMap = new Map(cloudCards.map(c => [c.id, c]));
      const localIds = new Set(Object.keys(db.cards || {}));

      cloudCards.forEach(c => {
        if (Array.isArray(db.del) && db.del.includes(c.id)) {
          sb.from('cards').delete().eq('id', c.id);
          return;
        }

        const local = db.cards[c.id];
        if (!local) {
          db.cards[c.id] = normCard(c);
          localModified = true;
        } else {
          const cloudTime = Date.parse(c.upd || c.updated_at || '1970-01-01');
          const localTime = Date.parse(local.upd || '1970-01-01');

          if (cloudTime > localTime) {
            db.cards[c.id] = normCard(c);
            localModified = true;
          } else if (localTime > cloudTime) {
            cloudUploadNeeded.push(local);
          }
        }
      });

      localIds.forEach(id => {
        if (!cloudMap.has(id) && (!db.del || !db.del.includes(id))) {
          cloudUploadNeeded.push(db.cards[id]);
        }
      });

      if (cloudUploadNeeded.length > 0) {
        for (let i = 0; i < cloudUploadNeeded.length; i += 50) {
          const chunk = cloudUploadNeeded.slice(i, i + 50).map(c => ({
            id: c.id,
            nome: c.nome || '',
            etapa: c.etapa || 'triagem',
            mes: c.mes || '',
            parto: c.parto || '',
            saque: c.saque || '',
            labels: Array.isArray(c.labels) ? c.labels : [],
            tl: Array.isArray(c.tl) ? c.tl : [],
            hist: Array.isArray(c.hist) ? c.hist : [],
            obs: c.obs || '',
            rich: c.rich ? 1 : 0,
            td: c.td || '',
            arq: !!c.arq,
            parto_ok: !!c.parto_ok,
            pend: !!c.pend,
            upd: c.upd || new Date().toISOString()
          }));
          await sb.from('cards').upsert(chunk);
        }
      }
    }

    if (Array.isArray(cloudLabels) && cloudLabels.length) {
      cloudLabels.forEach(l => {
        if (l.name && (!db.gone || !db.gone.includes(l.name))) {
          if (!db.labels[l.name] || db.labels[l.name] !== l.color) {
            db.labels[l.name] = l.color || 'black';
            localModified = true;
          }
        }
      });
    }

    if (Array.isArray(cloudMeses) && cloudMeses.length) {
      cloudMeses.forEach(m => {
        if (m.mes && !db.meses.includes(m.mes)) {
          db.meses.push(m.mes);
          localModified = true;
        }
        if (m.notes) {
          db.mnotes[m.mes] = m.notes;
          localModified = true;
        }
      });
    }

    if (Array.isArray(cloudState)) {
      cloudState.forEach(s => {
        if (s.key === 'snooze' && s.value) {
          db.snooze = { ...db.snooze, ...s.value };
          localModified = true;
        }
      });
    }

    if (localModified) {
      save();
      if (typeof window.render === 'function') window.render();
    }

    SYNC_ENGINE.lastSyncTime = new Date();
    SYNC_ENGINE.isOnline = true;
    if (manual && typeof window.toast === 'function') {
      window.toast('Sincronização com Supabase concluída com sucesso!', 'ok', 3000);
    }
    return true;
  } catch (err) {
    console.warn('Falha durante sincronização com Supabase (operando em modo local):', err);
    if (!navigator.onLine || err.name === 'AbortError' || err.message?.includes('Failed to fetch')) {
      SYNC_ENGINE.isOnline = false;
    }
    return false;
  } finally {
    SYNC_ENGINE.isSyncing = false;
    updateSyncBadge();
    if (typeof window.updatePersistenceUI === 'function') {
      window.updatePersistenceUI();
    }
  }
}

if (typeof window !== 'undefined') {
  window.syncHybrid = syncHybrid;
  window.loadFromSupabase = syncHybrid;

  window.addEventListener('online', () => {
    SYNC_ENGINE.isOnline = true;
    updateSyncBadge();
    if (typeof window.toast === 'function') {
      window.toast('Internet conectada! Sincronizando com o Supabase...', 'ok', 3000);
    }
    syncHybrid();
  });

  window.addEventListener('offline', () => {
    SYNC_ENGINE.isOnline = false;
    updateSyncBadge();
    if (typeof window.toast === 'function') {
      window.toast('Você está offline. O sistema continua funcionando normalmente em modo local.', 'warn', 5000);
    }
  });
}

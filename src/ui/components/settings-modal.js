import { st, db, all, setDb, save, curCards } from '../state.js';
import { esc, norm, up, plain, txt, hs } from '../../utils/text.js';
import { now, fx, okm, mlabel } from '../../utils/date.js';
import { STAGES, STAGE_MAP, STORAGE_KEYS } from '../../config/constants.js';
import { safeLabelColor } from '../../domain/label.js';
import { normCard } from '../../domain/card.js';
import { storage, logError, isStoragePersisted } from '../../services/storage.service.js';
import { openVecDB, IDB_STORE_SNAPSHOTS } from '../../services/indexeddb.service.js';
import { sb, invokeEdgeFunction } from '../../services/supabase.service.js';
import { SYNC_ENGINE, syncHybrid, getPendingQueueSummary } from '../../services/sync.service.js';
import { ask } from './confirm-modal.js';
import { toast } from '../toast.js';
import { getBackupReminderDays, getPartoAlertDays, getInactiveDaysThreshold } from './alerts.js';

const $ = s => document.querySelector(s);
const S = STAGES;
const SN = STAGE_MAP;

export function dl(text, type, name) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(new Blob([text], { type }));
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportBackup({ onRender }) {
  db.bk = now();
  save();
  if (navigator.onLine && SYNC_ENGINE.isOnline) {
    try {
      await syncHybrid();
    } catch (e) {
      console.warn('Sync pré-exportação falhou, exportando base local:', e);
    }
  }
  const payload = {
    app: 'sm',
    v: 1,
    exported_at: new Date().toISOString(),
    is_online_synced: (navigator.onLine && SYNC_ENGINE.pendingQueue.length === 0),
    pending_queue_count: SYNC_ENGINE.pendingQueue.length,
    ...db
  };
  dl(JSON.stringify(payload, null, 2), 'application/json', 'cantinho-backup-' + now().slice(0, 10) + '.json');
  toast('Backup baixado com sucesso!');
  if (typeof onRender === 'function') onRender();
}

export function exportCsv(exportAll = false) {
  const target = exportAll ? all() : (curCards && curCards.length ? curCards : all());
  const q = v => {
    v = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
    return '"' + v.replace(/"/g, '""') + '"';
  };
  const H = ['Nome', 'Mês', 'Etapa', 'Labels', 'Data do parto', 'Data de pagamento', 'Anotações', 'Último registro', 'Histórico completo', 'Status'];
  const L = target.map(c => [
    c.nome,
    mlabel(c.mes),
    (SN[c.etapa] || S[0])[1],
    (c.labels || []).join(' | '),
    fx(c.parto),
    fx(c.saque),
    txt(c.obs),
    (hs(c)[0] || { h: {} }).h.t || '',
    hs(c).map(({ h }) => (h.d ? new Date(h.d).toLocaleString('pt-BR') : 'Importado do Trello') + ': ' + h.t).join('\n'),
    c.arq ? 'Arquivado' : 'Ativo'
  ]);
  const fileName = exportAll
    ? `cantinho-banco-completo-${now().slice(0, 10)}.csv`
    : `cantinho-${st.mes === '*' ? 'todos' : st.mes || 'sem-data'}-${now().slice(0, 10)}.csv`;
  dl('\ufeff' + [H, ...L].map(r => r.map(q).join(';')).join('\r\n'), 'text/csv;charset=utf-8', fileName);
  toast(exportAll ? `${target.length} contatos exportados (todo o banco).` : `${target.length} contatos exportados (visão atual).`);
}

export function validateBackupJson(j) {
  if (!j || typeof j !== 'object' || Array.isArray(j)) return false;
  if (j.app !== 'sm') return false;
  if (typeof j.v !== 'number' || j.v > 1) return false;
  if (j.cards && (typeof j.cards !== 'object' || Array.isArray(j.cards))) return false;
  if (j.labels && (typeof j.labels !== 'object' || Array.isArray(j.labels))) return false;
  if (j.meses && !Array.isArray(j.meses)) return false;
  if (j.mnotes && (typeof j.mnotes !== 'object' || Array.isArray(j.mnotes))) return false;
  if (j.bk && (typeof j.bk !== 'string' || isNaN(Date.parse(j.bk)))) return false;
  return true;
}

export async function createSnapshot(label = 'Snapshot automático') {
  const snap = {
    id: Date.now().toString(),
    data: new Date().toISOString(),
    label: String(label || 'Snapshot'),
    total: Object.keys(db.cards || {}).length,
    db: JSON.parse(JSON.stringify(db))
  };
  if (sb) {
    try {
      await sb.from('snapshots').insert([{
        id: snap.id,
        label: snap.label,
        total: snap.total,
        data: snap.db
      }]);
    } catch (e) {
      logError('sb_createSnapshot', e);
    }
  }
  try {
    const idb = await openVecDB();
    await new Promise((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE_SNAPSHOTS, 'readwrite');
      const store = tx.objectStore(IDB_STORE_SNAPSHOTS);
      store.put(snap);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    await pruneSnapshots(5);
    renderSnapshotsList();
  } catch (err) {
    console.error('Falha ao salvar snapshot localmente:', err);
  }
  return snap;
}

export async function getSnapshots() {
  if (sb) {
    try {
      const { data, error } = await sb.from('snapshots').select('*').order('created_at', { ascending: false }).limit(6);
      if (!error && Array.isArray(data) && data.length > 0) {
        return data.map(row => ({
          id: row.id,
          data: row.created_at,
          label: row.label,
          total: row.total,
          db: row.data
        }));
      }
    } catch (e) {
      logError('sb_getSnapshots', e);
    }
  }
  try {
    const idb = await openVecDB();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE_SNAPSHOTS, 'readonly');
      const store = tx.objectStore(IDB_STORE_SNAPSHOTS);
      const req = store.getAll();
      req.onsuccess = () => {
        const list = req.result || [];
        list.sort((a, b) => (b.id || '').localeCompare(a.id || ''));
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('Erro ao buscar snapshots:', err);
    return [];
  }
}

export async function pruneSnapshots(max = 5) {
  try {
    const snaps = await getSnapshots();
    if (snaps.length > max) {
      const toDelete = snaps.slice(max);
      if (sb) {
        for (const s of toDelete) {
          await sb.from('snapshots').delete().eq('id', s.id);
        }
      }
      const idb = await openVecDB();
      const tx = idb.transaction(IDB_STORE_SNAPSHOTS, 'readwrite');
      const store = tx.objectStore(IDB_STORE_SNAPSHOTS);
      toDelete.forEach(s => store.delete(s.id));
      await new Promise(res => { tx.oncomplete = res; });
    }
  } catch (err) {
    console.error('Erro ao podar snapshots:', err);
  }
}

export async function restoreSnapshot(id, { onRender, onSyncEmbeddings }) {
  try {
    const snaps = await getSnapshots();
    const snap = snaps.find(s => s.id === id);
    if (!snap || !snap.db) throw new Error('Snapshot não encontrado.');
    const dStr = new Date(snap.data).toLocaleString('pt-BR');
    const ok = await ask(`Deseja restaurar o snapshot de ${dStr} (${snap.label}, ${snap.total} contatos)? O banco atual será substituído.`, { ok: 'Restaurar', danger: true });
    if (!ok || ok === 'cancel') return false;
    setDb(JSON.parse(JSON.stringify(snap.db)));
    if (save()) {
      if (typeof onRender === 'function') onRender();
      if (typeof onSyncEmbeddings === 'function') onSyncEmbeddings();
      toast('Banco de dados restaurado do snapshot com sucesso!', 'ok');
      return true;
    } else {
      toast('Falha ao salvar a restauração do snapshot.', 'danger');
      return false;
    }
  } catch (err) {
    toast('Erro ao restaurar: ' + err.message, 'danger');
    return false;
  }
}

export async function downloadSnapshot(id) {
  try {
    const snaps = await getSnapshots();
    const snap = snaps.find(s => s.id === id);
    if (!snap || !snap.db) throw new Error('Snapshot não encontrado.');
    const jsonStr = JSON.stringify({ app: 'sm', v: 1, ...snap.db });
    const fileName = `cantinho-snapshot-${snap.id}-${snap.data.slice(0, 10)}.json`;
    dl(jsonStr, 'application/json', fileName);
  } catch (err) {
    toast('Erro ao baixar snapshot: ' + err.message, 'danger');
  }
}

export async function renderSnapshotsList({ onRender, onSyncEmbeddings } = {}) {
  const container = document.getElementById('cfg-snapshots-list');
  if (!container) return;
  try {
    const snaps = await getSnapshots();
    if (!snaps.length) {
      container.innerHTML = '<div style="font-size:12px;color:var(--mut);padding:8px;text-align:center">Nenhum snapshot registrado ainda.</div>';
      return;
    }
    container.innerHTML = snaps.map(s => {
      const dStr = new Date(s.data).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
      return `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border:1px solid var(--ln);border-radius:8px;background:var(--bg);gap:8px">
          <div>
            <strong style="display:block;font-size:12.5px;color:var(--ink)">${esc(s.label || 'Snapshot')}</strong>
            <span style="font-size:11.5px;color:var(--mut)">${dStr} • ${s.total} contato${s.total === 1 ? '' : 's'}</span>
          </div>
          <div style="display:flex;gap:6px;flex:none">
            <button type="button" class="btn sm" data-snap-restore="${esc(s.id)}" title="Restaurar este estado">Restaurar</button>
            <button type="button" class="btn sm" data-snap-dl="${esc(s.id)}" title="Baixar arquivo JSON">Baixar</button>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('[data-snap-restore]').forEach(btn => {
      btn.addEventListener('click', () => restoreSnapshot(btn.dataset.snapRestore, { onRender, onSyncEmbeddings }));
    });
    container.querySelectorAll('[data-snap-dl]').forEach(btn => {
      btn.addEventListener('click', () => downloadSnapshot(btn.dataset.snapDl));
    });
  } catch (e) {
    container.innerHTML = '<div style="font-size:12px;color:var(--mut);padding:8px;text-align:center">Erro ao carregar snapshots.</div>';
  }
}

export async function updatePersistenceUI() {
  const valEl = document.getElementById('cfg-storage-persisted-val');
  const descEl = document.getElementById('cfg-storage-persisted-desc');
  if (valEl) {
    valEl.innerHTML = isStoragePersisted
      ? '<span style="color:var(--good,#16a34a)">Sim</span>'
      : '<span style="color:var(--warn,#d97706)">Não</span>';
  }
  if (descEl) {
    descEl.textContent = isStoragePersisted
      ? 'O navegador garantiu que os dados locais deste app não serão apagados automaticamente para liberar espaço em disco.'
      : 'O navegador pode liberar espaço apagando dados locais se o disco ficar cheio. Backups regulares garantem seus dados.';
  }

  if (navigator.storage && navigator.storage.estimate) {
    try {
      const { usage, quota } = await navigator.storage.estimate();
      const usageMb = (usage / (1024 * 1024)).toFixed(1);
      const quotaGb = (quota / (1024 * 1024 * 1024)).toFixed(1);
      const pct = Math.max(0.2, Math.min(100, (usage / quota) * 100)).toFixed(1);

      const usageEl = document.getElementById('cfg-idb-usage-txt');
      const barEl = document.getElementById('cfg-idb-usage-bar');
      if (usageEl) usageEl.textContent = `${usageMb} MB em uso de ${quotaGb} GB disponíveis (${pct}%)`;
      if (barEl) barEl.style.width = `${pct}%`;
    } catch (e) {
      console.warn('Erro ao estimar armazenamento:', e);
    }
  }

  const sbStatusEl = document.getElementById('cfg-sb-status-txt');
  const sbCardsEl = document.getElementById('cfg-sb-cards-txt');
  const sbQueueEl = document.getElementById('cfg-sb-queue-txt');
  const sbLastEl = document.getElementById('cfg-sb-last-txt');
  const modalBadge = document.getElementById('cfg-modal-sync-badge');

  const pendingCount = SYNC_ENGINE.pendingQueue.length;
  const isOnline = navigator.onLine && SYNC_ENGINE.isOnline;

  if (sbStatusEl) {
    if (!isOnline) {
      sbStatusEl.innerHTML = '<span style="color:var(--warn,#d97706);font-weight:700">🔴 Offline (Operando localmente)</span>';
    } else if (SYNC_ENGINE.isSyncing) {
      sbStatusEl.innerHTML = '<span style="color:var(--ac,#0f5c6e);font-weight:700">🔄 Sincronizando com Supabase...</span>';
    } else {
      sbStatusEl.innerHTML = '<span style="color:var(--good,#16a34a);font-weight:700">🟢 Supabase Conectado (meu-cantinho)</span>';
    }
  }

  if (modalBadge) {
    if (!isOnline) {
      modalBadge.className = 'badge-pill warn';
      modalBadge.textContent = '🔴 Offline';
    } else if (SYNC_ENGINE.isSyncing) {
      modalBadge.className = 'badge-pill';
      modalBadge.textContent = '🔄 Sincronizando...';
    } else {
      modalBadge.className = 'badge-pill good';
      modalBadge.textContent = '🟢 Conectado';
    }
  }

  if (sbCardsEl) {
    const totalLocal = Object.keys(db.cards || {}).length;
    sbCardsEl.textContent = `${totalLocal} contatos gerenciados`;
  }

  if (sbQueueEl) {
    sbQueueEl.textContent = getPendingQueueSummary();
    sbQueueEl.style.color = pendingCount === 0 ? 'var(--good,#16a34a)' : 'var(--warn,#d97706)';
  }

  if (sbLastEl) {
    sbLastEl.textContent = SYNC_ENGINE.lastSyncTime
      ? new Date(SYNC_ENGINE.lastSyncTime).toLocaleTimeString('pt-BR')
      : 'Sincronizado nesta sessão';
  }
}

export async function updateServerKeyStatus() {
  const statusEl = document.getElementById('cfg-key-server-status');
  const keyInput = document.getElementById('cfg-key');
  try {
    const res = await invokeEdgeFunction('gemini', { action: 'checkStatus' });
    if (res?.hasKey) {
      storage.setItem(STORAGE_KEYS.GEMINI_VAULT_ACTIVE, '1');
      if (statusEl) {
        statusEl.innerHTML = '<span style="color:var(--good,#16a34a);font-weight:700">🟢 Chave Blindada & Ativa no Servidor (Supabase Vault)</span>';
      }
      if (keyInput && !keyInput.value) {
        keyInput.placeholder = 'Chave ativa no servidor (digite apenas para alterar)';
      }
    } else {
      if (!storage.getItem(STORAGE_KEYS.GEMINI_API_KEY)) {
        storage.removeItem(STORAGE_KEYS.GEMINI_VAULT_ACTIVE);
      }
      if (statusEl) {
        statusEl.innerHTML = '<span style="color:var(--warn,#d97706);font-weight:700">🟡 Nenhuma chave configurada. Digite abaixo para blindar no servidor.</span>';
      }
    }
  } catch (err) {
    if (statusEl) {
      statusEl.innerHTML = '<span style="color:var(--mut);font-size:12px">⚪ Status seguro do servidor offline</span>';
    }
  }
}

export function openSettingsModal({ onUpdateRag, onSyncEmbeddings, onRender } = {}) {
  const dlg = document.getElementById('cfg-dlg');
  if ($('#cfg-key')) {
    $('#cfg-key').value = '';
    $('#cfg-key').placeholder = 'Verificando chave no servidor...';
  }
  if ($('#cfg-backup-days')) $('#cfg-backup-days').value = getBackupReminderDays();
  if ($('#cfg-parto-days')) $('#cfg-parto-days').value = getPartoAlertDays();
  if ($('#cfg-inactive-days')) $('#cfg-inactive-days').value = getInactiveDaysThreshold();
  if (typeof onUpdateRag === 'function') onUpdateRag();
  updatePersistenceUI();
  updateServerKeyStatus();
  renderSnapshotsList({ onRender, onSyncEmbeddings });
  if (dlg && !dlg.open) {
    dlg.showModal();
    const closeBtn = dlg.querySelector('.modal-close');
    if (closeBtn) closeBtn.focus();
  }
}

export function mergeHistories(h1 = [], h2 = []) {
  const combined = [...(h1 || []), ...(h2 || [])];
  const seen = new Set();
  const res = [];
  for (const item of combined) {
    if (!item) continue;
    const key = `${item.d || ''}|${(item.t || '').trim()}`;
    if (!seen.has(key)) {
      seen.add(key);
      res.push(item);
    }
  }
  res.sort((a, b) => (b.d || '').localeCompare(a.d || ''));
  return res;
}

export async function mergeBackup(j, { onRender, onSyncEmbeddings }) {
  await createSnapshot('Antes de mesclar backup');
  const prevDb = JSON.parse(JSON.stringify(db));

  let n = 0, u = 0, k = 0;
  Object.values(j.cards || {}).forEach(rawC => {
    const c = normCard(rawC);
    if (!c) return;
    const existing = db.cards[c.id];
    if (!existing) {
      db.cards[c.id] = c;
      n++;
    } else {
      const cDate = c.upd || c.created_at || '';
      const exDate = existing.upd || existing.created_at || '';
      if (!cDate || !exDate || cDate >= exDate) {
        db.cards[c.id] = {
          ...existing,
          ...c,
          hist: mergeHistories(existing.hist, c.hist)
        };
        u++;
      } else {
        existing.hist = mergeHistories(existing.hist, c.hist);
        k++;
      }
    }
  });

  const importedLabels = (j.labels && typeof j.labels === 'object') ? j.labels : {};
  Object.keys(importedLabels).forEach(l => {
    if (l && !db.labels[l]) {
      db.labels[l] = safeLabelColor(importedLabels[l]);
    }
  });

  (Array.isArray(j.meses) ? j.meses : []).forEach(m => {
    if (okm(m) && !db.meses.includes(m)) db.meses.push(m);
  });

  const importedNotes = (j.mnotes && typeof j.mnotes === 'object') ? j.mnotes : {};
  Object.entries(importedNotes).forEach(([mes, note]) => {
    if (note && typeof note === 'object') {
      if (!db.mnotes[mes]) db.mnotes[mes] = { n: '', v: false };
      if (note.n && !db.mnotes[mes].n) db.mnotes[mes].n = note.n;
      if (note.v) db.mnotes[mes].v = true;
    }
  });

  if (save()) {
    toast(`Backup mesclado: ${n} adicionados, ${u} atualizados, ${k} mantidos.`);
    if (typeof onRender === 'function') onRender();
    if (typeof onSyncEmbeddings === 'function') onSyncEmbeddings();
    return true;
  } else {
    setDb(prevDb);
    toast('Falha ao salvar mesclagem do backup. Operação revertida.', 'danger');
    return false;
  }
}

export function load(file, { onRender, onSyncEmbeddings }) {
  if (file && (file.name?.toLowerCase().endsWith('.csv') || file.type === 'text/csv')) {
    toast('O arquivo selecionado é um CSV. Use a importação de backup JSON ou Trello JSON; CSV é somente para exportação.', 'warn');
    return;
  }
  const r = new FileReader();
  r.onload = async () => {
    try {
      const raw = String(r.result || '').replace(/^\ufeff/, '').trim();
      let j;
      try {
        j = JSON.parse(raw);
      } catch (err) {
        throw new Error('O arquivo precisa ser o backup JSON do Cantinho ou o JSON do Trello.');
      }

      if (validateBackupJson(j)) {
        const totalCards = Object.keys(j.cards || {}).length;
        const totalMeses = Array.isArray(j.meses) ? j.meses.length : 0;
        const previewMsg = `Backup com ${totalCards} contatos e ${totalMeses} meses. Deseja mesclar com os dados atuais ou substituir tudo?`;

        const ans = await ask(previewMsg, {
          title: 'Importar Backup',
          ok: 'Mesclar',
          alt: 'Substituir tudo',
          cancel: 'Cancelar'
        });

        if (ans === 'alt') {
          await createSnapshot('Antes de substituir backup');
          const prev = db;
          const cards = {};
          Object.values(j.cards || {}).forEach(c => {
            const nc = normCard(c);
            if (nc) cards[nc.id] = nc;
          });
          const safeLabels = {};
          Object.keys(j.labels || {}).forEach(l => {
            if (l) safeLabels[String(l)] = safeLabelColor(j.labels[l]);
          });
          setDb({
            cards,
            labels: safeLabels,
            meses: (Array.isArray(j.meses) ? j.meses : []).filter(okm),
            mnotes: (j.mnotes && typeof j.mnotes === 'object') ? j.mnotes : {},
            gone: Array.isArray(j.gone) ? j.gone.map(String) : [],
            del: Array.isArray(j.del) ? j.del.map(String) : [],
            bk: j.bk
          });
          if (save()) {
            toast('Backup restaurado com sucesso.');
            if (typeof onRender === 'function') onRender();
            if (typeof onSyncEmbeddings === 'function') onSyncEmbeddings();
          } else {
            setDb(prev);
            toast('Falha ao salvar substituição de backup. Operação revertida.', 'danger');
          }
        } else if (ans === true) {
          await mergeBackup(j, { onRender, onSyncEmbeddings });
        }
      } else {
        throw new Error('Arquivo não reconhecido como backup válido do Cantinho.');
      }
    } catch (e) {
      toast(e.message || 'Erro ao carregar arquivo de backup.', 'danger');
    }
  };
  r.readAsText(file);
}

if (typeof window !== 'undefined') {
  window.openSettingsModal = openSettingsModal;
  window.exportBackup = exportBackup;
  window.exportCsv = exportCsv;
  window.createSnapshot = createSnapshot;
  window.getSnapshots = getSnapshots;
  window.restoreSnapshot = restoreSnapshot;
  window.downloadSnapshot = downloadSnapshot;
  window.renderSnapshotsList = renderSnapshotsList;
  window.load = load;
}

import './styles/app.css';
import { STAGES, STAGE_MAP, QUICK_HISTORY_TAGS, MONTH_NAMES, MONTH_LABELS, COLORS, COLOR_HEX, STORAGE_KEYS } from './config/constants.js';
import { now, okd, okm, fx, mlabel, mkey, fs } from './utils/date.js';
import { esc, norm, up, toHtml, plain, txt, clean, hs } from './utils/text.js';
import { normCard } from './domain/card.js';
import { safeLabelColor, colorOpts } from './domain/label.js';
import { storage, logError, checkVolatileStorage, isStoragePersisted, initStoragePersistence } from './services/storage.service.js';
import { openVecDB, saveDbToIdb, loadDbFromIdb, IDB_NAME, IDB_STORE, IDB_STORE_SNAPSHOTS, IDB_STORE_CHAT, IDB_STORE_APP_DATA } from './services/indexeddb.service.js';
import { sb, getAuthToken, getAuthHeaders } from './services/supabase.service.js';
import { checkAuthSession, doLogout, updateUserSessionUI, setupAuthListener } from './services/auth.service.js';
import { SYNC_ENGINE, loadSyncQueue, saveSyncQueue, enqueueMutation, updateSyncBadge, syncHybrid } from './services/sync.service.js';
import { syncEmbeddings, queueCardEmbedding, deleteVector, updateRagConfigStatus } from './services/rag.service.js';
import { GEMINI_MODELS, getChatModel, getEmbedModel, populateAiModelSelect, validateGeminiModel } from './config/gemini.js';
import { APP, st, db, curCards, setCurCards, setDb, save, initLocalDb, all } from './ui/state.js';
import { toast } from './ui/toast.js';

// Componentes da Interface de Usuário
import { ask, initConfirmModal } from './ui/components/confirm-modal.js';
import { getBackupReminderDays, getPartoAlertDays, getInactiveDaysThreshold, isSnoozed, snoozeAlert, checkInitialAlerts, getPartoNotifications, backupAgeDays, monthNotes, isCardPend } from './ui/components/alerts.js';
import { renderNotifications, initHeader } from './ui/components/header.js';
import { renderRail, setMes, grow } from './ui/components/rail.js';
import { renderContactList, renderContext, bulkDeleteCards, hit, matchScore, SORT, ls, labs, inMes } from './ui/components/contact-list.js';
import { drawer, saveDrawerCard, saveNewCard, newCard, delCard, editHist, delHist, addl, addh, hasDrawerUnsavedChanges, requestCloseDrawer, updateDrawerAdvCard, renderDrawerLabels, renderDrawerHistory, readCardForm, log, mopts } from './ui/components/contact-drawer.js';
import { openNewMonthModal, initMonthModal, delMes } from './ui/components/month-modal.js';
import { openLabelsModal, renderLabelsModal, delLabels, editLabelName } from './ui/components/labels-modal.js';
import { openSettingsModal, updatePersistenceUI, exportBackup, exportCsv, load, createSnapshot, getSnapshots, restoreSnapshot, downloadSnapshot, renderSnapshotsList } from './ui/components/settings-modal.js';
import { loadStoredReports, saveReportsStorage, baixarRelatorioPdf, visualizarRelatorioPdf } from './ui/components/reports-modal.js';
import { initAiChat, resetChat, stopAiChat, chatWithGemini, appendAiMessage, confirmPendingAiAction, cancelPendingAiAction, saveChatStorage } from './ui/components/ai-chat.js';

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

// =========================================================================
// RENDERIZADOR MESTRE DO SISTEMA
// =========================================================================
export function render() {
  const prevRailScroll = $('#rail-months-scroll')?.scrollTop ?? 0;
  const prevListScroll = $('#list-scroll')?.scrollTop ?? 0;
  const prevContextScroll = $('#context-panel')?.scrollTop ?? 0;
  const prevWinX = window.scrollX;
  const prevWinY = window.scrollY;
  const prevMes = render._lastMes;
  const prevEt = render._lastEt;
  render._lastMes = st.mes;
  render._lastEt = st.et;

  renderRail();
  renderContactList({
    onOpenDrawer: (id) => drawer(id),
    onRender: render
  });

  const cs = all();
  const pre = cs.filter(c => inMes(c) && hit(c));
  const has = c => !st.lb.length || (st.mode === 'e' ? st.lb.every(l => c.labels.includes(l)) : st.lb.some(l => c.labels.includes(l)));
  const base = pre.filter(has);
  const sk = /^\d/.test(st.mes) ? st.mes : '';
  renderContext(cs, base, sk);
  renderNotifications();
  renderLabelsModal();

  // Preservação de rolagem
  const listScrollEl = $('#list-scroll');
  if (listScrollEl && prevListScroll > 0 && prevMes === st.mes && prevEt === st.et) {
    listScrollEl.scrollTop = prevListScroll;
  }

  const contextEl = $('#context-panel');
  if (contextEl && prevContextScroll > 0) {
    contextEl.scrollTop = prevContextScroll;
  }

  if (window.scrollY !== prevWinY) {
    window.scrollTo({ top: prevWinY, left: prevWinX, behavior: 'instant' });
  }

  requestAnimationFrame(() => {
    const rEl = $('#rail-months-scroll');
    if (rEl && prevRailScroll > 0 && Math.abs(rEl.scrollTop - prevRailScroll) > 1) {
      rEl.scrollTop = prevRailScroll;
    }
  });
}

// =========================================================================
// TABELA MODULAR DE AÇÕES (ACTIONS DISPATCH TABLE)
// =========================================================================
export const ACTIONS = {
  'notifications': () => {
    const panel = $('#notif-panel'), btn = $('#notif-btn');
    if (panel) {
      panel.hidden = !panel.hidden;
      btn?.setAttribute('aria-expanded', String(!panel.hidden));
    }
  },
  'notif-action': (t, e, D) => {
    const item = (APP.notifications || [])[+D.notif];
    if (!item) return;
    const panel = $('#notif-panel');
    if (item.action === 'exp') document.querySelector('[data-a="exp"]')?.click();
    else if (item.action === 'month') { st.mes = item.month; render(); }
    else if (item.action === 'no-date') { st.mes = ''; st.et = 'ativos'; render(); }
    else if (item.action === 'contact') {
      const tc = db.cards[item.contactId];
      if (tc) {
        st.mes = tc.mes || '*';
        if (tc.etapa === 'fim' || tc.etapa === 'indef') st.et = 'todos';
      } else if (item.month !== undefined) {
        st.mes = item.month || '*';
      }
      render();
      if (item.contactId) drawer(item.contactId);
    }
    if (panel) panel.hidden = true;
    $('#notif-btn')?.setAttribute('aria-expanded', 'false');
  },
  'save-card': () => {
    saveDrawerCard({ onRender: render, onQueueEmbedding: queueCardEmbedding }).then(saved => {
      if (saved) drawer(null);
    });
  },
  'snooze': (t, e, D) => {
    const id = D.id, tipo = D.tipo, days = parseInt(D.days, 10);
    snoozeAlert(id, tipo, days);
    toast(days === 0 ? 'Alerta dispensado.' : `Alerta adiado por ${days} dia(s).`);
  },
  'ai-confirm-yes': () => confirmPendingAiAction({ onRender: render }),
  'ai-confirm-no': () => cancelPendingAiAction(),
  'dl-report': (t, e, D) => {
    const rId = D.reportId || D.report;
    if (rId) baixarRelatorioPdf(rId);
  },
  'view-report': (t, e, D) => {
    const rId = D.reportId || D.report;
    if (rId) visualizarRelatorioPdf(rId);
  },
  'toggle-bulk': () => {
    st.bulk = !st.bulk;
    if (!st.bulk) st.sel = [];
    render();
  },
  'bulk-delete': () => bulkDeleteCards({ onRender: render, onDeleteVector: deleteVector, onUpdateRag: updateRagConfigStatus }),
  'new': () => {
    if (st.open && hasDrawerUnsavedChanges()) {
      requestCloseDrawer({ onRender: render, onQueueEmbedding: queueCardEmbedding }).then(() => {
        if (!st.open) newCard();
      });
    } else {
      newCard();
    }
  },
  'home': () => {
    if (st.open && hasDrawerUnsavedChanges()) {
      requestCloseDrawer({ onRender: render, onQueueEmbedding: queueCardEmbedding }).then(() => {
        if (!st.open) {
          st.mes = '*'; st.et = 'ativos'; st.q = ''; st.lb = []; st.lopen = false;
          if ($('#q')) $('#q').value = '';
          const aiWin = $('#ai-window'); if (aiWin) aiWin.hidden = true;
          render();
        }
      });
    } else {
      st.mes = '*'; st.et = 'ativos'; st.q = ''; st.lb = []; st.lopen = false;
      if ($('#q')) $('#q').value = '';
      drawer(null);
      const aiWin = $('#ai-window'); if (aiWin) aiWin.hidden = true;
      render();
    }
  },
  'dlg-close': (t) => {
    const dg = t.closest('dialog');
    if (dg) dg.close();
  },
  'ai-new': () => resetChat(),
  'imp': () => $('#fi')?.click(),
  'cfg': () => openSettingsModal(),
  'ai-close': () => { const win = $('#ai-window'); if (win) win.hidden = true; },
  'lbo': () => { st.lopen = !st.lopen; render(); },
  'lbt': (t, e, D) => {
    const i = st.lb.indexOf(D.l);
    i < 0 ? st.lb.push(D.l) : st.lb.splice(i, 1);
    render();
  },
  'lbm': (t, e, D) => { st.mode = D.v; render(); },
  'lbx': () => { st.lb = []; render(); },
  'csv': () => exportCsv(false),
  'csv-all': () => exportCsv(true),
  'nm': () => openNewMonthModal(),
  'mm': () => { st.mm = !st.mm; render(); },
  'dmes': (t, e, D) => delMes(D.k, { onRender: render, onDeleteVector: deleteVector, onUpdateRag: updateRagConfigStatus }),
  'emes': (t, e, D) => {
    st.mes = D.k;
    render();
    const el = $('#mbx');
    if (el) el.focus({ preventScroll: true });
  },
  'lg': () => openLabelsModal(),
  'dl': (t, e, D) => delLabels([D.l], { onRender: render, onDrawerRefresh: drawer }),
  'lsel': (t, e, D) => {
    const i = st.ls.indexOf(D.l);
    i < 0 ? st.ls.push(D.l) : st.ls.splice(i, 1);
    renderLabelsModal();
  },
  'lsu': () => {
    st.ls = APP.labelPicker.vl.filter(l => !APP.labelPicker.ua[l]);
    renderLabelsModal();
  },
  'lsa': () => {
    st.ls = [...APP.labelPicker.vl];
    renderLabelsModal();
  },
  'lsx': () => {
    st.ls = [];
    renderLabelsModal();
  },
  'lsd': () => {
    if (st.ls.length) delLabels([...st.ls], { onRender: render, onDrawerRefresh: drawer });
  },
  'ren-label': (t, e, D) => editLabelName(D.l, { onRender: render, onDrawerRefresh: drawer }),
  'dc': (t, e, D, c) => { if (c) delCard(c, { onRender: render, onDeleteVector: deleteVector, onUpdateRag: updateRagConfigStatus }); },
  'dh': (t, e, D, c) => { if (c) delHist(c, +D.i, { onRender: render, onQueueEmbedding: queueCardEmbedding }); },
  'eh': (t, e, D, c) => { if (c) editHist(c, +D.i, { onRender: render, onQueueEmbedding: queueCardEmbedding }); },
  'adv': (t, e, D, c) => {
    if (!c) return;
    const etSelect = $('#f-et');
    const curVal = etSelect ? etSelect.value : (c.etapa || 'triagem');
    const ix = STAGES.findIndex(s => s[0] === curVal);
    if (ix >= 0 && ix < STAGES.length - 1) {
      const next = STAGES[ix + 1];
      if (etSelect) etSelect.value = next[0];
      updateDrawerAdvCard(next[0]);
    }
  },
  'close': () => requestCloseDrawer({ onRender: render, onQueueEmbedding: queueCardEmbedding }),
  'exp': () => exportBackup({ onRender: render }),
  'lab': (t, e, D) => {
    if (!st.drawerDraftLabels) {
      const card = st.open === 'new' ? st.draft : (st.open ? db.cards[st.open] : null);
      st.drawerDraftLabels = [...(card ? card.labels || [] : [])];
    }
    const idx = st.drawerDraftLabels.indexOf(D.l);
    if (idx < 0) st.drawerDraftLabels.push(D.l);
    else st.drawerDraftLabels.splice(idx, 1);
    renderDrawerLabels();
  },
  'q': (t, e, D, c) => {
    if (!c) return;
    const i = $('#f-h');
    if (i) {
      i.value = D.t;
      i.focus();
      if (!D.t.endsWith(': ')) addh({ onRender: render, onQueueEmbedding: queueCardEmbedding });
    }
  },
  'addh': (t, e, D, c) => { if (c) addh({ onRender: render, onQueueEmbedding: queueCardEmbedding }); },
  'nl': (t, e, D, c) => { if (c) addl({ onRender: render }); },
  'arq': (t, e, D, c) => {
    if (!c) return;
    const prevArq = c.arq;
    c.arq = !c.arq;
    log(c, c.arq ? 'Contato arquivado' : 'Contato restaurado');
    save();
    render();
    queueCardEmbedding(c);
    const arqBtn = t.closest('[data-a="arq"]');
    if (arqBtn) arqBtn.textContent = c.arq ? 'Restaurar' : 'Arquivar';
    toast(c.arq ? 'Contato arquivado.' : 'Contato restaurado.', 'info', 10000, {
      label: 'Desfazer',
      onClick: () => {
        c.arq = prevArq;
        log(c, c.arq ? 'Contato arquivado (desfeito)' : 'Contato restaurado (desfeito)');
        save();
        render();
        queueCardEmbedding(c);
        if (arqBtn) arqBtn.textContent = c.arq ? 'Restaurar' : 'Arquivar';
        toast('Ação desfeita.', 'ok');
      }
    });
  }
};

// =========================================================================
// DELEGAÇÃO GLOBAL DE EVENTOS DOM
// =========================================================================
document.addEventListener('click', e => {
  const mn = $('.mn');
  if (mn && mn.open && !e.target.closest('summary')) mn.open = false;
  const np = $('#notif-panel');
  if (np && !e.target.closest('#notif-wrap')) {
    np.hidden = true;
    $('#notif-btn')?.setAttribute('aria-expanded', 'false');
  }

  const t = e.target.closest('[data-a],[data-m],[data-e],[data-id],[data-x],[data-q],[data-dlg],[data-preset],[data-retry]');
  if (!t) return;
  const D = t.dataset, c = db.cards[st.open];

  if (D.m !== undefined) { st.mes = D.m; render(); return; }
  if (D.e) { st.et = D.e; render(); return; }
  if (D.id && !t.classList.contains('ai-contact-btn')) {
    if (st.bulk) {
      const idx = st.sel.indexOf(D.id);
      if (idx < 0) st.sel.push(D.id);
      else st.sel.splice(idx, 1);
      render();
    } else {
      if (st.open && hasDrawerUnsavedChanges()) {
        requestCloseDrawer({ onRender: render, onQueueEmbedding: queueCardEmbedding }).then(() => { if (!st.open) drawer(D.id); });
      } else {
        drawer(D.id);
      }
    }
    return;
  }
  if (t.classList.contains('ai-contact-btn') && D.id) { drawer(D.id); return; }
  if (D.preset !== undefined) { $(D.preset).value = D.v; return; }
  if (D.retry !== undefined) {
    const rp = D.retry;
    t.closest('.ai-msg')?.remove();
    if (rp) { $('#ai-prompt').value = rp; $('#ai-form')?.dispatchEvent(new Event('submit')); }
    return;
  }
  if (D.x) { document.execCommand(D.x); return; }
  if (D.dlg === 'close') { $('#cfg-dlg')?.close(); return; }
  if (D.q) { $('#ai-prompt').value = D.q; $('#ai-form')?.dispatchEvent(new Event('submit')); return; }

  if (D.a && ACTIONS[D.a]) {
    ACTIONS[D.a](t, e, D, c);
  }
});

document.addEventListener('keydown', e => {
  if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
    e.preventDefault(); $('#q')?.focus();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault(); $('#q')?.focus();
  }
  if ((e.key === 'Enter' || e.key === ' ') && e.target?.dataset?.a === 'lsel') {
    e.preventDefault(); e.target.click();
  }
  if (e.target.id === 'f-h' && e.key === 'Enter') addh({ onRender: render, onQueueEmbedding: queueCardEmbedding });
  if (e.target.id === 'f-nl' && e.key === 'Enter') addl({ onRender: render });
  if (e.target.id === 'lgn-name' && e.key === 'Enter') $('#lgn-add-btn')?.click();
  if (e.key === 'Escape' && !$('#dg')?.open && !$('#cfg-dlg')?.open && !$('#dlg-mes')?.open && !$('#dlg-label')?.open) {
    if (st.open) {
      e.preventDefault();
      requestCloseDrawer({ onRender: render, onQueueEmbedding: queueCardEmbedding });
    }
    const aiWin = $('#ai-window'); if (aiWin) aiWin.hidden = true;
  }
});

const inEd = e => e.target?.closest && e.target.closest('#f-obs');
document.addEventListener('mousedown', e => { if (e.target.closest?.('[data-x]')) e.preventDefault(); });
document.addEventListener('input', e => {
  if (e.target.id === 'lgq') { st.lq = e.target.value; render(); }
  if (e.target.id === 'dlg-lgq') { st.lq = e.target.value; renderLabelsModal(); }
  if (e.target.id === 'mbx') { setMes($('#mb')?.dataset.k, m => m.n = e.target.value); grow(e.target); render(); }
});
document.addEventListener('focusout', e => {
  if (e.target.id === 'f-parto') {
    const m = $('#f-mes');
    if (m && !m.value && e.target.value) {
      const suggested = e.target.value.slice(0, 7);
      m.innerHTML = mopts(suggested);
      m.value = suggested;
    }
  }
});
document.addEventListener('paste', e => {
  if (inEd(e)) {
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') || '');
  }
});

document.addEventListener('change', e => {
  if (e.target.dataset && e.target.dataset.a === 'ch-col') {
    const l = e.target.dataset.l;
    const col = e.target.value;
    if (db.labels[l]) {
      db.labels[l] = col;
      save();
      if (st.open) drawer(st.open);
      render();
      toast(`Cor da etiqueta "${l}" atualizada.`);
    }
  }
  if (e.target.id === 'bulk-toggle-all') {
    const currentList = curCards && curCards.length ? curCards : all();
    if (e.target.checked) {
      st.sel = [...new Set([...st.sel, ...currentList.map(c => c.id)])];
    } else {
      const inViewIds = new Set(currentList.map(c => c.id));
      st.sel = st.sel.filter(id => !inViewIds.has(id));
    }
    render();
    return;
  }
  if (e.target.dataset && e.target.dataset.cbId) {
    const id = e.target.dataset.cbId;
    const idx = st.sel.indexOf(id);
    if (e.target.checked && idx < 0) st.sel.push(id);
    else if (!e.target.checked && idx >= 0) st.sel.splice(idx, 1);
    render();
    return;
  }
  if (e.target.id === 'fi') {
    if (e.target.files && e.target.files[0]) load(e.target.files[0], { onRender: render, onSyncEmbeddings: syncEmbeddings });
    e.target.value = '';
    return;
  }
  if (e.target.id === 'se') { st.et = e.target.value; render(); return; }
  if (e.target.id === 'so') { st.sort = e.target.value; render(); return; }
  if (e.target.id === 'mbv') { setMes($('#mb')?.dataset.k, m => m.v = e.target.checked); render(); return; }
  if (e.target.id === 'f-parto-ok') {
    const isChecked = e.target.checked;
    const lbl = e.target.closest('label');
    if (lbl) {
      lbl.style.color = isChecked ? '#16a34a' : 'var(--mut)';
      const sp = lbl.querySelector('span');
      if (sp) sp.textContent = isChecked ? '✓ Confirmado' : 'Confirmar';
    }
    return;
  }
  if (e.target.id === 'f-pend') {
    const isChecked = e.target.checked;
    const lbl = e.target.closest('label');
    if (lbl) {
      lbl.style.color = isChecked ? '#b45309' : 'var(--mut)';
      const sp = lbl.querySelector('span');
      if (sp) sp.textContent = isChecked ? '● Pendência marcada' : 'Marcar pendência';
    }
    const cardObs = $('#dr-card-obs');
    if (cardObs) {
      cardObs.classList.toggle('pend', isChecked);
      const titleSpan = cardObs.querySelector('.dr-card-title span');
      if (titleSpan) {
        let mkEl = titleSpan.querySelector('.mk.pend');
        if (isChecked && !mkEl) {
          titleSpan.insertAdjacentHTML('beforeend', '<span class="mk pend" role="img" aria-label="Contato com pendência" title="Contato com pendência">●</span>');
        } else if (!isChecked && mkEl) {
          mkEl.remove();
        }
      }
    }
    return;
  }
  if (e.target.id === 'f-et') {
    updateDrawerAdvCard(e.target.value);
    return;
  }
});

// Eventos específicos de interface
$('#lgn-add-btn')?.addEventListener('click', () => {
  const inp = $('#lgn-name'); const color = $('#lgn-color')?.value || 'black';
  if (!inp) return;
  const name = inp.value.trim();
  if (!name) return toast('Informe um nome para a etiqueta.');
  if (db.labels[name]) return toast('Essa etiqueta já existe.');
  db.labels[name] = color;
  inp.value = '';
  save(); render(); renderLabelsModal();
  toast(`Etiqueta "${name}" criada.`);
});

$('#ai-fab')?.addEventListener('click', () => {
  const win = $('#ai-window');
  if (win) {
    win.hidden = !win.hidden;
    if (!win.hidden) $('#ai-prompt')?.focus();
  }
});

$('#ai-model-select')?.addEventListener('change', e => {
  const newModel = e.target.value.trim();
  if (newModel) {
    storage.setItem(STORAGE_KEYS.CHAT_MODEL, newModel);
    const cfgChat = $('#cfg-chat-model');
    if (cfgChat) cfgChat.value = newModel;
    toast(`Modelo alterado para ${newModel}. Contexto preservado.`);
  }
});

$('#cfg-close-btn')?.addEventListener('click', () => $('#cfg-dlg')?.close());
$('#cfg-key-toggle')?.addEventListener('click', () => {
  const inp = $('#cfg-key');
  if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
});
$('#cfg-save-btn')?.addEventListener('click', async () => {
  const key = $('#cfg-key')?.value.trim() || '';
  const chatModel = $('#cfg-chat-model')?.value.trim() || '';
  const embedModel = $('#cfg-embed-model')?.value.trim() || '';
  const bDays = parseInt($('#cfg-backup-days')?.value, 10);
  const pDays = parseInt($('#cfg-parto-days')?.value, 10);
  const inDays = parseInt($('#cfg-inactive-days')?.value, 10);

  if (key && chatModel) {
    const valid = await validateGeminiModel(chatModel, key);
    if (!valid) {
      toast(`O modelo "${chatModel}" não foi encontrado na API Gemini. Verifique o nome.`, 'danger');
      return;
    }
  }

  if (key) storage.setItem(STORAGE_KEYS.GEMINI_API_KEY, key);
  else storage.removeItem(STORAGE_KEYS.GEMINI_API_KEY);

  if (chatModel) storage.setItem(STORAGE_KEYS.CHAT_MODEL, chatModel);
  if (embedModel) storage.setItem(STORAGE_KEYS.EMBED_MODEL, embedModel);
  if (!isNaN(bDays) && bDays > 0) storage.setItem('cfg_backup_days', String(bDays));
  if (!isNaN(pDays) && pDays >= 0 && pDays <= 30) storage.setItem('cfg_parto_days', String(pDays));
  if (!isNaN(inDays) && inDays > 0) storage.setItem('cfg_inactive_days', String(inDays));

  toast('Configurações salvas.');
  updateRagConfigStatus();
  $('#cfg-dlg')?.close();
  syncEmbeddings();
  populateAiModelSelect();
  renderNotifications();
});

$('#cfg-snapshots-list')?.addEventListener('click', e => {
  const restBtn = e.target.closest('[data-snap-restore]');
  if (restBtn) {
    const id = restBtn.getAttribute('data-snap-restore');
    restoreSnapshot(id, { onRender: render, onSyncEmbeddings: syncEmbeddings });
    return;
  }
  const dlBtn = e.target.closest('[data-snap-dl]');
  if (dlBtn) {
    const id = dlBtn.getAttribute('data-snap-dl');
    downloadSnapshot(id);
    return;
  }
});

$('#cfg-reindex-btn')?.addEventListener('click', async () => {
  const nCards = Object.keys(db.cards || {}).length;
  toast(`Reindexando ${nCards} contatos (conta ${nCards} requisições da cota diária)…`);
  await syncEmbeddings(true);
});

$('#cfg-sync-now-btn')?.addEventListener('click', async () => {
  const btn = $('#cfg-sync-now-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Sincronizando...';
  }
  try {
    await syncHybrid(true);
    await updatePersistenceUI();
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg> Sincronizar Agora';
    }
  }
});

// Navegação por abas nas Configurações
document.addEventListener('click', e => {
  const tabBtn = e.target.closest('[data-cfg-tab]');
  if (tabBtn) {
    const tabName = tabBtn.getAttribute('data-cfg-tab');
    document.querySelectorAll('.cfg-tab-btn').forEach(b => b.classList.toggle('active', b === tabBtn));
    document.querySelectorAll('.cfg-tab-pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + tabName));
  }
});

// Sincronização multi-abas via storage event
window.addEventListener('storage', e => {
  if (e.key === STORAGE_KEYS.DB) {
    if (st.open && hasDrawerUnsavedChanges()) {
      toast('Os dados foram alterados em outra aba. Salve ou descarte suas alterações no contato aberto antes de recarregar.', 'warn', 10000);
      return;
    }
    toast('Os dados foram alterados em outra aba.', 'info', 10000, {
      label: 'Recarregar dados',
      onClick: () => {
        try {
          const raw = storage.getItem(STORAGE_KEYS.DB);
          if (raw) {
            setDb(JSON.parse(raw));
            render();
            toast('Dados recarregados com sucesso!', 'ok');
          }
        } catch (err) {
          console.error('Erro ao recarregar dados:', err);
        }
      }
    });
  }
});

// =========================================================================
// INICIALIZAÇÃO DO SISTEMA
// =========================================================================
// Normalização inicial de contatos
const _initCardsBefore = JSON.stringify(db.cards || {});
Object.keys(db.cards || {}).forEach(id => {
  const c = normCard(db.cards[id]);
  if (c) db.cards[id] = c;
});
if (_initCardsBefore !== JSON.stringify(db.cards || {})) {
  save();
}

// Inicializações de infraestrutura e serviços
initLocalDb();
loadSyncQueue();
setupAuthListener();
initConfirmModal();
initMonthModal({ onRender: render });
initHeader({ onRender: render, onHome: () => ACTIONS.home() });
initStoragePersistence(updatePersistenceUI);
checkVolatileStorage();

// Carregamento IDB de segurança (recupera contatos caso IDB tenha base mais volumosa)
loadDbFromIdb().then(idbDb => {
  if (idbDb && typeof idbDb === 'object' && idbDb.cards) {
    const idbCardCount = Object.keys(idbDb.cards || {}).length;
    const curCardCount = Object.keys(db.cards || {}).length;
    if (idbCardCount > curCardCount) {
      setDb(idbDb);
      render();
    }
  }
}).catch(err => console.warn('Falha na inicialização do IndexedDB:', err));

// Render inicial
render();

// Sincronização periódica em segundo plano (a cada 45s se visível e online)
setInterval(() => {
  if (document.visibilityState === 'visible' && navigator.onLine && !SYNC_ENGINE.isSyncing) {
    syncHybrid(false);
  }
}, 45000);

// Validação final de autenticação antes de inicializar serviços de nuvem e IA
checkAuthSession().then(async session => {
  if (!session) return;
  initAiChat({ onRender: render });
  loadStoredReports();
  populateAiModelSelect();
  await syncHybrid(false);
  render();
  updatePersistenceUI();
  syncEmbeddings();
  updateRagConfigStatus();
  checkInitialAlerts();
});

// Exportações globais para compatibilidade e console debugging
window.render = render;
window.all = all;
window.toast = toast;
window.drawer = drawer;
window.syncHybrid = syncHybrid;
window.updatePersistenceUI = updatePersistenceUI;
window.exportBackup = () => exportBackup({ onRender: render });
window.exportCsv = exportCsv;
window.openNewMonthModal = openNewMonthModal;
window.openLabelsModal = openLabelsModal;
window.openSettingsModal = openSettingsModal;
window.checkInitialAlerts = checkInitialAlerts;

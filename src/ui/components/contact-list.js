import { st, db, all, save, curCards, setCurCards } from '../state.js';
import { esc, norm, plain, hs } from '../../utils/text.js';
import { mlabel, fs } from '../../utils/date.js';
import { STAGES, STAGE_MAP, COLOR_HEX } from '../../config/constants.js';
import { isCardPend, backupAgeDays, getBackupReminderDays } from './alerts.js';
import { storage } from '../../services/storage.service.js';
import { APP } from '../state.js';
import { ask } from './confirm-modal.js';
import { toast } from '../toast.js';

const $ = s => document.querySelector(s);
const S = STAGES;
const SN = STAGE_MAP;
const HEX = COLOR_HEX;

export function ls(n) {
  const [b, v] = (db.labels[n] || 'black').split('_');
  const lt = v === 'light', dk = v === 'dark', h = HEX[b] || HEX.black;
  return `background:${h};color:${lt ? '#0f172a' : dk ? '#fff' : '#fff'};border-color:${h}`;
}

export const labs = a => (a || []).map(l => `<span class="lab" style="${ls(l)}">${esc(l)}</span>`).join('');

const lt = c => Math.max(0, ...(c.hist || []).map(h => h.d ? Date.parse(h.d) : 0));
const si = c => S.findIndex(s => s[0] === c.etapa);
const nm = (a, b) => a.nome.localeCompare(b.nome, 'pt');
const dk = v => v || '9999';

export function matchScore(c, q) {
  if (!q || !q.trim()) return 0;
  const terms = norm(q).trim().split(/\s+/).filter(Boolean);
  const n = norm(c.nome || '');
  if (terms.every(t => n.includes(t))) return 100;
  const nameMatches = terms.filter(t => n.includes(t)).length;
  if (nameMatches > 0) return 50 + nameMatches * 10;
  const labelStr = norm((c.labels || []).join(' '));
  if (terms.some(t => labelStr.includes(t))) return 30;
  return 10;
}

export const SORT = {
  etapa: (a, b) => si(a) - si(b) || nm(a, b),
  nome: nm,
  parto: (a, b) => dk(a.parto).localeCompare(dk(b.parto)) || nm(a, b),
  ativ: (a, b) => lt(b) - lt(a) || nm(a, b),
  relevancia: (a, b) => (matchScore(b, st.q) - matchScore(a, st.q)) || nm(a, b)
};

export const hit = c => {
  if (!st.q || !st.q.trim()) return true;
  const terms = norm(st.q).trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const target = norm([
    c.nome || '',
    (c.labels || []).join(' '),
    plain(c.obs || ''),
    ...(c.hist || []).map(h => h.t || '')
  ].join(' '));
  return terms.every(term => target.includes(term));
};

export const inMes = c => st.mes === '*' || c.mes === st.mes;

export function renderContext(cs, base, sk) {
  const sum = $('#context-summary');
  if (sum) {
    const act = c => !c.arq && c.etapa !== 'fim';
    const pending = Object.values(db.mnotes || {}).filter(v => v && v.v).length;
    const noDate = cs.filter(c => !c.mes && !c.arq).length;
    sum.innerHTML = `<div class="context-stat"><b>${cs.filter(act).length}</b><span>Em andamento</span></div><div class="context-stat"><b>${pending}</b><span>Meses pendentes</span></div><div class="context-stat"><b>${base.length}</b><span>No período</span></div><div class="context-stat"><b>${noDate}</b><span>Sem mês</span></div>`;
  }
  const sys = $('#context-system');
  if (sys) {
    const age = backupAgeDays(), remDays = getBackupReminderDays(), vc = Number.isFinite(APP.vectorCount) ? APP.vectorCount : '—';
    sys.innerHTML = `<div class="context-system-row"><span>Backup</span><span class="status-pill ${!db.bk || age > remDays ? 'warn' : 'good'}">${!db.bk ? 'Não realizado' : age > remDays ? age + ' dias' : 'Em dia'}</span></div><div class="context-system-row"><span>Armazenamento</span><span class="status-pill ${storage.persistent ? 'good' : 'warn'}">${storage.persistent ? 'Local' : 'Sessão'}</span></div><div class="context-system-row"><span>Busca semântica</span><span class="status-pill">${vc}/${cs.length || 0}</span></div>`;
  }
}

export function renderContactList({ onOpenDrawer, onRender }) {
  const cs = all();
  const act = c => !c.arq && c.etapa !== 'fim';
  const has = c => !st.lb.length || (st.mode === 'e' ? st.lb.every(l => c.labels.includes(l)) : st.lb.some(l => c.labels.includes(l)));
  const pre = cs.filter(c => inMes(c) && hit(c));
  const base = pre.filter(has);
  const cnt = f => base.filter(f).length;

  const ch = [['ativos', 'Em andamento', cnt(act)], ['pendentes', 'Pendentes', cnt(isCardPend)], ['todos', 'Todos', cnt(c => !c.arq)], ...S.map(s => [s[0], s[1], cnt(c => c.etapa === s[0] && !c.arq)]), ['arq', 'Arquivados', cnt(c => c.arq)]];
  const activeMonthLabel = st.mes === '*' ? 'Todos os meses' : mlabel(st.mes);
  const activeScopeLabel = ch.find(x => x[0] === st.et)?.[1] || 'Em andamento';
  const qs = st.q ? ` Busca: “${esc(st.q)}”` : '';
  const titleEl = $('#page-title'), subEl = $('#page-subtitle'), statsEl = $('#page-stats');
  if (titleEl) titleEl.textContent = activeMonthLabel;
  if (subEl) subEl.textContent = `${activeScopeLabel}${st.lb.length ? ' · ' + st.lb.length + ' filtro(s) por etiqueta' : ''}${qs}`;
  if (statsEl) statsEl.innerHTML = `<div class="page-stat"><b>${cnt(act)}</b><span>Em andamento</span></div><div class="page-stat ${st.et === 'pendentes' ? 'stat-active' : ''}" style="cursor:pointer" data-e="${st.et === 'pendentes' ? 'ativos' : 'pendentes'}" title="Clique para filtrar pendências"><b>${cnt(isCardPend)}</b><span>Pendentes</span></div><div class="page-stat"><b>${base.length}</b><span>No período</span></div><div class="page-stat"><b>${cs.filter(c => c.arq).length}</b><span>Arquivados</span></div>`;

  const ef = c => st.et === 'ativos' ? act(c) : st.et === 'pendentes' ? isCardPend(c) : st.et === 'todos' ? !c.arq : st.et === 'arq' ? c.arq : c.etapa === st.et && !c.arq;
  const rows = base.filter(ef).sort(SORT[st.sort] || SORT.etapa);
  setCurCards(rows);

  const lc = {}, E = st.mode === 'e';
  (E ? rows : pre.filter(ef)).forEach(c => c.labels.forEach(l => lc[l] = (lc[l] || 0) + 1));
  const lo = Object.keys(db.labels).filter(l => lc[l] || st.lb.includes(l)).sort((a, b) => (lc[b] || 0) - (lc[a] || 0));
  const lbAttr = l => `data-a="lbt" data-l="${esc(l)}" style="${ls(l)}"`;

  const lfEl = $('#lf');
  if (lfEl) {
    lfEl.innerHTML = `<div class="filter-primary">
      <button type="button" class="chip ${st.lopen ? 'on' : ''}" data-a="lbo" aria-expanded="${st.lopen}">
        Etiquetas${st.lb.length ? ' (' + st.lb.length + ')' : ''} ▾
      </button>
      <button type="button" class="chip chip-pend ${st.et === 'pendentes' ? 'on pend-chip-on' : ''}" data-e="${st.et === 'pendentes' ? 'ativos' : 'pendentes'}" title="Filtrar pendências">
        ⚠️ Pendentes (${cnt(isCardPend)})
      </button>
      ${st.lb.length > 1 ? `<span class="seg" role="group" aria-label="Combinação de labels"><button type="button" class="${st.mode === 'e' ? 'on' : ''}" data-a="lbm" data-v="e" aria-pressed="${st.mode === 'e'}">Todas</button><button type="button" class="${st.mode === 'o' ? 'on' : ''}" data-a="lbm" data-v="o" aria-pressed="${st.mode === 'o'}">Qualquer uma</button></span>` : ''}
      ${st.lb.map(l => `<button type="button" class="lab" ${lbAttr(l)} aria-label="Remover filtro ${esc(l)}">${esc(l)} ✕</button>`).join('')}
      ${st.lb.length ? '<button type="button" class="chip" data-a="lbx">Limpar filtro</button>' : ''}
    </div>
    <div class="filter-actions">
      <button type="button" class="chip ${st.bulk ? 'on' : ''}" data-a="toggle-bulk" title="Selecionar múltiplos contatos para exclusão em lote">${st.bulk ? '✕ Cancelar seleção' : '☑ Selecionar em lote'}</button>
      <select id="se" name="filter-etapa" class="${st.et !== 'ativos' ? 'active-filter' : ''}" aria-label="Filtrar por etapa">${ch.map(x => `<option value="${x[0]}" ${st.et === x[0] ? 'selected' : ''}>Etapa: ${x[1]} (${x[2]})</option>`).join('')}</select>
      <select id="so" name="sort-order" aria-label="Ordenar">${[['relevancia', 'Relevância da busca'], ['etapa', 'Ordenar: Etapa'], ['nome', 'Nome (A–Z)'], ['parto', 'Data do parto'], ['ativ', 'Atividade recente']].map(o => `<option value="${o[0]}" ${st.sort === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select>
    </div>`;
  }

  const sk = /^\d/.test(st.mes) ? st.mes : '';
  renderContext(cs, base, sk);

  const lpEl = $('#lp');
  if (lpEl) {
    lpEl.hidden = !st.lopen;
    lpEl.innerHTML = `<small class="sp0">${E && st.lb.length ? 'Etiquetas filtradas' : 'Todas as etiquetas disponíveis'}</small>` + lo.map(l => `<button class="lab ${st.lb.includes(l) ? '' : 'off'}" ${lbAttr(l)}>${esc(l)} (${lc[l] || 0})</button>`).join('') || 'Nenhuma label cadastrada.';
  }

  const TRASH_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5"/></svg>';
  const bulkBarHtml = (st.bulk && rows.length) ? `<div class="bulk-toolbar" role="region" aria-label="Ações em lote"><div class="bulk-toolbar-left"><label class="bulk-all-label"><input type="checkbox" id="bulk-toggle-all" name="bulk-toggle-all" ${rows.length > 0 && rows.every(c => st.sel.includes(c.id)) ? 'checked' : ''}><span>Selecionar todos da lista (${rows.length})</span></label><span class="bulk-count-badge">${st.sel.length} selecionado(s)</span></div><div class="bulk-toolbar-right"><button type="button" class="bulk-action-btn bulk-del-btn" data-a="bulk-delete" ${st.sel.length === 0 ? 'disabled' : ''}>${TRASH_ICON} Excluir selecionados (${st.sel.length})</button><button type="button" class="bulk-action-btn" data-a="toggle-bulk">Fechar</button></div></div>` : '';

  const listEl = $('#list');
  if (listEl) {
    listEl.innerHTML = !cs.length ? '<div class="empty"><h2>Nenhum contato cadastrado</h2><p>Comece criando um atendimento ou importando seus dados existentes.</p><button type="button" class="btn p" data-a="new">+ Novo contato</button></div>'
      : (bulkBarHtml + (rows.map(c => {
        const s = SN[c.etapa] || S[0], last = (hs(c)[0] || {}).h;
        const isSel = st.bulk && st.sel.includes(c.id);
        const pend = isCardPend(c);
        const mkr = pend ? '<span class="mk pend" role="img" aria-label="Contato com pendência" title="Contato com pendência">●</span>' : '';
        const cbHtml = st.bulk ? `<span class="row-cb-wrap"><input type="checkbox" id="cb-${esc(c.id)}" name="select-card-${esc(c.id)}" class="row-cb" data-cb-id="${esc(c.id)}" ${isSel ? 'checked' : ''} aria-label="Selecionar ${esc(c.nome)}"></span>` : '';
        return `<button type="button" class="row ${pend ? 'has-pending' : ''} ${st.bulk ? 'bulk-mode' : ''} ${isSel ? 'selected-for-bulk' : ''}" style="--sc:${s[2]}" data-id="${esc(c.id)}" aria-label="Abrir atendimento de ${esc(c.nome)}">
          ${cbHtml}
          <span class="row-main">
            <span class="row-title"><b>${esc(c.nome)}</b>${mkr}</span>
            <span class="row-labels">${labs(c.labels)}</span>
          </span>
          <span class="row-meta">
            <span class="st">${s[1]}</span>
            ${pend ? '<span class="row-pend-tag" title="Contato com pendência">⚠️ Pendente</span>' : ''}
            ${c.parto ? `<span class="row-date">Parto ${fs(c.parto)}</span>` : ''}
            ${c.saque ? `<span class="row-date">Pagamento ${fs(c.saque)}</span>` : ''}
          </span>
          ${last ? `<span class="row-note">${esc(last.t)}</span>` : ''}
        </button>`;
      }).join('') || `<div class="empty"><h2>Nenhum atendimento encontrado</h2><p>Tente remover algum filtro ou pesquisar por outro termo.</p>${(st.q || st.lb.length) ? '<button type="button" class="btn" data-a="home">Limpar filtros</button>' : ''}</div>`));
  }
}

export async function bulkDeleteCards({ onRender, onDeleteVector, onUpdateRag }) {
  const count = st.sel.length;
  if (!count) return;
  if (!await ask(`Excluir definitivamente os ${count} contatos selecionados?`, { ok: `Excluir ${count} contatos`, danger: true, title: 'Exclusão em Lote' })) return;
  const snap = typeof window.createSnapshot === 'function' ? await window.createSnapshot(`Exclusão em lote de ${count} contatos`) : null;
  st.sel.forEach(id => {
    delete db.cards[id];
    if (typeof onDeleteVector === 'function') onDeleteVector(id);
    if (!db.del.includes(id)) db.del.push(id);
  });
  st.sel = [];
  st.bulk = false;
  save();
  if (typeof onRender === 'function') onRender();
  if (typeof onUpdateRag === 'function') onUpdateRag();
  toast(`${count} contato${count > 1 ? 's' : ''} excluído${count > 1 ? 's' : ''} com sucesso.`, 'info', 10000, snap ? {
    label: 'Desfazer',
    onClick: () => {
      if (typeof window.setDb === 'function') window.setDb(JSON.parse(JSON.stringify(snap.db)));
      save();
      if (typeof onRender === 'function') onRender();
      if (typeof window.syncEmbeddings === 'function') window.syncEmbeddings();
      toast('Exclusão em lote desfeita!', 'ok');
    }
  } : null);
}

if (typeof window !== 'undefined') {
  window.hit = hit;
  window.matchScore = matchScore;
  window.bulkDeleteCards = bulkDeleteCards;
}

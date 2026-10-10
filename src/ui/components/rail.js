import { st, db, all, save } from '../state.js';
import { esc } from '../../utils/text.js';
import { mlabel } from '../../utils/date.js';
import { MONTH_LABELS } from '../../config/constants.js';
import { isCardPend } from './alerts.js';

const $ = s => document.querySelector(s);
const ML = MONTH_LABELS;

const PENCIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const TRASH_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5"/></svg>';
const NOTEICO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

export const grow = t => {
  if (t) {
    t.style.height = 'auto';
    t.style.height = t.scrollHeight + 'px';
  }
};

export function renderRail() {
  const prevRailScroll = $('#rail-months-scroll')?.scrollTop ?? 0;
  const cs = all(), act = c => !c.arq && c.etapa !== 'fim';
  const rawKs = [...new Set([...cs.map(c => c.mes), ...db.meses])];
  const ks = rawKs.filter(k => k || cs.some(c => !c.mes)).sort((a, b) => !a ? 1 : !b ? -1 : b.localeCompare(a));

  const monthsCardsHtml = ks.map(k => {
    const nt = db.mnotes[k], on = st.mes === k;
    const hasCardPend = cs.some(c => c.mes === k && act(c) && isCardPend(c));
    const isMonthPend = !!(nt && nt.v);
    const pend = isMonthPend || hasCardPend;
    const txt = (nt && nt.n ? String(nt.n) : '').trim();
    const pendTitle = isMonthPend && hasCardPend ? 'Mês e contatos com pendências' : isMonthPend ? 'Pendente de validação' : 'Possui contatos com pendências';
    const mkr = pend ? `<span class="mk pend" role="img" aria-label="${pendTitle}" title="${pendTitle}">●</span>` : '';
    const nm = k ? ML[+k.slice(5) - 1] : 'Sem data', yr = k ? k.slice(0, 4) : '';
    const count = cs.filter(c => c.mes === k && act(c)).length;
    const slot = st.mm
      ? `<div class="month-manage-actions" role="group" aria-label="Ações de ${mlabel(k)}">
           <button type="button" class="mx pe" data-a="emes" data-k="${k}" aria-label="Editar nota de ${mlabel(k)}" title="Editar nota">${PENCIL}</button>
           <button type="button" class="mx del" data-a="dmes" data-k="${k}" aria-label="Excluir ${mlabel(k)}" title="${k ? 'Excluir mês' : 'Excluir contatos sem data'}">${TRASH_ICON}</button>
         </div>`
      : `<span class="month-count" title="Contatos ativos">${count}</span>`;
    const note = txt ? `<div class="month-note" title="${esc(txt)}">${NOTEICO}<span class="month-note-text">${esc(txt)}</span></div>` : '';
    return `<div class="month-card ${on ? 'selected' : ''} ${pend ? 'has-pending' : ''} ${st.mm ? 'managing' : ''}">
      <div class="month-head">
        <button type="button" class="month-btn ${on ? 'on' : ''}" data-m="${k}" aria-current="${on ? 'true' : 'false'}">
          <span class="month-name"><span class="month-title">${nm}${mkr}</span>${yr ? `<span class="month-year">${yr}</span>` : ''}</span>
        </button>
        <div class="month-slot">${slot}</div>
      </div>
      ${note}
    </div>`;
  }).join('');

  const headerHtml = `
    <div class="side-sec-title">Visão Geral</div>
    <button type="button" data-m="*" class="${st.mes === '*' ? 'on' : ''}">
      <span class="mt">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        Todos os meses
      </span>
      <small>${cs.filter(act).length}</small>
    </button>

    <div class="side-actions-row">
      <button type="button" class="side-action-btn" data-a="nm" title="Adicionar novo mês">+ Novo mês</button>
      <button type="button" class="side-action-btn" data-a="mm" aria-pressed="${st.mm}" title="Editar ou excluir meses">${st.mm ? '✓ Concluir' : 'Gerenciar'}</button>
    </div>

    <div class="side-sec-title" style="margin-top:10px">Meses de Atendimento</div>
  `;

  let railScrollEl = $('#rail-months-scroll');
  const railHeaderEl = $('#rail .rail-header');
  if (railHeaderEl && railScrollEl) {
    railHeaderEl.innerHTML = headerHtml;
    railScrollEl.innerHTML = monthsCardsHtml;
  } else {
    $('#rail').innerHTML = `
      <div class="rail-header">${headerHtml}</div>
      <div class="rail-months-scroll" id="rail-months-scroll" role="region" aria-label="Lista de meses de atendimento">
        ${monthsCardsHtml}
      </div>
    `;
    railScrollEl = $('#rail-months-scroll');
  }

  if (railScrollEl && prevRailScroll > 0) {
    railScrollEl.scrollTop = prevRailScroll;
  }

  // Anotação / pendência contextual do mês selecionado
  const sk = /^\d/.test(st.mes) ? st.mes : '';
  const sn = (sk && db.mnotes[sk]) || { n: '', v: false };
  const mb = $('#mb');
  if (mb) {
    mb.hidden = false;
    mb.className = sn.v ? 'pend' : '';
    if (!sk) {
      mb.dataset.k = '';
      mb.innerHTML = '<div class="context-note-empty"><b>Nenhum mês selecionado</b>Escolha um mês ao lado para acompanhar suas pendências e anotações.</div>';
    } else if (!(mb.contains(document.activeElement) && mb.dataset.k === sk)) {
      mb.dataset.k = sk;
      mb.innerHTML = `<div class="mbh">
        <b>${mlabel(sk)}</b>
        <label><input type="checkbox" id="mbv"${sn.v ? ' checked' : ''}> Marcar como pendente</label>
      </div>
      <textarea id="mbx" rows="1" placeholder="Pendência ou anotação deste mês..." aria-label="Nota de ${mlabel(sk)}">${esc(sn.n)}</textarea>`;
      grow($('#mbx'));
    }
  }
  const noteTitle = $('#context-note-title');
  if (noteTitle) noteTitle.textContent = sk ? 'Pendências do mês' : 'Pendências e anotações';
}

export function setMes(k, f) {
  const m = db.mnotes[k] || { n: '', v: false };
  f(m);
  if (m.n.trim() || m.v) db.mnotes[k] = m;
  else delete db.mnotes[k];
  save();
}

if (typeof window !== 'undefined') {
  window.setMes = setMes;
}

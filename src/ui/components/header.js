import { APP, st, db, all } from '../state.js';
import { esc, plain } from '../../utils/text.js';
import { fx, mlabel } from '../../utils/date.js';
import { STAGE_MAP } from '../../config/constants.js';
import { getBackupReminderDays, getPartoNotifications, getInactiveDaysThreshold, isSnoozed, backupAgeDays, monthNotes } from './alerts.js';
import { doLogout } from '../../services/auth.service.js';

const $ = s => document.querySelector(s);
const SN = STAGE_MAP;

export function renderNotifications() {
  const badge = $('#notif-badge'), list = $('#notif-list'), summary = $('#notif-summary');
  if (!badge || !list || !summary) return;
  const items = [];
  const age = backupAgeDays();
  const remDays = getBackupReminderDays();
  if (!db.bk) items.push({ kind: 'danger', title: 'Backup ainda não realizado', text: 'Faça um backup para ter uma cópia dos seus dados.', action: 'exp', label: 'Fazer backup agora' });
  else if (age > remDays) items.push({ kind: 'warn', title: 'Backup desatualizado', text: `O último backup tem ${age} dias (lembrete configurado: a cada ${remDays} dias).`, action: 'exp', label: 'Atualizar backup' });

  const partos = getPartoNotifications();
  partos.forEach(({ c, status }) => {
    let title, text;
    if (status === 'tomorrow') {
      title = `Parto amanhã: ${c.nome}`;
      text = `Parto previsto para amanhã (${fx(c.parto)})${c.mes ? ' • ' + mlabel(c.mes) : ''}. Confirme após o nascimento.`;
    } else if (status === 'today') {
      title = `Parto hoje: ${c.nome}`;
      text = `Parto previsto para hoje (${fx(c.parto)})${c.mes ? ' • ' + mlabel(c.mes) : ''}. Confirme se ocorreu.`;
    } else if (status === 'overdue') {
      title = `Parto pendente: ${c.nome}`;
      text = `Data prevista: ${fx(c.parto)} (${c.mes ? mlabel(c.mes) : 'Sem mês'}). Confirme para retirar o aviso.`;
    } else {
      title = `Parto próximo: ${c.nome}`;
      text = `Data prevista: ${fx(c.parto)}${c.mes ? ' • ' + mlabel(c.mes) : ''}. Fique atento ao período.`;
    }
    items.push({
      kind: 'parto',
      title,
      text,
      action: 'contact',
      contactId: c.id,
      month: c.mes,
      label: 'Ir para contato',
      tipo: 'parto',
      canSnooze: true
    });
  });

  const inactiveThreshold = getInactiveDaysThreshold();
  const inactiveCards = all().filter(c => {
    if (c.arq || c.etapa === 'fim' || c.etapa === 'indef') return false;
    if (isSnoozed(c.id, 'etapa_inativa')) return false;
    const lastAct = Math.max(0, ...(c.hist || []).map(h => h.d ? Date.parse(h.d) : 0), c.upd ? Date.parse(c.upd) : 0);
    if (!lastAct) return false;
    const diff = Math.floor((Date.now() - lastAct) / 864e5);
    return diff >= inactiveThreshold;
  });
  inactiveCards.slice(0, 8).forEach(c => {
    const lastAct = Math.max(0, ...(c.hist || []).map(h => h.d ? Date.parse(h.d) : 0), c.upd ? Date.parse(c.upd) : 0);
    const diff = Math.floor((Date.now() - lastAct) / 864e5);
    items.push({
      kind: 'warn',
      title: `Sem atividade (${diff} dias): ${c.nome}`,
      text: `Contato parado na etapa ${SN[c.etapa]?.[1] || c.etapa} há ${diff} dias.`,
      action: 'contact',
      contactId: c.id,
      month: c.mes,
      label: 'Ver contato',
      tipo: 'etapa_inativa',
      canSnooze: true
    });
  });

  const pends = all().filter(c => !c.arq && c.pend);
  pends.slice(0, 8).forEach(c => items.push({ kind: 'warn', title: `Pendência: ${c.nome}`, text: (plain(c.obs) || 'Contato marcado como pendente.').trim(), action: 'contact', contactId: c.id, month: c.mes, label: 'Ver contato' }));

  monthNotes().filter(([k, v]) => v.v).slice(0, 8).forEach(([k, v]) => items.push({ kind: 'warn', title: `Pendência em ${mlabel(k)}`, text: (v.n || 'Mês marcado como pendente.').trim(), action: 'month', month: k, label: 'Abrir mês' }));
  const noDate = all().filter(c => !c.mes && !c.arq).length;
  if (noDate) items.push({ kind: 'warn', title: `${noDate} atendimento${noDate === 1 ? '' : 's'} sem mês`, text: 'Existem contatos que ainda precisam ser associados a um período.', action: 'no-date', label: 'Ver sem data' });
  badge.hidden = !items.length;
  badge.textContent = items.length > 9 ? '9+' : String(items.length);
  summary.textContent = items.length ? `${items.length} pendência${items.length === 1 ? '' : 's'}` : 'Tudo certo';
  list.innerHTML = items.length ? items.map((it, i) => {
    const snoozeBtns = (it.canSnooze && it.contactId && it.tipo) ? `
      <button type="button" class="btn ghost" style="padding:2px 8px;font-size:11.5px" data-a="snooze" data-id="${esc(it.contactId)}" data-tipo="${esc(it.tipo)}" data-days="1" title="Ocultar por 1 dia">Adiar 1 dia</button>
      <button type="button" class="btn ghost" style="padding:2px 8px;font-size:11.5px" data-a="snooze" data-id="${esc(it.contactId)}" data-tipo="${esc(it.tipo)}" data-days="0" title="Dispensar alerta">Dispensar</button>
    ` : '';
    return `<div class="notif-item">
      <span class="notif-dot ${it.kind === 'danger' ? 'danger' : it.kind === 'parto' ? 'parto' : ''}"></span>
      <div class="notif-body">
        <strong>${esc(it.title)}</strong>
        <p>${esc(it.text)}</p>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:6px">
          <button type="button" class="btn" data-a="notif-action" data-notif="${i}">${esc(it.label)}</button>
          ${snoozeBtns}
        </div>
      </div>
    </div>`;
  }).join('') : '<div class="notif-item"><span class="notif-dot ok"></span><div class="notif-body"><strong>Nenhuma pendência</strong><p>Seu sistema está em dia.</p></div></div>';
  APP.notifications = items;
}

export function initHeader({ onRender, onHome, onSearch }) {
  // Busca em tempo real com debounce
  let qt;
  const qInput = $('#q');
  if (qInput) {
    qInput.value = st.q || '';
    qInput.addEventListener('input', e => {
      clearTimeout(qt);
      const v = e.target.value;
      qt = setTimeout(() => {
        st.q = v;
        if (typeof onRender === 'function') onRender();
      }, 180);
    });
  }

  // Atalho '/' para focar na busca
  window.addEventListener('keydown', e => {
    if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
      e.preventDefault();
      qInput?.focus();
    }
  });

  // Notificações popover
  const notifBtn = $('#notif-btn');
  const notifPop = $('#notif-pop');
  if (notifBtn && notifPop) {
    notifBtn.addEventListener('click', e => {
      e.stopPropagation();
      notifPop.hidden = !notifPop.hidden;
    });
    document.addEventListener('click', e => {
      if (!notifPop.contains(e.target) && e.target !== notifBtn) {
        notifPop.hidden = true;
      }
    });
  }

  // Ações de encerramento de sessão
  document.getElementById('btn-logout')?.addEventListener('click', doLogout);

  // Botão da logo (Brand)
  document.querySelector('.brand')?.addEventListener('click', () => {
    if (typeof onHome === 'function') onHome();
  });
}

if (typeof window !== 'undefined') {
  window.renderNotifications = renderNotifications;
}

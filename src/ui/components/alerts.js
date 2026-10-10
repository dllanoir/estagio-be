import { storage } from '../../services/storage.service.js';
import { db, save, all } from '../state.js';
import { toast } from '../toast.js';
import { fx, mlabel } from '../../utils/date.js';

export function getBackupReminderDays() {
  const d = parseInt(storage.getItem('cfg_backup_days') || '7', 10);
  return (Number.isFinite(d) && d > 0) ? d : 7;
}

export function getPartoAlertDays() {
  const d = parseInt(storage.getItem('cfg_parto_days') || '7', 10);
  return (Number.isFinite(d) && d >= 0 && d <= 30) ? d : 7;
}

export function getInactiveDaysThreshold() {
  const d = parseInt(storage.getItem('cfg_inactive_days') || '15', 10);
  return (Number.isFinite(d) && d > 0) ? d : 15;
}

export function isSnoozed(id, tipo) {
  if (!db.snooze || typeof db.snooze !== 'object' || !db.snooze[id]) return false;
  const entry = db.snooze[id];
  if (entry.tipo && tipo && entry.tipo !== tipo) return false;
  if (!entry.ate) return true;
  return new Date(entry.ate).getTime() > Date.now();
}

export function snoozeAlert(id, tipo, days) {
  if (!db.snooze || typeof db.snooze !== 'object') db.snooze = {};
  if (days === 0 || days === null) {
    db.snooze[id] = { tipo, ate: null };
  } else {
    const dt = new Date();
    dt.setDate(dt.getDate() + days);
    db.snooze[id] = { tipo, ate: dt.toISOString() };
  }
  save();
  if (typeof window.renderNotifications === 'function') window.renderNotifications();
}

export function backupAgeDays() {
  if (!db.bk) return Infinity;
  const t = Date.parse(db.bk);
  return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 864e5)) : Infinity;
}

export function monthNotes() {
  return Object.entries(db.mnotes || {}).filter(([k, v]) => /^\d{4}-\d{2}$/.test(k) && v && ((v.n || '').trim() || v.v));
}

export function getTodayStr() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function getTomorrowStr() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const tmrw = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return `${tmrw.getFullYear()}-${pad(tmrw.getMonth() + 1)}-${pad(tmrw.getDate())}`;
}

export const isCardPend = c => !c.arq && (c.pend || (c.parto && !c.parto_ok && c.parto <= getTomorrowStr()));

export function getPartoNotifications() {
  const todayStr = getTodayStr();
  const tomorrowStr = getTomorrowStr();
  const daysWindow = getPartoAlertDays();
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + daysWindow);
  const maxDateStr = maxDate.toISOString().slice(0, 10);

  const list = all().filter(c => !c.arq && c.parto && !c.parto_ok && c.parto <= maxDateStr && !isSnoozed(c.id, 'parto'));
  list.sort((a, b) => a.parto.localeCompare(b.parto));
  return list.map(c => {
    let status = 'upcoming';
    if (c.parto < todayStr) status = 'overdue';
    else if (c.parto === tomorrowStr) status = 'tomorrow';
    else if (c.parto === todayStr) status = 'today';
    return { c, status };
  });
}

export function checkInitialAlerts() {
  const due = getPartoNotifications();
  const pendingCards = all().filter(c => !c.arq && c.pend);
  const pendingMonths = monthNotes().filter(([k, v]) => v.v);

  let delay = 0;
  const step = 200;

  due.forEach(p => {
    setTimeout(() => {
      if (p.status === 'tomorrow') {
        toast(`🔔 Parto amanhã: ${p.c.nome} (${fx(p.c.parto)})`, 'warn', 7000);
      } else {
        toast(`⚠️ Parto pendente de confirmação: ${p.c.nome} (${fx(p.c.parto)})`, 'warn', 7000);
      }
    }, delay);
    delay += step;
  });

  pendingCards.forEach(c => {
    setTimeout(() => {
      toast(`📌 Contato com pendência: ${c.nome}${c.mes ? ' (' + mlabel(c.mes) + ')' : ''}`, 'warn', 7000);
    }, delay);
    delay += step;
  });

  pendingMonths.forEach(([k]) => {
    setTimeout(() => {
      toast(`📅 Mês com pendência ativa: ${mlabel(k)}`, 'warn', 7000);
    }, delay);
    delay += step;
  });
}

if (typeof window !== 'undefined') {
  window.getPartoAlertDays = getPartoAlertDays;
  window.getInactiveDaysThreshold = getInactiveDaysThreshold;
  window.isSnoozed = isSnoozed;
  window.snoozeAlert = snoozeAlert;
  window.checkInitialAlerts = checkInitialAlerts;
}

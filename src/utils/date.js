import { MONTH_NAMES, MONTH_LABELS } from '../config/constants.js';

export const now = () => new Date().toISOString();

export const okd = v => {
  if (!v) return true;
  if (!/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

export const okm = v => !v || /^20\d\d-(0[1-9]|1[0-2])$/.test(v);

export const fx = s => s ? s.split('-').reverse().join('/') : '';

export const mlabel = k => k ? MONTH_LABELS[+k.slice(5) - 1] + ' de ' + k.slice(0, 4) : 'Sem data';

export const mkey = t => {
  const normText = String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const m = normText.match(/(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro).*?(\d{4})/);
  return m ? m[2] + '-' + String(MONTH_NAMES.indexOf(m[1]) + 1).padStart(2, '0') : '';
};

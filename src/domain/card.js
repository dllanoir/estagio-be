import { STAGE_MAP } from '../config/constants.js';
import { okd, okm, now } from '../utils/date.js';
import { toHtml, clean } from '../utils/text.js';

export function normCard(c) {
  if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !/^[\w.-]{1,64}$/.test(c.id)) {
    return null;
  }
  c.nome = String(c.nome ?? '');
  c.etapa = STAGE_MAP[c.etapa] ? c.etapa : 'triagem';
  c.mes = okm(c.mes) ? String(c.mes || '') : '';
  c.parto = okd(c.parto) ? String(c.parto || '') : '';
  c.saque = okd(c.saque) ? String(c.saque || '') : '';
  c.labels = Array.isArray(c.labels) ? c.labels.map(String) : [];
  c.tl = Array.isArray(c.tl) ? c.tl.map(String) : [];
  c.hist = Array.isArray(c.hist)
    ? c.hist.filter(h => h && typeof h === 'object').map(h => ({ ...h, d: h.d ? String(h.d) : null, t: String(h.t ?? '') }))
    : [];
  if (!c.rich) {
    c.obs = toHtml(c.obs);
    c.rich = 1;
  } else {
    c.obs = clean(String(c.obs ?? ''));
  }
  c.td = String(c.td ?? '');
  c.arq = !!c.arq;
  c.parto_ok = !!c.parto_ok;
  c.pend = !!c.pend;
  c.upd = (c.upd && typeof c.upd === 'string') ? c.upd : (c.hist?.[0]?.d || now());
  return c;
}

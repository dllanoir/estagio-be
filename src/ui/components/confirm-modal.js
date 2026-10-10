import { logError } from '../../services/storage.service.js';

const $ = s => document.querySelector(s);

let _a = null;

export function ask(msg, o = {}) {
  return new Promise(res => {
    const d = $('#dg'), i = $('#dgi'), b = $('#dgo'), a = $('#dga'), icon = $('#dgi-icon'), title = $('#dg-title');
    if (!d) return res(true);
    $('#dgm').textContent = msg;
    if (title) {
      title.textContent = o.title || (o.danger ? 'Confirmar Exclusão' : o.input ? 'Informação Necessária' : 'Confirmação');
    }
    if (icon) {
      icon.textContent = o.danger ? '!' : o.input ? '…' : 'i';
      icon.className = 'dg-icon ' + (o.danger ? '' : 'info');
    }
    i.hidden = !o.input;
    i.style.display = o.input ? 'block' : 'none';
    i.value = '';
    i.placeholder = o.ph || '';
    const prevActive = document.activeElement;
    b.textContent = o.ok || 'OK';
    b.className = 'btn sm ' + (o.danger ? 'dng' : 'p');
    a.hidden = !o.alt;
    a.style.display = o.alt ? 'inline-flex' : 'none';
    a.textContent = o.alt || '';
    a.className = 'btn sm ' + (o.altDanger === false ? '' : 'dng');
    const cBtn = d.querySelector('[data-d="no"]');
    if (cBtn) cBtn.textContent = o.cancel || 'Cancelar';
    _a = ok => {
      _a = null;
      try { d.close(); } catch (e) { logError('dialog.close', e); }
      d.removeAttribute('open');
      if (cBtn) cBtn.textContent = 'Cancelar';
      if (prevActive && typeof prevActive.focus === 'function') {
        try { prevActive.focus(); } catch (e) { /* foco é opcional */ }
      }
      res(ok === 'alt' ? 'alt' : ok ? (o.input ? i.value.trim() : true) : null);
    };
    try { d.showModal(); } catch (e) { d.setAttribute('open', ''); }
    if (o.input) i.focus();
    else if (cBtn) cBtn.focus();
  });
}

export function initConfirmModal() {
  const dg = $('#dg');
  if (!dg) return;
  dg.addEventListener('click', e => {
    const b = e.target.closest('[data-d]');
    if (b && _a) _a(b.dataset.d === 'ok' ? true : b.dataset.d === 'alt' ? 'alt' : false);
  });
  dg.addEventListener('cancel', e => {
    e.preventDefault();
    if (_a) _a(false);
  });
  dg.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.id === 'dgi') {
      e.preventDefault();
      if (_a) _a(true);
    }
  });
}

if (typeof window !== 'undefined') {
  window.ask = ask;
}

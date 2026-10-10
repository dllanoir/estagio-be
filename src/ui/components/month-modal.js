import { st, db, all, save } from '../state.js';
import { mlabel } from '../../utils/date.js';
import { ask } from './confirm-modal.js';
import { toast } from '../toast.js';

const $ = s => document.querySelector(s);

let _mesTriggerEl = null;

export function openNewMonthModal() {
  _mesTriggerEl = document.activeElement;
  const now = new Date();
  const mInput = $('#dlg-mes-m');
  const yInput = $('#dlg-mes-y');
  if (mInput) mInput.value = String(now.getMonth() + 1).padStart(2, '0');
  if (yInput) yInput.value = String(now.getFullYear());
  const dlg = $('#dlg-mes');
  if (dlg && !dlg.open) {
    dlg.showModal();
    const closeBtn = dlg.querySelector('.modal-close');
    if (closeBtn) closeBtn.focus();
  }
}

export function initMonthModal({ onRender }) {
  $('#dlg-mes-confirm')?.addEventListener('click', () => {
    const m = $('#dlg-mes-m')?.value;
    const y = $('#dlg-mes-y')?.value.trim();
    if (!y || !/^\d{4}$/.test(y)) return toast('Ano inválido.');
    const k = `${y}-${m.padStart(2, '0')}`;
    if (!db.meses.includes(k)) db.meses.push(k);
    save();
    st.mes = k;
    $('#dlg-mes')?.close();
    if (typeof onRender === 'function') onRender();
    toast(`Mês ${mlabel(k)} adicionado!`);
  });
}

export async function delMes(k, { onRender, onDeleteVector, onUpdateRag }) {
  const isNoDate = !k;
  const cs = all().filter(c => c.mes === k), n = cs.length;
  let r;
  if (!n) r = await ask(isNoDate ? 'Remover a seção "Sem data"?' : `Excluir o mês ${mlabel(k)}?`, { ok: 'Remover', danger: true });
  else if (isNoDate) r = await ask(`"Sem data" possui ${n} contato${n > 1 ? 's' : ''}. Deseja excluir definitivamente todos esses contatos?`, { ok: `Excluir ${n} contato${n > 1 ? 's' : ''}`, danger: true });
  else r = await ask(`${mlabel(k)} possui ${n} contatos vinculados. O que deseja fazer?`, { ok: 'Mover para "Sem data"', alt: 'Excluir contatos e mês', danger: true });
  if (!r) return;

  const snap = typeof window.createSnapshot === 'function' ? await window.createSnapshot(`Exclusão de mês: ${k || 'Sem data'}`) : null;
  if (r === 'alt' || (isNoDate && r === true)) {
    cs.forEach(c => {
      delete db.cards[c.id];
      if (typeof onDeleteVector === 'function') onDeleteVector(c.id);
      if (!db.del.includes(c.id)) db.del.push(c.id);
    });
  } else if (!isNoDate) {
    cs.forEach(c => {
      c.upd = new Date().toISOString();
      c.hist.unshift({ d: new Date().toISOString(), t: `Mês alterado: ${mlabel(k)} → Sem data` });
      c.mes = '';
    });
  }
  if (!isNoDate) db.meses = db.meses.filter(m => m !== k);
  delete db.mnotes[k];
  if (st.mes === k) st.mes = '*';
  save();
  if (typeof onRender === 'function') onRender();
  if (typeof onUpdateRag === 'function') onUpdateRag();

  toast(isNoDate ? 'Contatos sem data excluídos.' : 'Mês excluído.', 'info', 10000, snap ? {
    label: 'Desfazer',
    onClick: () => {
      if (typeof window.setDb === 'function') window.setDb(JSON.parse(JSON.stringify(snap.db)));
      save();
      if (typeof onRender === 'function') onRender();
      if (typeof window.syncEmbeddings === 'function') window.syncEmbeddings();
      toast('Exclusão do mês desfeita!', 'ok');
    }
  } : null);
}

if (typeof window !== 'undefined') {
  window.openNewMonthModal = openNewMonthModal;
  window.delMes = delMes;
}

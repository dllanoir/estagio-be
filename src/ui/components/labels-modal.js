import { st, db, all, save, APP } from '../state.js';
import { esc, norm } from '../../utils/text.js';
import { colorOpts } from '../../domain/label.js';
import { ls } from './contact-list.js';
import { ask } from './confirm-modal.js';
import { toast } from '../toast.js';

const $ = s => document.querySelector(s);
const PENCIL = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
const TRASH = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5"/></svg>';

let _labelTriggerEl = null;

export function openLabelsModal() {
  _labelTriggerEl = document.activeElement;
  const dlg = $('#dlg-label');
  if (dlg && !dlg.open) {
    dlg.showModal();
    const closeBtn = dlg.querySelector('.modal-close');
    if (closeBtn) closeBtn.focus();
  }
  renderLabelsModal();
}

export function renderLabelsModal() {
  const cs = all();
  const ua = {};
  cs.forEach(c => c.labels.forEach(l => ua[l] = (ua[l] || 0) + 1));
  const lq = norm(st.lq || '');
  st.ls = st.ls.filter(l => db.labels[l]);
  const vl = Object.keys(db.labels).filter(l => norm(l).includes(lq)).sort((a, b) => a.localeCompare(b, 'pt'));

  APP.labelPicker.vl = vl;
  APP.labelPicker.ua = ua;
  const listEl = $('#dlg-label-list');
  if (!listEl) return;

  if (!vl.length) {
    listEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--mut)">Nenhuma etiqueta encontrada.</div>';
    return;
  }

  listEl.innerHTML = vl.map(l => {
    const sel = st.ls.includes(l);
    const count = ua[l] || 0;
    const colorKey = (db.labels[l] || 'black').split('_')[0];
    return `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid var(--ln);border-radius:8px;background:var(--pn)">
        <input type="checkbox" ${sel ? 'checked' : ''} data-a="lsel" data-l="${esc(l)}" title="Selecionar para exclusão em lote">
        <span class="lab" style="${ls(l)};flex:none;margin:0">${esc(l)}</span>
        <small style="color:var(--mut);margin-right:auto">${count} contato${count === 1 ? '' : 's'}</small>

        <select data-a="ch-col" data-l="${esc(l)}" style="padding:4px 8px;border:1px solid var(--ln);border-radius:6px;font-size:12px;background:var(--pn)">
          ${colorOpts(colorKey)}
        </select>

        <button class="icon-btn" data-a="ren-label" data-l="${esc(l)}" title="Renomear etiqueta">${PENCIL}</button>
        <button class="icon-btn dng" data-a="dl" data-l="${esc(l)}" title="Excluir etiqueta">${TRASH}</button>
      </div>
    `;
  }).join('');

  const delBtn = $('#dlg-lgd');
  if (delBtn) {
    delBtn.textContent = st.ls.length ? `Excluir (${st.ls.length})` : 'Excluir selecionadas';
    delBtn.disabled = !st.ls.length;
  }
}

export async function delLabels(a, { onRender, onDrawerRefresh }) {
  if (!await ask(`Excluir ${a.length} etiqueta${a.length > 1 ? 's' : ''}?`, { ok: 'Excluir', danger: true })) return;
  const snap = typeof window.createSnapshot === 'function' ? await window.createSnapshot(`Exclusão de ${a.length} etiquetas`) : null;
  a.forEach(l => {
    delete db.labels[l];
    if (!db.gone.includes(l)) db.gone.push(l);
  });
  all().forEach(c => {
    c.labels = c.labels.filter(x => !a.includes(x));
  });
  st.lb = st.lb.filter(x => !a.includes(x));
  st.ls = st.ls.filter(x => !a.includes(x));
  save();
  if (st.open && typeof onDrawerRefresh === 'function') onDrawerRefresh(st.open);
  if (typeof onRender === 'function') onRender();
  renderLabelsModal();

  toast('Etiquetas excluídas.', 'info', 10000, snap ? {
    label: 'Desfazer',
    onClick: () => {
      if (typeof window.setDb === 'function') window.setDb(JSON.parse(JSON.stringify(snap.db)));
      save();
      if (typeof onRender === 'function') onRender();
      if (typeof window.syncEmbeddings === 'function') window.syncEmbeddings();
      renderLabelsModal();
      toast('Exclusão de etiquetas desfeita!', 'ok');
    }
  } : null);
}

export async function editLabelName(oldName, { onRender, onDrawerRefresh }) {
  const newName = await ask(`Renomear etiqueta "${oldName}" para:`, { input: true, ph: oldName, ok: 'Renomear' });
  if (!newName) return;
  const trimmed = newName.trim();
  if (!trimmed || trimmed === oldName) return;
  if (db.labels[trimmed]) return toast('Já existe uma etiqueta com esse nome.');
  const color = db.labels[oldName] || 'black';
  db.labels[trimmed] = color;
  delete db.labels[oldName];
  all().forEach(c => {
    const idx = c.labels.indexOf(oldName);
    if (idx !== -1) c.labels[idx] = trimmed;
  });
  const fIdx = st.lb.indexOf(oldName); if (fIdx !== -1) st.lb[fIdx] = trimmed;
  const sIdx = st.ls.indexOf(oldName); if (sIdx !== -1) st.ls[sIdx] = trimmed;
  save();
  if (st.open && typeof onDrawerRefresh === 'function') onDrawerRefresh(st.open);
  if (typeof onRender === 'function') onRender();
  renderLabelsModal();
  toast(`Etiqueta renomeada para "${trimmed}".`);
}

export function initLabelsModal({ onRender, onDrawerRefresh }) {
  $('#lgn-add-btn')?.addEventListener('click', () => {
    const inp = $('#lgn-name');
    const color = $('#lgn-color')?.value || 'black';
    if (!inp) return;
    const name = inp.value.trim();
    if (!name) return toast('Informe um nome para a etiqueta.');
    if (db.labels[name]) return toast('Essa etiqueta já existe.');
    db.labels[name] = color;
    inp.value = '';
    save();
    if (typeof onRender === 'function') onRender();
    renderLabelsModal();
    toast(`Etiqueta "${name}" criada.`);
  });
}

if (typeof window !== 'undefined') {
  window.openLabelsModal = openLabelsModal;
  window.renderLabelsModal = renderLabelsModal;
  window.delLabels = delLabels;
  window.editLabelName = editLabelName;
}

import { st, db, all, save } from '../state.js';
import { esc, norm, up, plain, clean, hs } from '../../utils/text.js';
import { now, mlabel, fd } from '../../utils/date.js';
import { STAGES, STAGE_MAP, QUICK_HISTORY_TAGS } from '../../config/constants.js';
import { normCard } from '../../domain/card.js';
import { colorOpts } from '../../domain/label.js';
import { ls } from './contact-list.js';
import { ask } from './confirm-modal.js';
import { toast } from '../toast.js';

const $ = s => document.querySelector(s);
const S = STAGES;
const SN = STAGE_MAP;
const QK = QUICK_HISTORY_TAGS;
const PENCIL = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';

const si = c => S.findIndex(s => s[0] === c.etapa);
export const log = (c, t) => { c.upd = now(); c.hist.unshift({ d: now(), t }); };

export function mopts(cur) {
  const ks = new Set(['', cur]);
  all().forEach(c => ks.add(c.mes));
  db.meses.forEach(m => ks.add(m));
  const y0 = new Date().getFullYear();
  for (let y = y0; y <= y0 + 2; y++) {
    for (let m = 1; m <= 12; m++) ks.add(y + '-' + String(m).padStart(2, '0'));
  }
  return [...ks].sort((a, b) => !a ? 1 : !b ? -1 : a < b ? -1 : 1).map(k => `<option value="${k}" ${k === cur ? 'selected' : ''}>${mlabel(k)}</option>`).join('');
}

export function getDrawerSnapshot(c) {
  if (!c) return null;
  const obsEl = $('#f-obs');
  return {
    nome: c.nome ? up(c.nome.trim()) : '',
    mes: c.mes || '',
    etapa: c.etapa || 'triagem',
    parto: c.parto || '',
    parto_ok: !!c.parto_ok,
    saque: c.saque || '',
    pend: !!c.pend,
    obs: obsEl ? clean(obsEl.innerHTML) : clean(c.obs || ''),
    labels: [...(c.labels || [])]
  };
}

export function hasDrawerUnsavedChanges() {
  if (!st.open || !st.drawerOriginal) return false;

  const currentNome = $('#f-nome') ? up($('#f-nome').value.trim()) : '';
  const currentMes = $('#f-mes') ? $('#f-mes').value : '';
  const currentEtapa = $('#f-et') ? $('#f-et').value : '';
  const currentParto = $('#f-parto') ? $('#f-parto').value : '';
  const currentPartoOk = !!$('#f-parto-ok')?.checked;
  const currentSaque = $('#f-saque') ? $('#f-saque').value : '';
  const currentPend = !!$('#f-pend')?.checked;
  const currentObs = $('#f-obs') ? clean($('#f-obs').innerHTML) : '';
  const currentLabels = st.drawerDraftLabels ? [...st.drawerDraftLabels] : [];

  const orig = st.drawerOriginal;

  if (st.open === 'new') {
    return !!(currentNome || currentParto || currentSaque || plain(currentObs).trim() || currentPend || currentPartoOk || currentLabels.length);
  }

  if (currentNome !== (orig.nome || '')) return true;
  if (currentMes !== (orig.mes || '')) return true;
  if (currentEtapa !== (orig.etapa || '')) return true;
  if (currentParto !== (orig.parto || '')) return true;
  if (currentPartoOk !== !!orig.parto_ok) return true;
  if (currentSaque !== (orig.saque || '')) return true;
  if (currentPend !== !!orig.pend) return true;
  if (currentObs !== (orig.obs || '')) return true;

  const origLabels = orig.labels || [];
  if (currentLabels.length !== origLabels.length) return true;
  const origSet = new Set(origLabels);
  if (currentLabels.some(l => !origSet.has(l))) return true;

  return false;
}

export function renderDrawerLabels() {
  const wrap = $('#dr-labels-wrap');
  if (!wrap) return;
  const selected = st.drawerDraftLabels || [];
  wrap.innerHTML = Object.keys(db.labels).map(l =>
    `<button class="lab ${selected.includes(l) ? '' : 'off'}" data-a="lab" data-l="${esc(l)}" style="${ls(l)}">${selected.includes(l) ? '✓ ' : ''}${esc(l)}</button>`
  ).join('');
}

export function updateDrawerAdvCard(curEt) {
  const wrap = $('#dr-adv-wrap');
  if (!wrap) return;
  const ix = S.findIndex(s => s[0] === curEt);
  const nextStage = (st.open !== 'new' && ix >= 0 && ix < S.length - 1) ? S[ix + 1] : null;
  wrap.innerHTML = nextStage ? `
    <div class="adv-card" data-a="adv" title="Clique para avançar etapa">
      <span>Avançar etapa para <b>${nextStage[1]}</b></span>
      <span>→</span>
    </div>
  ` : '';
}

export function renderDrawerHistory(c) {
  const ul = $('#dr-hist-list');
  if (!ul) return;
  ul.innerHTML = hs(c).map(({ h, i }) => `
    <li>
      <div class="hist-hdr">
        <time>${fd(h.d, h.o)}</time>
        <div class="hist-actions">
          <button class="icon-btn" data-a="eh" data-i="${i}" title="Editar registro" aria-label="Editar registro">${PENCIL}</button>
          <button class="icon-btn dng" data-a="dh" data-i="${i}" title="Apagar registro" aria-label="Apagar registro">✕</button>
        </div>
      </div>
      <div class="hist-txt">${esc(h.t)}</div>
    </li>
  `).join('');
}

export function readCardForm(fallback = {}) {
  const nameInput = document.getElementById('f-nome');
  const nomeRaw = nameInput ? nameInput.value.trim() : (fallback.nome || '');
  const nome = up(nomeRaw);

  const mesEl = document.getElementById('f-mes');
  const etapaEl = document.getElementById('f-et');
  const partoEl = document.getElementById('f-parto');
  const partoOkEl = document.getElementById('f-parto-ok');
  const pendEl = document.getElementById('f-pend');
  const saqueEl = document.getElementById('f-saque');
  const obsEl = document.getElementById('f-obs');

  const mes = mesEl ? mesEl.value : (fallback.mes || '');
  const etapaVal = etapaEl ? etapaEl.value : fallback.etapa;
  const etapa = SN[etapaVal] ? etapaVal : (fallback.etapa || 'triagem');
  const parto = partoEl ? partoEl.value : (fallback.parto || '');
  const parto_ok = partoOkEl ? partoOkEl.checked : !!fallback.parto_ok;
  const pend = pendEl ? pendEl.checked : !!fallback.pend;
  const saque = saqueEl ? saqueEl.value : (fallback.saque || '');
  const obs = obsEl ? clean(obsEl.innerHTML) : (fallback.obs || '');
  const labels = st.drawerDraftLabels ? [...st.drawerDraftLabels] : [...(fallback.labels || [])];

  return {
    nameInput,
    nomeRaw,
    nome,
    mes,
    etapa,
    parto,
    parto_ok,
    pend,
    saque,
    obs,
    labels
  };
}

export async function saveDrawerCard({ onRender, onQueueEmbedding }) {
  const id = st.open;
  if (!id) return false;

  const isNew = id === 'new';
  const c = isNew ? (st.draft || {}) : db.cards[id];
  if (!c && !isNew) return false;

  const form = readCardForm(c);
  if (!form.nomeRaw) {
    toast('Por favor, informe o nome do contato.');
    if (form.nameInput) form.nameInput.focus();
    return false;
  }

  if (isNew) {
    return await saveNewCard({ onRender, onQueueEmbedding });
  }

  if (form.nome !== c.nome) { c.nome = form.nome; }
  if (form.mes !== c.mes) {
    log(c, `Mês alterado: ${mlabel(c.mes)} → ${mlabel(form.mes)}`);
    c.mes = form.mes;
    if (form.mes && !db.meses.includes(form.mes)) {
      db.meses.push(form.mes);
    }
  }
  if (form.etapa !== c.etapa) {
    log(c, `Etapa: ${SN[c.etapa][1]} → ${SN[form.etapa][1]}`);
    c.etapa = form.etapa;
  }
  if (form.parto !== (c.parto || '')) { c.parto = form.parto; }
  if (form.parto_ok !== !!c.parto_ok) {
    c.parto_ok = form.parto_ok;
    log(c, form.parto_ok ? 'Data do parto confirmada' : 'Confirmação do parto desmarcada');
  }
  if (form.saque !== (c.saque || '')) { c.saque = form.saque; }
  if (form.pend !== !!c.pend) {
    c.pend = form.pend;
    log(c, form.pend ? 'Marcado como pendência' : 'Pendência do contato removida');
  }
  if (form.obs !== (c.obs || '')) {
    c.obs = form.obs;
    c.td = plain(form.obs);
  }
  c.labels = form.labels;

  save();
  if (typeof onRender === 'function') onRender();
  if (typeof onQueueEmbedding === 'function') onQueueEmbedding(c);

  st.drawerOriginal = null;
  st.drawerDraftLabels = null;

  toast(`Contato "${c.nome}" salvo com sucesso!`);
  return true;
}

export async function requestCloseDrawer({ onRender, onQueueEmbedding }) {
  if (!st.open) return;
  if (hasDrawerUnsavedChanges()) {
    const isNew = st.open === 'new';
    const cName = $('#f-nome')?.value.trim() || (isNew ? 'novo contato' : (db.cards[st.open]?.nome || 'contato'));
    const ans = await ask(`Deseja salvar as alterações em "${cName}" antes de sair?`, {
      title: 'Alterações não salvas',
      ok: 'Salvar alterações',
      alt: 'Sair sem salvar',
      cancel: 'Continuar editando',
      altDanger: true
    });
    if (ans === true) {
      const saved = await saveDrawerCard({ onRender, onQueueEmbedding });
      if (saved) drawer(null);
    } else if (ans === 'alt') {
      if (st.open === 'new') st.draft = null;
      st.drawerOriginal = null;
      st.drawerDraftLabels = null;
      drawer(null);
    }
  } else {
    if (st.open === 'new') st.draft = null;
    st.drawerOriginal = null;
    st.drawerDraftLabels = null;
    drawer(null);
  }
}

export function drawer(id) {
  const isNew = id === 'new';
  const c = isNew ? st.draft : (id ? db.cards[id] : null);
  const d = $('#dr'), backdrop = $('#dr-backdrop');
  if (!d || !backdrop) return;
  st.open = c ? id : null;

  clearTimeout(window._drawerOpenTimer);
  if (!c) {
    if (isNew) st.draft = null;
    st.drawerOriginal = null;
    st.drawerDraftLabels = null;
    d.classList.remove('open');
    backdrop.classList.remove('open');
    window._drawerCloseTimer = setTimeout(() => { if (!st.open) d.hidden = true; }, 250);
    if (window._drawerTriggerEl && typeof window._drawerTriggerEl.focus === 'function') {
      try { window._drawerTriggerEl.focus(); } catch (e) { /* foco é opcional */ }
      window._drawerTriggerEl = null;
    }
    return;
  }

  if (!window._drawerTriggerEl && document.activeElement && document.activeElement !== document.body) {
    window._drawerTriggerEl = document.activeElement;
  }

  clearTimeout(window._drawerCloseTimer);
  st.drawerDraftLabels = [...(c.labels || [])];

  d.hidden = false;
  window._drawerOpenTimer = setTimeout(() => {
    if (st.open) {
      d.classList.add('open');
      backdrop.classList.add('open');
      const focusEl = $('#f-nome');
      if (focusEl) focusEl.focus();
    }
  }, 10);

  const ix = si(c);
  const nextStage = (!isNew && ix >= 0 && ix < S.length - 1) ? S[ix + 1] : null;

  d.innerHTML = `
   <div class="dr-header">
     <input id="f-nome" value="${esc(c.nome)}" placeholder="NOME DO CONTATO" aria-label="Nome do contato">
     <button class="dr-close" data-a="close" aria-label="Fechar detalhes" title="Fechar">✕</button>
   </div>

   <div class="dr-body">
     <div id="dr-adv-wrap">
       ${nextStage ? `
         <div class="adv-card" data-a="adv" title="Clique para avançar etapa">
           <span>Avançar etapa para <b>${nextStage[1]}</b></span>
           <span>→</span>
         </div>
       ` : ''}
     </div>

     <div class="dr-card">
       <div class="dr-card-title">Dados do Atendimento</div>
       <div class="dr-grid">
         <label>Mês de Atendimento<select id="f-mes">${mopts(c.mes)}</select></label>
         <label>Etapa Atual<select id="f-et">${S.map(s => `<option value="${s[0]}" ${s[0] === c.etapa ? 'selected' : ''}>${s[1]}</option>`).join('')}</select></label>
         <div>
           <div style="display:flex;flex-direction:row;align-items:center;justify-content:space-between;min-height:22px;margin-bottom:6px;gap:6px">
             <span style="font-size:11.5px;font-weight:600;color:var(--mut);line-height:1.2">Data Prevista do Parto</span>
             <label class="dr-inline-label" style="display:inline-flex !important;flex-direction:row !important;align-items:center !important;gap:5px !important;font-size:11px;font-weight:600;color:${c.parto_ok ? '#16a34a' : 'var(--mut)'};cursor:pointer;margin:0 !important;line-height:1;white-space:nowrap" title="Marcar como parto confirmado">
               <input type="checkbox" id="f-parto-ok" ${c.parto_ok ? 'checked' : ''} style="accent-color:#16a34a;cursor:pointer;width:14px;height:14px;margin:0 !important;flex-shrink:0">
               <span style="user-select:none">${c.parto_ok ? '✓ Confirmado' : 'Confirmar'}</span>
             </label>
           </div>
           <input type="date" id="f-parto" value="${c.parto || ''}" style="width:100%">
         </div>
         <div>
           <div style="display:flex;flex-direction:row;align-items:center;justify-content:space-between;min-height:22px;margin-bottom:6px">
             <span style="font-size:11.5px;font-weight:600;color:var(--mut);line-height:1.2">Data de Pagamento (Saque)</span>
           </div>
           <input type="date" id="f-saque" value="${c.saque || ''}" style="width:100%">
         </div>
       </div>
     </div>

     <div class="dr-card">
       <div class="dr-card-title">
         <span>Etiquetas</span>
         <button class="btn ghost" data-a="lg" style="font-size:12px;padding:2px 6px">Gerenciar</button>
       </div>
       <div class="dr-labels-container" id="dr-labels-wrap">
         ${Object.keys(db.labels).map(l => `<button class="lab ${st.drawerDraftLabels.includes(l) ? '' : 'off'}" data-a="lab" data-l="${esc(l)}" style="${ls(l)}">${st.drawerDraftLabels.includes(l) ? '✓ ' : ''}${esc(l)}</button>`).join('')}
       </div>
       <div class="add-hist-row" style="margin-top:8px">
         <input id="f-nl" placeholder="Nova etiqueta rápida...">
         <select id="f-nc" style="width:auto;padding:7px 8px;border:1px solid var(--ln);border-radius:8px;background:var(--pn)">
           ${colorOpts('')}
         </select>
         <button class="btn" data-a="nl">+ Criar</button>
       </div>
     </div>

     <div class="dr-card ${c.pend ? 'pend' : ''}" id="dr-card-obs">
       <div class="dr-card-title" style="display:flex;align-items:center;justify-content:space-between">
         <span style="display:inline-flex;align-items:center;gap:4px">Anotações do Contato${c.pend ? '<span class="mk pend" role="img" aria-label="Contato com pendência" title="Contato com pendência">●</span>' : ''}</span>
         <label class="dr-inline-label" style="display:inline-flex !important;flex-direction:row !important;align-items:center !important;gap:6px !important;font-size:12px;font-weight:600;color:${c.pend ? '#b45309' : 'var(--mut)'};cursor:pointer;margin:0 !important;white-space:nowrap" title="Marcar este contato como pendente">
           <input type="checkbox" id="f-pend" ${c.pend ? 'checked' : ''} style="accent-color:#f59e0b;cursor:pointer;width:15px;height:15px;margin:0 !important;flex-shrink:0">
           <span style="user-select:none">${c.pend ? '● Pendência marcada' : 'Marcar pendência'}</span>
         </label>
       </div>
       <div class="tb" role="toolbar" aria-label="Formatação de texto">
         ${[['bold', '<b>N</b>'], ['italic', '<i>I</i>'], ['underline', '<u>S</u>'], ['strikeThrough', '<s>T</s>'], ['insertUnorderedList', '• Lista'], ['insertOrderedList', '1. Lista'], ['removeFormat', 'Limpar']].map(o => `<button data-x="${o[0]}" title="${o[0]}">${o[1]}</button>`).join('')}
       </div>
       <div id="f-obs" class="ed" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Anotações do contato" placeholder="Escreva observações aqui...">${clean(c.obs)}</div>
     </div>

     <div class="dr-card">
       <div class="dr-card-title">Histórico de Ocorrências</div>
       <div class="q">
         ${QK.map(q => `<button data-a="q" data-t="${esc(q)}">${esc(q.replace(/: $/, ''))}</button>`).join('')}
       </div>
       <div class="add-hist-row">
         <input id="f-h" placeholder="Registrar nova ocorrência...">
         <button class="btn sm p" data-a="addh">Salvar</button>
       </div>
       <label style="margin-top:8px;display:block;font-size:12px;color:var(--mut);font-weight:600">
         Data do registro (opcional):
         <input type="date" id="f-hd" style="margin-top:3px;padding:6px 9px;border:1px solid var(--ln);border-radius:8px;width:100%">
       </label>
       ${isNew ? `
         <p style="font-size:12px;color:var(--mut);margin:4px 0 0">O histórico será iniciado automaticamente após salvar o novo contato.</p>
       ` : `
         <ul class="hist" id="dr-hist-list">
           ${hs(c).map(({ h, i }) => `
             <li>
               <div class="hist-hdr">
                 <time>${fd(h.d, h.o)}</time>
                 <div class="hist-actions">
                   <button class="icon-btn" data-a="eh" data-i="${i}" title="Editar registro" aria-label="Editar registro">${PENCIL}</button>
                   <button class="icon-btn dng" data-a="dh" data-i="${i}" title="Apagar registro" aria-label="Apagar registro">✕</button>
                 </div>
               </div>
               <div class="hist-txt">${esc(h.t)}</div>
             </li>
           `).join('')}
         </ul>
       `}
     </div>
   </div>

   <div class="dr-footer">
     ${isNew ? `
       <div class="dr-footer-left"></div>
       <div class="dr-footer-right">
         <button type="button" class="btn sm ghost" data-a="close">
           Cancelar
         </button>
         <button type="button" class="btn sm p" data-a="save-card">
           Salvar contato
         </button>
       </div>
     ` : `
       <div class="dr-footer-left">
         <button type="button" class="btn sm" data-a="arq">
           ${c.arq ? 'Restaurar' : 'Arquivar'}
         </button>
         <button type="button" class="btn sm dng" data-a="dc">
           Excluir contato
         </button>
       </div>
       <div class="dr-footer-right">
         <button type="button" class="btn sm p" data-a="save-card">
           Salvar alterações
         </button>
       </div>
     `}
   </div>
  `;
  st.drawerOriginal = getDrawerSnapshot(c);
}

export function newCard() {
  const defaultMes = /^\d/.test(st.mes) ? st.mes : '';
  st.draft = {
    id: 'draft',
    nome: '',
    parto: '',
    rich: 1,
    mes: defaultMes,
    etapa: 'triagem',
    labels: [],
    tl: [],
    obs: '',
    td: '',
    saque: '',
    hist: [],
    arq: false,
    parto_ok: false,
    pend: false
  };
  st.open = 'new';
  drawer('new');
  const inp = document.getElementById('f-nome');
  if (inp) {
    inp.value = '';
    inp.placeholder = 'NOME DO CONTATO';
    inp.focus();
  }
}

export async function saveNewCard({ onRender, onQueueEmbedding }) {
  if (!st.draft) return false;
  const form = readCardForm(st.draft);
  if (!form.nomeRaw) {
    toast('Por favor, informe o nome do contato.');
    if (form.nameInput) form.nameInput.focus();
    return false;
  }
  const nome = form.nome;

  const dup = all().find(c => norm(c.nome) === norm(nome));
  if (dup) {
    const localStr = `${mlabel(dup.mes)} (${SN[dup.etapa]?.[1] || dup.etapa})`;
    const ans = await ask(`Já existe "${dup.nome}" em ${localStr}. Criar mesmo assim?`, {
      title: 'Contato já cadastrado',
      ok: 'Criar mesmo assim',
      alt: 'Abrir existente',
      cancel: 'Cancelar'
    });
    if (ans === 'alt') {
      st.draft = null;
      st.drawerOriginal = null;
      st.drawerDraftLabels = null;
      drawer(dup.id);
      return false;
    }
    if (!ans) {
      return false;
    }
  }

  const id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const newC = normCard({
    id,
    nome,
    mes: form.mes,
    etapa: form.etapa,
    labels: form.labels,
    tl: [...form.labels],
    obs: form.obs,
    rich: 1,
    td: plain(form.obs),
    saque: form.saque,
    parto: form.parto,
    parto_ok: form.parto_ok,
    pend: form.pend,
    hist: [{ d: now(), t: 'Contato criado' }],
    arq: false
  });

  db.cards[id] = newC;
  if (form.mes && !db.meses.includes(form.mes)) {
    db.meses.push(form.mes);
  }

  st.draft = null;
  st.drawerOriginal = null;
  st.drawerDraftLabels = null;
  save();
  if (typeof onRender === 'function') onRender();
  drawer(null);
  if (typeof onQueueEmbedding === 'function') onQueueEmbedding(newC);
  toast(`Contato "${newC.nome}" criado e salvo com sucesso!`);
  return true;
}

export function addl({ onRender }) {
  const c = st.open === 'new' ? st.draft : (st.open ? db.cards[st.open] : null);
  const n = $('#f-nl')?.value.trim();
  if (!c || !n) return;
  const nome = Object.keys(db.labels).find(l => norm(l) === norm(n)) || n;
  if (!db.labels[nome]) {
    db.labels[nome] = $('#f-nc')?.value || 'black';
    save();
  }
  if (!st.drawerDraftLabels) st.drawerDraftLabels = [...(c.labels || [])];
  if (!st.drawerDraftLabels.includes(nome)) st.drawerDraftLabels.push(nome);
  if ($('#f-nl')) $('#f-nl').value = '';
  renderDrawerLabels();
  if (typeof onRender === 'function') onRender();
}

export function addh({ onRender, onQueueEmbedding }) {
  const c = db.cards[st.open], v = $('#f-h')?.value.trim(), dv = $('#f-hd')?.value;
  if (!c || !v) return;
  c.hist.unshift(dv ? { d: new Date(dv + 'T12:00:00').toISOString(), o: 1, t: v } : { d: now(), t: v });
  save();
  if (typeof onRender === 'function') onRender();
  renderDrawerHistory(c);
  if (typeof onQueueEmbedding === 'function') onQueueEmbedding(c);
  if ($('#f-h')) $('#f-h').value = '';
  if ($('#f-hd')) $('#f-hd').value = '';
  toast('Ocorrência adicionada ao histórico.');
}

export async function editHist(c, i, { onRender, onQueueEmbedding }) {
  const item = c.hist[i];
  if (!item) return;
  const newText = await ask(`Editar ocorrência (${fd(item.d, item.o)}):`, { input: true, ph: item.t, ok: 'Salvar' });
  if (newText === null || newText === undefined) return;
  const trimmed = newText.trim();
  if (!trimmed) return toast('O texto não pode ser vazio.');
  item.t = trimmed;
  save();
  if (typeof onRender === 'function') onRender();
  renderDrawerHistory(c);
  if (typeof onQueueEmbedding === 'function') onQueueEmbedding(c);
  toast('Ocorrência atualizada.');
}

export async function delHist(c, i, { onRender, onQueueEmbedding }) {
  if (!await ask('Apagar esta ocorrência do histórico?', { ok: 'Apagar', danger: true })) return;
  c.hist.splice(i, 1);
  save();
  if (typeof onRender === 'function') onRender();
  renderDrawerHistory(c);
  if (typeof onQueueEmbedding === 'function') onQueueEmbedding(c);
  toast('Ocorrência removida.');
}

export async function delCard(c, { onRender, onDeleteVector, onUpdateRag }) {
  if (!await ask(`Excluir definitivamente o contato "${c.nome}"?`, { ok: 'Excluir', danger: true })) return;
  const snap = typeof window.createSnapshot === 'function' ? await window.createSnapshot(`Exclusão de contato: ${c.nome}`) : null;
  delete db.cards[c.id];
  if (!db.del.includes(c.id)) db.del.push(c.id);
  save();
  if (typeof onDeleteVector === 'function') onDeleteVector(c.id);
  drawer(null);
  if (typeof onRender === 'function') onRender();
  if (typeof onUpdateRag === 'function') onUpdateRag();
  toast('Contato excluído.', 'info', 10000, snap ? {
    label: 'Desfazer',
    onClick: () => {
      if (typeof window.setDb === 'function') window.setDb(JSON.parse(JSON.stringify(snap.db)));
      save();
      if (typeof onRender === 'function') onRender();
      if (typeof window.syncEmbeddings === 'function') window.syncEmbeddings();
      toast('Exclusão desfeita!', 'ok');
    }
  } : null);
}

if (typeof window !== 'undefined') {
  window.drawer = drawer;
  window.readCardForm = readCardForm;
}

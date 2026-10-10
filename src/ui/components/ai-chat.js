import { storage, logError } from '../../services/storage.service.js';
import { openVecDB, IDB_STORE_CHAT } from '../../services/indexeddb.service.js';
import { sb } from '../../services/supabase.service.js';
import { st, db, setDb, save, all } from '../state.js';
import { STORAGE_KEYS, STAGES, COLORS } from '../../config/constants.js';
import { GEMINI_MODELS, getChatModel, populateAiModelSelect } from '../../config/gemini.js';
import { esc } from '../../utils/text.js';
import { createSnapshot } from './settings-modal.js';
import { GEMINI_TOOLS, executeLocalTool, applyAiAction } from '../../services/ai-tools.service.js';
import { syncEmbeddings } from '../../services/rag.service.js';
import { toast } from '../toast.js';

const $ = s => document.querySelector(s);
const S = STAGES;
const KEY_GEMINI = STORAGE_KEYS.GEMINI_API_KEY;
const KEY_CHAT_MODEL = STORAGE_KEYS.CHAT_MODEL;
const MAX_TOOL_ROUNDS = 6;

const TOOL_LABEL = {
  criar_contato: ['Criando contato…', 'Contato criado'],
  editar_contato: ['Atualizando dados do contato…', 'Contato atualizado'],
  mover_contatos: ['Movendo contatos de etapa/mês…', 'Contatos movidos'],
  arquivar_contatos: ['Atualizando status de arquivamento…', 'Contatos atualizados'],
  excluir_contatos: ['Excluindo contatos…', 'Contatos excluídos'],
  registrar_historico: ['Registrando ocorrência no histórico…', 'Histórico registrado'],
  criar_mes: ['Criando novo mês de atendimento…', 'Mês criado'],
  criar_etiqueta: ['Criando etiqueta…', 'Etiqueta criada'],
  aplicar_etiquetas: ['Atualizando etiquetas dos contatos…', 'Etiquetas atualizadas'],
  gerar_relatorio_pdf: ['Estruturando relatório em PDF…', 'Relatório gerado'],
  buscar_contatos: ['Pesquisando contatos no sistema…', 'Busca concluída'],
  ler_contato: ['Carregando dados do contato…', 'Dados obtidos'],
  estado_sistema: ['Consultando estado do sistema…', 'Estado obtido'],
  navegar_sistema: ['Ajustando visão do sistema…', 'Tela atualizada']
};

export const conversationHistory = [];
export const chatUiMessages = [];

function isRetryableGeminiError(status, msg) {
  if (status === 429) return true;
  if (status >= 500 && status < 600) return true;
  if (/quota|rate limit|resource has been exhausted|overloaded|temporarily unavailable/i.test(msg)) return true;
  return false;
}

function windowForModel(contents, maxMessages = 24) {
  if (!Array.isArray(contents) || contents.length === 0) return [];
  const isUserText = msg => Boolean(
    msg && msg.role === 'user' && Array.isArray(msg.parts) && msg.parts.some(p => p && typeof p.text === 'string' && p.text.trim().length > 0)
  );

  const findLastUserText = () => {
    for (let i = contents.length - 1; i >= 0; i--) {
      if (isUserText(contents[i])) return [contents[i]];
    }
    return [contents[contents.length - 1]];
  };

  const startIdx = Math.max(0, contents.length - maxMessages);
  let currentStart = startIdx;
  while (currentStart < contents.length && !isUserText(contents[currentStart])) {
    currentStart++;
  }
  if (currentStart >= contents.length) return findLastUserText();
  const result = contents.slice(currentStart);
  return result.length > 0 ? result : findLastUserText();
}

const AI_TAGS = /^(STRONG|EM|UL|LI|BR|H2|H3|H4|CODE|BUTTON)$/;
function safeAiNodes(html) {
  const t = document.createElement('template');
  t.innerHTML = html;
  const sanitize = node => {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        if (!AI_TAGS.test(child.tagName)) {
          const text = document.createTextNode(child.textContent);
          node.replaceChild(text, child);
        } else {
          Array.from(child.attributes).forEach(attr => child.removeAttribute(attr.name));
          sanitize(child);
        }
      }
    }
  };
  sanitize(t.content);
  return t.content;
}

export function renderMarkdown(md) {
  let h = esc(md || '');
  h = h.replace(/^### (.*$)/gim, '<h4>$1</h4>');
  h = h.replace(/^## (.*$)/gim, '<h3>$1</h3>');
  h = h.replace(/^# (.*$)/gim, '<h2>$1</h2>');
  h = h.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\*(.*?)\*/g, '<em>$1</em>');
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  h = h.replace(/^\s*-\s+(.*$)/gim, '<li>$1</li>');
  h = h.replace(/(<li>.*<\/li>)/gims, '<ul>$1</ul>');
  h = h.replace(/<\/ul>\s*<ul>/g, '');
  h = h.replace(/\n\n+/g, '<br><br>');
  h = h.replace(/\n/g, '<br>');
  return safeAiNodes(h);
}

export function appendAiMessage(text, type = 'bot', rich = false) {
  const chat = $('#ai-chat');
  if (!chat) return null;
  const d = document.createElement('div');
  d.className = `ai-msg ${type}`;
  if (rich) d.appendChild(renderMarkdown(text));
  else d.textContent = text;
  chat.appendChild(d);
  chat.scrollTop = chat.scrollHeight;

  if (type === 'user' || type === 'bot') {
    chatUiMessages.push({ text, type, rich, timestamp: new Date().toISOString() });
    if (chatUiMessages.length > 60) chatUiMessages.shift();
  }
  return d;
}

export function showAiPendingConfirm(descricao) {
  hideAiPendingConfirm();
  const chat = document.getElementById('ai-chat');
  if (!chat) return;

  const box = document.createElement('div');
  box.id = 'ai-pending-confirm';
  box.className = 'ai-pending-box';
  box.innerHTML = `
    <div class="ai-pending-header">
      <span class="ai-pending-icon">⚠️</span>
      <strong>Confirmação de Alteração</strong>
    </div>
    <div class="ai-pending-desc">${esc(descricao)}</div>
    <div class="ai-pending-warn">Deseja realmente aplicar esta alteração ao sistema?</div>
    <div class="ai-pending-actions">
      <button type="button" class="btn sm p" id="btn-ai-confirm-apply">✓ Confirmar e Aplicar</button>
      <button type="button" class="btn sm ghost" id="btn-ai-cancel-action">Cancelar</button>
    </div>
  `;

  chat.appendChild(box);
  chat.scrollTop = chat.scrollHeight;

  document.getElementById('btn-ai-confirm-apply')?.addEventListener('click', confirmPendingAiAction);
  document.getElementById('btn-ai-cancel-action')?.addEventListener('click', cancelPendingAiAction);
}

export function hideAiPendingConfirm() {
  const box = document.getElementById('ai-pending-confirm');
  if (box) box.remove();
}

export async function confirmPendingAiAction({ onRender } = {}) {
  if (!window._pendingAiAction) return;
  const action = window._pendingAiAction;
  window._pendingAiAction = null;
  hideAiPendingConfirm();
  const snap = await createSnapshot('Antes de ação da IA: ' + action.preview);
  const res = applyAiAction(action.ferramenta, action.args, { onRender });
  if (res.sucesso) {
    appendAiMessage(`✓ **Confirmado e aplicado:** ${action.preview}`, 'bot', true);
    conversationHistory.push(
      { role: 'user', parts: [{ text: `[Sistema] O usuário confirmou pelo botão e a alteração foi aplicada: ${action.preview}` }] },
      { role: 'model', parts: [{ text: 'Entendido.' }] }
    );
    saveChatStorage();
    toast('Alteração aplicada com sucesso!', 'ok', 30000, snap ? {
      label: 'Desfazer',
      onClick: async () => {
        setDb(JSON.parse(JSON.stringify(snap.db)));
        save();
        if (typeof onRender === 'function') onRender();
        syncEmbeddings();
        toast('Alteração desfeita com sucesso!', 'ok');
      }
    } : null);
  } else {
    appendAiMessage(`❌ Erro ao aplicar alteração: ${res.erro || 'Falha na execução'}`, 'bot');
  }
}

export function cancelPendingAiAction() {
  window._pendingAiAction = null;
  hideAiPendingConfirm();
  appendAiMessage('Operação cancelada. Nenhuma alteração foi realizada no sistema.', 'bot');
  conversationHistory.push(
    { role: 'user', parts: [{ text: '[Sistema] O usuário cancelou a alteração pendente; nada foi alterado.' }] },
    { role: 'model', parts: [{ text: 'Entendido.' }] }
  );
  saveChatStorage();
}

export async function saveChatStorage() {
  const payload = {
    id: 'active_session',
    updatedAt: new Date().toISOString(),
    conversation: conversationHistory,
    messages: chatUiMessages.slice(-50)
  };
  if (sb) {
    try {
      await sb.from('chat_messages').upsert([{ id: 'active_session', role: 'session', parts: payload }]);
    } catch (e) { logError('sb_saveChatStorage', e); }
  }
  try {
    const idb = await openVecDB();
    await new Promise((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE_CHAT, 'readwrite');
      tx.objectStore(IDB_STORE_CHAT).put(payload);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('Falha ao salvar chat no IndexedDB:', e);
  }
}

export async function restoreChat() {
  const chatEl = $('#ai-chat');
  if (!chatEl) return;
  chatEl.textContent = '';
  chatUiMessages.length = 0;

  let sessionData = null;
  if (sb) {
    try {
      const { data, error } = await sb.from('chat_messages').select('parts').eq('id', 'active_session').limit(1);
      if (!error && Array.isArray(data) && data.length > 0 && data[0]?.parts) {
        sessionData = data[0].parts;
      }
    } catch (e) { logError('sb_restoreChat', e); }
  }
  if (!sessionData) {
    try {
      const idb = await openVecDB();
      sessionData = await new Promise((resolve, reject) => {
        const tx = idb.transaction(IDB_STORE_CHAT, 'readonly');
        const req = tx.objectStore(IDB_STORE_CHAT).get('active_session');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {}
  }

  if (sessionData) {
    if (Array.isArray(sessionData.conversation)) {
      conversationHistory.push(...sessionData.conversation);
    }
    if (Array.isArray(sessionData.messages) && sessionData.messages.length > 0) {
      sessionData.messages.forEach(m => {
        appendAiMessage(m.text, m.type, m.rich);
      });
      return;
    }
  }

  appendAiMessage("Olá! Sou o assistente operacional do **Meu cantinho**.\n\nPosso consultar prazos, buscar atendimentos por nome ou assunto, gerar relatórios em PDF e aplicar alterações com sua confirmação.", 'bot', true);
}

export async function resetChat() {
  const chatEl = $('#ai-chat');
  if (chatEl) chatEl.textContent = '';
  conversationHistory.length = 0;
  chatUiMessages.length = 0;
  window._pendingAiAction = null;
  hideAiPendingConfirm();

  if (sb) {
    try { await sb.from('chat_messages').delete().eq('id', 'active_session'); } catch (e) {}
  }
  try {
    const idb = await openVecDB();
    const tx = idb.transaction(IDB_STORE_CHAT, 'readwrite');
    tx.objectStore(IDB_STORE_CHAT).delete('active_session');
  } catch (e) {}

  appendAiMessage("Conversa reiniciada. Como posso ajudar com a gestão dos atendimentos agora?", 'bot', true);
  toast('Histórico do chat limpo com sucesso.');
}

export function stopAiChat() {
  if (window._activeAiAbortController) {
    window._activeAiAbortController.abort(new Error("cancelado pelo usuário"));
    toast('Geração interrompida pelo usuário.', 'warn');
    const stopBtn = $('#ai-stop-btn');
    const sendBtn = $('#ai-send-btn');
    if (stopBtn) stopBtn.hidden = true;
    if (sendBtn) sendBtn.hidden = false;
    const typingDiv = $('#ai-typing-indicator');
    if (typingDiv) typingDiv.remove();
    return true;
  }
  return false;
}

export async function fetchGeminiWithRetry({ apiKey, primaryModel, contents, tools, systemInstruction, onNotice, signal }) {
  const fallbackList = Array.isArray(GEMINI_MODELS?.fallback) ? GEMINI_MODELS.fallback : ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite'];
  const modelsToTry = [primaryModel];
  for (const f of fallbackList) {
    if (!modelsToTry.includes(f)) modelsToTry.push(f);
  }

  let lastError = null;
  for (let mIdx = 0; mIdx < modelsToTry.length; mIdx++) {
    const currentModel = modelsToTry[mIdx];
    const isPrimary = (mIdx === 0);
    const maxAttempts = isPrimary ? 3 : 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (signal?.aborted) {
        const aMsg = signal.reason?.message || signal.reason || 'cancelado';
        const aErr = new Error(aMsg);
        aErr.name = 'AbortError';
        throw aErr;
      }
      const callController = new AbortController();
      const onParentAbort = () => callController.abort(signal?.reason || new Error('cancelado'));
      if (signal) signal.addEventListener('abort', onParentAbort, { once: true });
      const callTimer = setTimeout(() => callController.abort(new Error('demorou demais')), 30000);

      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent`;
        const body = { contents, systemInstruction };
        if (tools && tools.length) body.tools = tools;

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify(body),
          signal: callController.signal
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          const msg = errData.error?.message || `Erro ${res.status} no modelo ${currentModel}`;
          const err = new Error(msg);
          err.status = res.status;
          err.model = currentModel;
          err.isRetryable = isRetryableGeminiError(res.status, msg);
          throw err;
        }

        const data = await res.json();
        return { data, modelUsed: currentModel, isFallback: !isPrimary };
      } catch (err) {
        lastError = err;
        if (signal?.aborted) throw err;
        if (callController.signal.aborted) {
          const timeoutErr = new Error('demorou demais');
          timeoutErr.name = 'AbortError';
          timeoutErr.status = 408;
          timeoutErr.isRetryable = (attempt < maxAttempts || mIdx < modelsToTry.length - 1);
          lastError = timeoutErr;
        }
        if (!lastError.isRetryable) throw lastError;

        if (attempt < maxAttempts) {
          const delay = Math.min(6500, 1200 * Math.pow(1.6, attempt - 1) + Math.random() * 400);
          if (onNotice) onNotice(`⏳ Alta demanda no modelo ${currentModel}. Tentando novamente em ${(delay / 1000).toFixed(1)}s (tentativa ${attempt}/${maxAttempts})…`);
          await new Promise(r => setTimeout(r, delay));
        } else if (mIdx < modelsToTry.length - 1) {
          const nextModel = modelsToTry[mIdx + 1];
          if (onNotice) onNotice(`⚠️ O modelo ${currentModel} segue sobrecarregado. Alternando automaticamente para ${nextModel} sem perder o contexto…`);
          await new Promise(r => setTimeout(r, 800));
        }
      } finally {
        clearTimeout(callTimer);
        if (signal) signal.removeEventListener('abort', onParentAbort);
      }
    }
  }
  throw lastError || new Error("Não foi possível obter resposta após tentativas e fallbacks.");
}

export async function chatWithGemini(userPrompt, { onRender } = {}) {
  const apiKey = storage.getItem(KEY_GEMINI);
  if (!apiKey) throw new Error("Chave de API não configurada. Abra Configurações e informe a chave.");
  const primaryModel = getChatModel();
  const turn = [{ role: "user", parts: [{ text: userPrompt }] }];
  const hoje = new Date();
  const system = {
    parts: [{
      text: `Você é o Assistente Operacional do sistema "Meu cantinho", um CRM de gestão de atendimentos do INSS. Hoje é ${hoje.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}.
Etapas: ${S.map(s => s[0] + ' = ' + s[1]).join('; ')}.
Etiquetas: ${COLORS.map(c => c[0]).join(', ')}.
Regra de segurança: Qualquer alteração de dados (criar, editar, mover, arquivar, excluir, histórico) REQUER CONFIRMAÇÃO PRÉVIA DO USUÁRIO pelo card exibido no chat. Chame a ferramenta de escrita UMA ÚNICA VEZ e instrua o usuário a confirmar no botão exibido.`
    }]
  };

  const messageController = new AbortController();
  window._activeAiAbortController = messageController;
  const totalTimeoutId = setTimeout(() => messageController.abort(new Error("demorou demais")), 90000);

  const stopBtn = document.getElementById('ai-stop-btn');
  const sendBtn = document.getElementById('ai-send-btn');
  if (stopBtn) stopBtn.hidden = false;
  if (sendBtn) sendBtn.disabled = true;

  let activeNoticeEl = null;
  const updateNotice = msg => {
    if (!activeNoticeEl) activeNoticeEl = appendAiMessage(msg, 'notice');
    else { activeNoticeEl.textContent = msg; const chat = $('#ai-chat'); if (chat) chat.scrollTop = chat.scrollHeight; }
  };
  const clearNotice = () => { if (activeNoticeEl) { activeNoticeEl.remove(); activeNoticeEl = null; } };

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      if (messageController.signal.aborted) throw messageController.signal.reason || new Error("cancelado");
      const contentsPayload = windowForModel([...conversationHistory, ...turn]);

      const { data, modelUsed, isFallback } = await fetchGeminiWithRetry({
        apiKey,
        primaryModel,
        contents: contentsPayload,
        tools: GEMINI_TOOLS,
        systemInstruction: system,
        onNotice: updateNotice,
        signal: messageController.signal
      });
      clearNotice();

      const candidate = data.candidates?.[0]?.content;
      if (!candidate?.parts?.length) throw new Error("O modelo não retornou resposta.");
      const calls = candidate.parts.filter(p => p.functionCall);

      if (!calls.length) {
        turn.push(candidate);
        conversationHistory.push(...turn);
        saveChatStorage();
        let finalText = candidate.parts.map(p => p.text || '').join('\n').trim();
        if (isFallback) finalText += `\n\n*(Respondido automaticamente via **${modelUsed}** devido à alta demanda temporária no modelo principal)*`;
        return finalText;
      }

      if (round === MAX_TOOL_ROUNDS) {
        turn.push({ role: "model", parts: [{ text: "Parei após o limite de ações desta mensagem." }] });
        conversationHistory.push(...turn);
        saveChatStorage();
        return "Parei após o limite de ações desta mensagem. Peça de novo se faltou algo.";
      }

      turn.push(candidate);
      const responses = [];
      for (const { functionCall: { name, args } } of calls) {
        if (messageController.signal.aborted) throw messageController.signal.reason || new Error("cancelado");
        const lbl = TOOL_LABEL[name] || ['Executando ação…', 'Ação concluída'];
        const line = appendAiMessage(lbl[0], 'tool');
        let result;
        try {
          result = await executeLocalTool(name, args || {}, apiKey, {
            onShowConfirm: showAiPendingConfirm,
            onRender
          });
        } catch (e) {
          result = { erro: String(e.message || e) };
        }
        line.textContent = result.erro ? `Não foi possível concluir: ${lbl[1].toLowerCase()}` : lbl[1];
        responses.push({ functionResponse: { name, response: result } });
      }
      turn.push({ role: "user", parts: responses });
    }
  } finally {
    clearTimeout(totalTimeoutId);
    clearNotice();
    if (window._activeAiAbortController === messageController) window._activeAiAbortController = null;
    if (stopBtn) stopBtn.hidden = true;
    if (sendBtn) sendBtn.disabled = false;
  }
}

export function initAiChat({ onRender } = {}) {
  populateAiModelSelect();
  restoreChat();

  $('#ai-fab')?.addEventListener('click', () => {
    const win = $('#ai-window');
    if (win) {
      win.hidden = !win.hidden;
      if (!win.hidden) $('#ai-prompt')?.focus();
    }
  });

  $('#ai-model-select')?.addEventListener('change', e => {
    const newModel = e.target.value.trim();
    if (newModel) {
      storage.setItem(KEY_CHAT_MODEL, newModel);
      toast(`Modelo alterado para ${newModel}. Histórico e contexto preservados.`);
    }
  });

  $('#ai-prompt')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if ($('#ai-form')?.requestSubmit) $('#ai-form').requestSubmit();
      else $('#ai-form')?.dispatchEvent(new Event('submit'));
    }
  });

  $('#ai-stop-btn')?.addEventListener('click', stopAiChat);

  $('#ai-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const inp = $('#ai-prompt');
    const txt = inp?.value.trim();
    if (!txt) return;

    if (inp) inp.value = '';
    appendAiMessage(txt, 'user');

    const typingDiv = document.createElement('div');
    typingDiv.id = 'ai-typing-indicator';
    typingDiv.className = 'ai-msg bot typing';
    typingDiv.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
    $('#ai-chat')?.appendChild(typingDiv);
    const chat = $('#ai-chat');
    if (chat) chat.scrollTop = chat.scrollHeight;

    try {
      const resp = await chatWithGemini(txt, { onRender });
      typingDiv.remove();
      if (resp) appendAiMessage(resp, 'bot', true);
    } catch (err) {
      typingDiv.remove();
      appendAiMessage(`❌ ${err.message || 'Erro na comunicação com a IA.'}`, 'bot');
    }
  });
}

if (typeof window !== 'undefined') {
  window.initAiChat = initAiChat;
  window.confirmPendingAiAction = confirmPendingAiAction;
  window.cancelPendingAiAction = cancelPendingAiAction;
}

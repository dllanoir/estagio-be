import { db, all, save } from '../ui/state.js';
import { norm, up, plain, toHtml } from '../utils/text.js';
import { now, mlabel, okm, okd, fx } from '../utils/date.js';
import { STAGES, STAGE_MAP } from '../config/constants.js';
import { safeLabelColor } from '../domain/label.js';
import { normCard } from '../domain/card.js';
import { searchContacts, deleteVector, queueCardEmbedding, updateRagConfigStatus } from './rag.service.js';
import { registrarRelatorio, appendAiReportCard } from '../ui/components/reports-modal.js';
import { backupAgeDays, monthNotes } from '../ui/components/alerts.js';

const S = STAGES;
const SN = STAGE_MAP;

export function contactPayload(c, detalhado = false) {
  if (!c) return null;
  const p = {
    id: c.id,
    nome: c.nome,
    mes: c.mes,
    etapa: c.etapa,
    etapa_nome: SN[c.etapa] ? SN[c.etapa][1] : c.etapa,
    labels: [...(c.labels || [])],
    parto: c.parto || '',
    parto_ok: !!c.parto_ok,
    pend: !!c.pend,
    saque: c.saque || '',
    arq: !!c.arq
  };
  if (detalhado) {
    p.obs = { conteudo_nao_confiavel: plain(c.obs || '') };
    p.historico = (c.hist || []).map(h => ({ data: h.d, texto: { conteudo_nao_confiavel: String(h.t ?? '') } }));
  }
  return p;
}

export function resolveContact(args) {
  if (!args) return null;
  if (args.id && db.cards[args.id]) return db.cards[args.id];
  if (args.nome) {
    const q = norm(String(args.nome).trim());
    const exact = all().find(c => norm(c.nome) === q);
    if (exact) return exact;
    return all().find(c => norm(c.nome).includes(q));
  }
  return null;
}

export function formatContactsList(contacts) {
  if (!contacts || !contacts.length) return '';
  const names = contacts.map(c => c.nome || 'Sem nome');
  if (names.length <= 10) return names.join(', ');
  return names.slice(0, 10).join(', ') + ` e mais ${names.length - 10}`;
}

export function formatMoveDescription(contacts, targetEtapa, targetMes) {
  const parts = [];
  if (targetEtapa && SN[targetEtapa]) {
    const fromStages = new Set(contacts.map(c => c.etapa));
    if (fromStages.size === 1) {
      const from = [...fromStages][0];
      const fromName = SN[from] ? SN[from][1] : from;
      parts.push(`de ${fromName} para ${SN[targetEtapa][1]}`);
    } else {
      parts.push(`para ${SN[targetEtapa][1]}`);
    }
  }
  if (targetMes !== undefined) {
    parts.push(`para o mês ${mlabel(targetMes)}`);
  }
  return parts.join(' e ');
}

export function calculateAiToolEffect(name, args) {
  if (!args || typeof args !== 'object') return { erro: 'Parâmetros inválidos.' };

  if (name === 'criar_contato') {
    if (!args.nome || typeof args.nome !== 'string' || !args.nome.trim()) {
      return { erro: 'O campo "nome" é obrigatório e deve ser um texto não vazio.' };
    }
    if (args.mes !== undefined && args.mes !== null && args.mes !== '') {
      if (typeof args.mes !== 'string' || !okm(args.mes)) return { erro: 'Mês inválido. Formato esperado: AAAA-MM.' };
    }
    if (args.etapa !== undefined && args.etapa !== null) {
      if (!SN[args.etapa]) return { erro: `Etapa inválida '${args.etapa}'. Etapas permitidas: ${S.map(s => s[0]).join(', ')}.` };
    }
    if (args.parto) {
      if (typeof args.parto !== 'string' || !okd(args.parto)) return { erro: 'Data de parto inválida. Formato esperado: AAAA-MM-DD.' };
    }
    if (args.saque) {
      if (typeof args.saque !== 'string' || !okd(args.saque)) return { erro: 'Data de pagamento/saque inválida. Formato esperado: AAAA-MM-DD.' };
    }
    if (args.etiquetas !== undefined && !Array.isArray(args.etiquetas)) {
      return { erro: 'O campo "etiquetas" deve ser uma lista de nomes de etiquetas.' };
    }
    const nome = up(args.nome.trim());
    const etapaCode = (args.etapa && SN[args.etapa]) ? args.etapa : 'triagem';
    const etapaNome = SN[etapaCode][1];
    const mesNome = mlabel(args.mes || '');
    return { preview: `1 contato será criado: ${nome} (${etapaNome}, ${mesNome})` };
  }

  if (name === 'editar_contato') {
    if (!args.id || typeof args.id !== 'string') return { erro: 'ID do contato não informado.' };
    const c = db.cards[args.id];
    if (!c) return { erro: `Contato com ID '${args.id}' não encontrado.` };
    const campos = args.campos;
    if (!campos || typeof campos !== 'object' || Array.isArray(campos) || !Object.keys(campos).length) {
      return { erro: 'Nenhum campo fornecido para edição.' };
    }
    if (campos.nome !== undefined) {
      if (typeof campos.nome !== 'string' || !campos.nome.trim()) return { erro: 'O campo "nome" não pode ser vazio.' };
    }
    if (campos.mes !== undefined && campos.mes !== '') {
      if (typeof campos.mes !== 'string' || !okm(campos.mes)) return { erro: 'Mês inválido. Formato esperado: AAAA-MM.' };
    }
    if (campos.etapa !== undefined && !SN[campos.etapa]) {
      return { erro: `Etapa inválida '${campos.etapa}'. Etapas permitidas: ${S.map(s => s[0]).join(', ')}.` };
    }
    if (campos.parto) {
      if (typeof campos.parto !== 'string' || !okd(campos.parto)) return { erro: 'Data de parto inválida. Formato esperado: AAAA-MM-DD.' };
    }
    if (campos.saque) {
      if (typeof campos.saque !== 'string' || !okd(campos.saque)) return { erro: 'Data de pagamento/saque inválida. Formato esperado: AAAA-MM-DD.' };
    }
    if (campos.etiquetas !== undefined && !Array.isArray(campos.etiquetas)) {
      return { erro: 'O campo "etiquetas" deve ser uma lista.' };
    }
    const diffs = [];
    if (campos.nome && up(campos.nome.trim()) !== c.nome) diffs.push(`nome alterado para ${up(campos.nome.trim())}`);
    if (campos.mes !== undefined && campos.mes !== c.mes) diffs.push(`mês alterado para ${mlabel(campos.mes)}`);
    if (campos.etapa && campos.etapa !== c.etapa) diffs.push(`etapa alterada de ${SN[c.etapa][1]} para ${SN[campos.etapa][1]}`);
    if (campos.parto !== undefined && campos.parto !== (c.parto || '')) diffs.push(`parto alterado para ${fx(campos.parto) || 'vazio'}`);
    if (campos.parto_ok !== undefined && !!campos.parto_ok !== !!c.parto_ok) diffs.push(campos.parto_ok ? 'parto confirmado' : 'confirmação do parto removida');
    if (campos.saque !== undefined && campos.saque !== (c.saque || '')) diffs.push(`saque alterado para ${fx(campos.saque) || 'vazio'}`);
    if (campos.pend !== undefined && !!campos.pend !== !!c.pend) diffs.push(campos.pend ? 'marcado como pendente' : 'pendência removida');
    if (campos.etiquetas) diffs.push(`etiquetas atualizadas para [${campos.etiquetas.join(', ')}]`);
    if (!diffs.length) return { erro: 'Nenhuma alteração real detectada nos campos informados.' };
    return { preview: `1 contato será alterado: ${c.nome} (${diffs.join('; ')})` };
  }

  if (name === 'mover_contatos') {
    if (!Array.isArray(args.ids) || !args.ids.length) return { erro: 'Lista de IDs não fornecida.' };
    if (args.ids.length > 50) return { erro: 'Limite de 50 contatos por chamada excedido. Reduza a quantidade de contatos.' };
    if (!args.etapa && args.mes === undefined) return { erro: 'Informe "etapa" ou "mes" de destino para mover os contatos.' };
    if (args.etapa && !SN[args.etapa]) return { erro: `Etapa inválida '${args.etapa}'. Etapas permitidas: ${S.map(s => s[0]).join(', ')}.` };
    if (args.mes !== undefined && args.mes !== '' && (!okm(args.mes) || typeof args.mes !== 'string')) {
      return { erro: 'Mês inválido. Formato esperado: AAAA-MM.' };
    }
    const existing = args.ids.map(id => db.cards[id]).filter(Boolean);
    if (!existing.length) return { erro: 'Nenhum dos contatos informados foi encontrado no sistema.' };
    const moveDesc = formatMoveDescription(existing, args.etapa, args.mes);
    return { preview: `${existing.length} contato${existing.length === 1 ? '' : 's'} ${existing.length === 1 ? 'será movido' : 'serão movidos'} ${moveDesc}: ${formatContactsList(existing)}` };
  }

  if (name === 'arquivar_contatos') {
    if (!Array.isArray(args.ids) || !args.ids.length) return { erro: 'Lista de IDs não fornecida.' };
    if (typeof args.arquivar !== 'boolean') return { erro: 'Parâmetro "arquivar" deve ser verdadeiro ou falso (boolean).' };
    const existing = args.ids.map(id => db.cards[id]).filter(Boolean);
    if (!existing.length) return { erro: 'Nenhum dos contatos informados foi encontrado no sistema.' };
    const verb = args.arquivar ? 'arquivado' : 'desarquivado';
    const verbPlural = args.arquivar ? 'arquivados' : 'desarquivados';
    return { preview: `${existing.length} contato${existing.length === 1 ? '' : 's'} ${existing.length === 1 ? 'será ' + verb : 'serão ' + verbPlural}: ${formatContactsList(existing)}` };
  }

  if (name === 'excluir_contatos') {
    if (!Array.isArray(args.ids) || !args.ids.length) return { erro: 'Lista de IDs não fornecida.' };
    const existing = args.ids.map(id => db.cards[id]).filter(Boolean);
    if (!existing.length) return { erro: 'Nenhum dos contatos informados foi encontrado para exclusão.' };
    return { preview: `${existing.length} contato${existing.length === 1 ? '' : 's'} ${existing.length === 1 ? 'será excluído' : 'serão excluídos'}: ${formatContactsList(existing)}` };
  }

  if (name === 'registrar_historico') {
    if (!args.id || typeof args.id !== 'string') return { erro: 'ID do contato não fornecido.' };
    const c = db.cards[args.id];
    if (!c) return { erro: `Contato com ID '${args.id}' não encontrado.` };
    if (!args.texto || typeof args.texto !== 'string' || !args.texto.trim()) {
      return { erro: 'O texto da ocorrência é obrigatório e não pode ser vazio.' };
    }
    if (args.data) {
      const parsedDate = Date.parse(args.data);
      if (isNaN(parsedDate)) return { erro: 'Data inválida informada para o histórico.' };
    }
    const truncText = args.texto.trim().slice(0, 60) + (args.texto.trim().length > 60 ? '…' : '');
    return { preview: `1 ocorrência será registrada no histórico de ${c.nome}: "${truncText}"` };
  }

  if (name === 'criar_mes') {
    if (!args.mes || typeof args.mes !== 'string' || !okm(args.mes)) {
      return { erro: 'Mês inválido. Formato esperado: AAAA-MM.' };
    }
    if (db.meses.includes(args.mes)) return { erro: `O mês ${mlabel(args.mes)} já está cadastrado no sistema.` };
    return { preview: `Novo mês de atendimento será criado: ${mlabel(args.mes)}` };
  }

  if (name === 'criar_etiqueta') {
    if (!args.nome || typeof args.nome !== 'string' || !args.nome.trim()) {
      return { erro: 'O nome da etiqueta é obrigatório.' };
    }
    const nome = args.nome.trim();
    if (db.labels[nome]) return { erro: `A etiqueta "${nome}" já existe no sistema.` };
    const cor = safeLabelColor(args.cor);
    return { preview: `Nova etiqueta será criada: "${nome}" (cor: ${cor})` };
  }

  if (name === 'aplicar_etiquetas') {
    if (!Array.isArray(args.ids) || !args.ids.length) return { erro: 'Lista de IDs não fornecida.' };
    if (!Array.isArray(args.etiquetas) || !args.etiquetas.length) return { erro: 'Lista de etiquetas não fornecida.' };
    const existing = args.ids.map(id => db.cards[id]).filter(Boolean);
    if (!existing.length) return { erro: 'Nenhum dos contatos informados foi encontrado.' };
    const labelsList = args.etiquetas.join(', ');
    const acao = args.remover ? 'removida(s)' : 'aplicada(s)';
    return { preview: `Etiqueta(s) [${labelsList}] ${acao} em ${existing.length} contato${existing.length === 1 ? '' : 's'}: ${formatContactsList(existing)}` };
  }

  return { erro: `Ferramenta desconhecida: ${name}` };
}

export function applyAiAction(ferramenta, args, { onRender } = {}) {
  const dStr = new Date().toLocaleDateString('pt-BR');
  try {
    if (ferramenta === 'criar_contato') {
      const id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const nome = up(args.nome.trim());
      const mes = (args.mes && okm(args.mes)) ? args.mes : '';
      const etapa = (args.etapa && SN[args.etapa]) ? args.etapa : 'triagem';
      const labels = Array.isArray(args.etiquetas) ? [...args.etiquetas] : [];
      const obs = args.anotacao ? toHtml(args.anotacao) : '';
      const nc = normCard({
        id,
        nome,
        mes,
        etapa,
        labels,
        tl: [...labels],
        obs,
        rich: 1,
        td: args.anotacao || '',
        saque: args.saque || '',
        parto: args.parto || '',
        parto_ok: false,
        pend: false,
        hist: [{ d: now(), t: `Alterado pela IA em ${dStr}: Contato criado` }],
        arq: false
      });
      db.cards[id] = nc;
      if (mes && !db.meses.includes(mes)) db.meses.push(mes);
      labels.forEach(l => {
        if (!db.labels[l] && !db.gone.includes(l)) db.labels[l] = 'black';
      });
      save();
      if (typeof onRender === 'function') onRender();
      queueCardEmbedding(nc);
      return { sucesso: true };
    }

    if (ferramenta === 'editar_contato') {
      const c = db.cards[args.id];
      if (!c) return { erro: 'Contato não encontrado.' };
      const campos = args.campos;
      const mudancas = [];
      if (campos.nome) {
        c.nome = up(campos.nome.trim());
        mudancas.push(`nome para ${c.nome}`);
      }
      if (campos.mes !== undefined) {
        mudancas.push(`mês para ${mlabel(campos.mes)}`);
        c.mes = campos.mes || '';
        if (c.mes && !db.meses.includes(c.mes)) db.meses.push(c.mes);
      }
      if (campos.etapa && SN[campos.etapa]) {
        mudancas.push(`etapa para ${SN[campos.etapa][1]}`);
        c.etapa = campos.etapa;
      }
      if (campos.parto !== undefined) {
        c.parto = campos.parto || '';
        mudancas.push(`parto para ${fx(c.parto) || 'vazio'}`);
      }
      if (campos.parto_ok !== undefined) {
        c.parto_ok = !!campos.parto_ok;
        mudancas.push(c.parto_ok ? 'parto confirmado' : 'confirmação de parto desmarcada');
      }
      if (campos.saque !== undefined) {
        c.saque = campos.saque || '';
        mudancas.push(`saque para ${fx(c.saque) || 'vazio'}`);
      }
      if (campos.pend !== undefined) {
        c.pend = !!campos.pend;
        mudancas.push(c.pend ? 'pendência marcada' : 'pendência removida');
      }
      if (Array.isArray(campos.etiquetas)) {
        c.labels = [...campos.etiquetas];
        c.labels.forEach(l => {
          if (!db.labels[l] && !db.gone.includes(l)) db.labels[l] = 'black';
        });
        mudancas.push(`etiquetas para [${c.labels.join(', ')}]`);
      }
      c.upd = now();
      c.hist.unshift({ d: now(), t: `Alterado pela IA em ${dStr}: ${mudancas.join(', ')}` });
      save();
      if (typeof onRender === 'function') onRender();
      queueCardEmbedding(c);
      return { sucesso: true };
    }

    if (ferramenta === 'mover_contatos') {
      const existing = args.ids.map(id => db.cards[id]).filter(Boolean);
      existing.forEach(c => {
        const m = [];
        if (args.etapa && SN[args.etapa]) {
          m.push(`etapa de ${SN[c.etapa][1]} para ${SN[args.etapa][1]}`);
          c.etapa = args.etapa;
        }
        if (args.mes !== undefined) {
          m.push(`mês de ${mlabel(c.mes)} para ${mlabel(args.mes)}`);
          c.mes = args.mes || '';
          if (c.mes && !db.meses.includes(c.mes)) db.meses.push(c.mes);
        }
        c.upd = now();
        c.hist.unshift({ d: now(), t: `Alterado pela IA em ${dStr}: ${m.join(', ')}` });
        queueCardEmbedding(c);
      });
      save();
      if (typeof onRender === 'function') onRender();
      return { sucesso: true };
    }

    if (ferramenta === 'arquivar_contatos') {
      const existing = args.ids.map(id => db.cards[id]).filter(Boolean);
      existing.forEach(c => {
        c.arq = !!args.arquivar;
        c.upd = now();
        c.hist.unshift({ d: now(), t: `Alterado pela IA em ${dStr}: ${c.arq ? 'Contato arquivado' : 'Contato desarquivado'}` });
        queueCardEmbedding(c);
      });
      save();
      if (typeof onRender === 'function') onRender();
      return { sucesso: true };
    }

    if (ferramenta === 'excluir_contatos') {
      const existing = args.ids.map(id => db.cards[id]).filter(Boolean);
      existing.forEach(c => {
        delete db.cards[c.id];
        if (!db.del.includes(c.id)) db.del.push(c.id);
        deleteVector(c.id);
      });
      save();
      if (typeof onRender === 'function') onRender();
      updateRagConfigStatus();
      return { sucesso: true };
    }

    if (ferramenta === 'registrar_historico') {
      const c = db.cards[args.id];
      if (!c) return { erro: 'Contato não encontrado.' };
      const d = args.data ? (args.data.includes('T') ? args.data : new Date(args.data + 'T12:00:00').toISOString()) : now();
      c.hist.unshift({ d, t: args.texto.trim() });
      c.upd = now();
      c.hist.unshift({ d: now(), t: `Alterado pela IA em ${dStr}: Registro adicionado ao histórico` });
      save();
      if (typeof onRender === 'function') onRender();
      queueCardEmbedding(c);
      return { sucesso: true };
    }

    if (ferramenta === 'criar_mes') {
      if (!db.meses.includes(args.mes)) db.meses.push(args.mes);
      save();
      if (typeof onRender === 'function') onRender();
      return { sucesso: true };
    }

    if (ferramenta === 'criar_etiqueta') {
      const nome = args.nome.trim();
      db.labels[nome] = safeLabelColor(args.cor);
      db.gone = db.gone.filter(l => l !== nome);
      save();
      if (typeof onRender === 'function') onRender();
      return { sucesso: true };
    }

    if (ferramenta === 'aplicar_etiquetas') {
      const existing = args.ids.map(id => db.cards[id]).filter(Boolean);
      const isRemover = !!args.remover;
      existing.forEach(c => {
        if (isRemover) {
          c.labels = c.labels.filter(l => !args.etiquetas.includes(l));
          c.upd = now();
          c.hist.unshift({ d: now(), t: `Alterado pela IA em ${dStr}: Etiquetas removidas: ${args.etiquetas.join(', ')}` });
        } else {
          args.etiquetas.forEach(l => {
            if (!db.labels[l] && !db.gone.includes(l)) db.labels[l] = 'black';
          });
          c.labels = [...new Set([...c.labels, ...args.etiquetas])];
          c.upd = now();
          c.hist.unshift({ d: now(), t: `Alterado pela IA em ${dStr}: Etiquetas adicionadas: ${args.etiquetas.join(', ')}` });
        }
        queueCardEmbedding(c);
      });
      save();
      if (typeof onRender === 'function') onRender();
      return { sucesso: true };
    }

    return { erro: `Ferramenta '${ferramenta}' não reconhecida.` };
  } catch (err) {
    return { erro: String(err.message || err) };
  }
}

export const GEMINI_TOOLS = [
  {
    functionDeclarations: [
      {
        name: "criar_contato",
        description: "Cria um novo contato no sistema. REQUER CONFIRMAÇÃO DO USUÁRIO pelo card exibido no chat.",
        parameters: {
          type: "OBJECT",
          properties: {
            nome: { type: "STRING", description: "Nome completo do contato (obrigatório)" },
            mes: { type: "STRING", description: "Mês no formato AAAA-MM ou vazio para sem data" },
            etapa: { type: "STRING", description: "Código da etapa: triagem, docs, guia, entrada, inss, deferido, fim, indef" },
            parto: { type: "STRING", description: "Data prevista do parto no formato AAAA-MM-DD" },
            saque: { type: "STRING", description: "Data prevista de pagamento/saque no formato AAAA-MM-DD" },
            etiquetas: { type: "ARRAY", items: { type: "STRING" }, description: "Lista de nomes de etiquetas a aplicar" },
            anotacao: { type: "STRING", description: "Texto inicial de anotação do contato" }
          },
          required: ["nome"]
        }
      },
      {
        name: "editar_contato",
        description: "Edita campos de um contato existente. REQUER CONFIRMAÇÃO DO USUÁRIO pelo card exibido no chat.",
        parameters: {
          type: "OBJECT",
          properties: {
            id: { type: "STRING", description: "ID único do contato (obrigatório)" },
            campos: {
              type: "OBJECT",
              description: "Campos a alterar",
              properties: {
                nome: { type: "STRING" },
                mes: { type: "STRING" },
                etapa: { type: "STRING" },
                parto: { type: "STRING" },
                parto_ok: { type: "BOOLEAN" },
                saque: { type: "STRING" },
                pend: { type: "BOOLEAN" },
                etiquetas: { type: "ARRAY", items: { type: "STRING" } }
              }
            }
          },
          required: ["id", "campos"]
        }
      },
      {
        name: "mover_contatos",
        description: "Move múltiplos contatos para uma nova etapa e/ou mês. REQUER CONFIRMAÇÃO DO USUÁRIO.",
        parameters: {
          type: "OBJECT",
          properties: {
            ids: { type: "ARRAY", items: { type: "STRING" }, description: "Lista de IDs dos contatos a mover" },
            etapa: { type: "STRING", description: "Nova etapa (opcional)" },
            mes: { type: "STRING", description: "Novo mês AAAA-MM (opcional)" }
          },
          required: ["ids"]
        }
      },
      {
        name: "arquivar_contatos",
        description: "Arquiva ou desarquiva múltiplos contatos. REQUER CONFIRMAÇÃO DO USUÁRIO.",
        parameters: {
          type: "OBJECT",
          properties: {
            ids: { type: "ARRAY", items: { type: "STRING" } },
            arquivar: { type: "BOOLEAN", description: "true para arquivar, false para desarquivar" }
          },
          required: ["ids", "arquivar"]
        }
      },
      {
        name: "excluir_contatos",
        description: "Exclui definitivamente contatos do sistema. REQUER CONFIRMAÇÃO DO USUÁRIO.",
        parameters: {
          type: "OBJECT",
          properties: {
            ids: { type: "ARRAY", items: { type: "STRING" } }
          },
          required: ["ids"]
        }
      },
      {
        name: "registrar_historico",
        description: "Adiciona uma nova ocorrência ao histórico de um contato. REQUER CONFIRMAÇÃO DO USUÁRIO.",
        parameters: {
          type: "OBJECT",
          properties: {
            id: { type: "STRING", description: "ID do contato" },
            texto: { type: "STRING", description: "Texto da ocorrência" },
            data: { type: "STRING", description: "Data da ocorrência AAAA-MM-DD (opcional, padrão hoje)" }
          },
          required: ["id", "texto"]
        }
      },
      {
        name: "buscar_contatos",
        description: "Busca contatos por texto, significado ou filtros estruturados.",
        parameters: {
          type: "OBJECT",
          properties: {
            consulta: { type: "STRING", description: "Termo de busca ou dúvida conceitual" },
            etapa: { type: "STRING" },
            mes: { type: "STRING" },
            etiqueta: { type: "STRING" },
            arquivado: { type: "BOOLEAN" },
            pendentes: { type: "BOOLEAN" },
            parto_de: { type: "STRING" },
            parto_ate: { type: "STRING" },
            saque_de: { type: "STRING" },
            saque_ate: { type: "STRING" },
            limite: { type: "INTEGER" }
          }
        }
      },
      {
        name: "ler_contato",
        description: "Lê a ficha detalhada de um contato específico pelo ID ou nome completo.",
        parameters: {
          type: "OBJECT",
          properties: {
            id: { type: "STRING" },
            nome: { type: "STRING" }
          }
        }
      },
      {
        name: "gerar_relatorio_pdf",
        description: "Estrutura e gera um relatório profissional em PDF para visualização e download.",
        parameters: {
          type: "OBJECT",
          properties: {
            titulo: { type: "STRING", description: "Título do relatório" },
            subtitulo: { type: "STRING" },
            resumo_executivo: { type: "STRING" },
            nome_arquivo: { type: "STRING" },
            kpis: { type: "ARRAY", items: { type: "OBJECT" } },
            colunas: { type: "ARRAY", items: { type: "OBJECT" } },
            linhas: { type: "ARRAY", items: { type: "OBJECT" } }
          },
          required: ["titulo", "colunas", "linhas"]
        }
      },
      {
        name: "estado_sistema",
        description: "Retorna estatísticas gerais e visão panorâmica de todo o sistema.",
        parameters: { type: "OBJECT", properties: {} }
      },
      {
        name: "navegar_sistema",
        description: "Ajusta a tela do sistema (muda o mês ativo, filtra etapa ou preenche a barra de busca).",
        parameters: {
          type: "OBJECT",
          properties: {
            mes: { type: "STRING" },
            etapa: { type: "STRING" },
            termo_busca: { type: "STRING" }
          }
        }
      }
    ]
  }
];

export async function executeLocalTool(name, args, apiKey, { onShowConfirm, onRender } = {}) {
  const WRITE_TOOLS = new Set([
    'criar_contato',
    'editar_contato',
    'mover_contatos',
    'arquivar_contatos',
    'excluir_contatos',
    'registrar_historico',
    'criar_mes',
    'criar_etiqueta',
    'aplicar_etiquetas'
  ]);

  if (WRITE_TOOLS.has(name)) {
    const check = calculateAiToolEffect(name, args);
    if (check.erro) return { erro: check.erro };
    const preview = check.preview;
    window._pendingAiAction = {
      id: Date.now().toString(),
      ferramenta: name,
      args: args,
      preview: preview
    };
    if (typeof onShowConfirm === 'function') onShowConfirm(preview);
    return {
      bloqueado_requer_confirmacao: true,
      preview: preview,
      aviso: "REGRA DE SEGURANÇA: Toda e qualquer alteração de dados requer confirmação prévia do usuário. A alteração NÃO foi executada: o app exibiu ao usuário um card com o botão 'Confirmar e Aplicar'. Explique o que será alterado e peça que ele toque nesse botão."
    };
  }

  if (name === 'gerar_relatorio_pdf') {
    const rep = registrarRelatorio(args);
    appendAiReportCard(rep);
    return {
      status: 'sucesso',
      relatorio_id: rep.id,
      titulo: rep.config.titulo,
      total_registros: Array.isArray(rep.config.linhas) ? Math.min(rep.config.linhas.length, 500) : 0,
      arquivo: rep.config.nome_arquivo,
      mensagem: 'Relatório em PDF estruturado com sucesso! O card interativo com o botão para baixar o PDF e visualizar já foi exibido no chat para o usuário.'
    };
  }

  if (name === 'estado_sistema') {
    const cs = all();
    return {
      total_contatos: cs.length,
      ativos: cs.filter(c => !c.arq && c.etapa !== 'fim').length,
      arquivados: cs.filter(c => c.arq).length,
      etapas: S.map(s => ({ codigo: s[0], nome: s[1], contatos: cs.filter(c => c.etapa === s[0] && !c.arq).length })),
      meses: db.meses,
      mes_atual: st.mes,
      filtro_etapa: st.et,
      etiquetas: Object.keys(db.labels),
      pendencias_mes: monthNotes().map(([m, nt]) => ({
        mes: m,
        pendente: nt.v,
        texto: { conteudo_nao_confiavel: String(nt.n || '') }
      })),
      backup_dias: backupAgeDays()
    };
  }

  if (name === 'buscar_contatos') {
    return await searchContacts(args, apiKey);
  }

  if (name === 'ler_contato') {
    const c = resolveContact(args);
    if (!c) return { erro: 'Contato não encontrado' };
    return { contato: contactPayload(c, true) };
  }

  if (name === 'navegar_sistema') {
    if (args.mes !== undefined) {
      if (args.mes === '*' || db.meses.includes(args.mes) || !args.mes) {
        st.mes = args.mes || '';
      }
    }
    if (args.etapa && (SN[args.etapa] || ['ativos', 'todos', 'arq', 'pendentes'].includes(args.etapa))) {
      st.et = args.etapa;
    }
    if (args.termo_busca !== undefined) {
      st.q = String(args.termo_busca);
      const qInput = document.getElementById('q');
      if (qInput) qInput.value = st.q;
    }
    if (typeof onRender === 'function') onRender();
    return { status: 'sucesso', visao_atual: { mes: st.mes, etapa: st.et, busca: st.q } };
  }

  return { erro: 'Ferramenta desconhecida: ' + name };
}

if (typeof window !== 'undefined') {
  window.GEMINI_TOOLS = GEMINI_TOOLS;
  window.executeLocalTool = executeLocalTool;
  window.calculateAiToolEffect = calculateAiToolEffect;
  window.applyAiAction = applyAiAction;
  window.formatContactsList = formatContactsList;
}

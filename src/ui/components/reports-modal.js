import { storage, logError } from '../../services/storage.service.js';
import { STORAGE_KEYS } from '../../config/constants.js';
import { esc, norm } from '../../utils/text.js';
import { toast } from '../toast.js';

const $ = s => document.querySelector(s);
const KEY_REPORTS = STORAGE_KEYS.REPORTS;

export function loadStoredReports() {
  try {
    const raw = storage.getItem(KEY_REPORTS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        window._reports = { ...parsed, ...(window._reports || {}) };
      }
    }
  } catch (e) {
    logError('loadStoredReports', e);
  }
  if (!window._reports) window._reports = {};
}

export function saveReportsStorage() {
  try {
    const repMap = window._reports || {};
    const keys = Object.keys(repMap);
    if (keys.length > 15) {
      keys.slice(0, keys.length - 15).forEach(k => delete repMap[k]);
    }
    storage.setItem(KEY_REPORTS, JSON.stringify(repMap));
  } catch (e) {
    console.warn('Não foi possível salvar relatórios no storage:', e);
  }
}

let _html2pdfPromise = null;
export function loadHtml2Pdf() {
  if (window.html2pdf) return Promise.resolve(window.html2pdf);
  if (_html2pdfPromise) return _html2pdfPromise;
  _html2pdfPromise = new Promise(resolve => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
    script.onload = () => resolve(window.html2pdf || null);
    script.onerror = () => {
      console.warn('html2pdf não pôde ser carregado via CDN. Modo de impressão nativo ativo.');
      resolve(null);
    };
    document.head.appendChild(script);
  });
  return _html2pdfPromise;
}

export function buildReportHtml(cfg) {
  if (!cfg || typeof cfg !== 'object') cfg = {};
  const agora = new Date().toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' });
  const rawCols = Array.isArray(cfg.colunas) ? cfg.colunas : [];
  const cols = rawCols.slice(0, 12).map(c => {
    if (!c || typeof c !== 'object') return { chave: '', rotulo: '', alinhamento: 'left' };
    const align = ['left', 'center', 'right'].includes(c.alinhamento) ? c.alinhamento : 'left';
    return {
      chave: String(c.chave ?? ''),
      rotulo: String(c.rotulo ?? ''),
      alinhamento: align
    };
  });
  const rawRows = Array.isArray(cfg.linhas) ? cfg.linhas : [];
  const rows = rawRows.slice(0, 500);
  const orientation = cols.length > 5 ? 'landscape' : 'portrait';

  const validDestaques = ['padrao', 'sucesso', 'alerta', 'perigo'];
  const rawKpis = Array.isArray(cfg.kpis) ? cfg.kpis : [];
  const kpisHtml = rawKpis.length ? `
    <div class="rep-kpis">
      ${rawKpis.map(k => {
        if (!k || typeof k !== 'object') return '';
        const destaque = validDestaques.includes(k.destaque) ? k.destaque : 'padrao';
        const cardClass = (destaque !== 'padrao') ? ` ${destaque}` : '';
        return `
          <div class="rep-kpi-card${cardClass}">
            <div class="rep-kpi-val">${esc(k.valor)}</div>
            <div class="rep-kpi-lbl">${esc(k.rotulo)}</div>
          </div>
        `;
      }).join('')}
    </div>
  ` : '';

  const resumoHtml = cfg.resumo_executivo ? `
    <div class="rep-summary">
      <div class="rep-summary-title">Resumo Executivo</div>
      <p class="rep-summary-text">${esc(cfg.resumo_executivo)}</p>
    </div>
  ` : '';

  const tableHtml = rows.length ? `
    <table class="rep-table">
      <thead>
        <tr>
          ${cols.map(c => `<th style="text-align:${c.alinhamento}">${esc(c.rotulo)}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            ${cols.map(c => `<td style="text-align:${c.alinhamento}">${esc(r[c.chave] ?? '—')}</td>`).join('')}
          </tr>
        `).join('')}
      </tbody>
    </table>
  ` : '<div class="rep-empty">Nenhum registro a exibir nesta tabela.</div>';

  const notasHtml = cfg.notas_finais ? `<div class="rep-notes">${esc(cfg.notas_finais)}</div>` : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${esc(cfg.titulo || 'Relatório Gerencial')}</title>
<style>
  @page { size: A4 ${orientation}; margin: 12mm 12mm 14mm 12mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 11px; line-height: 1.45; color: #1e293b; background: #ffffff; margin: 0; padding: 24px; }
  .rep-header { display: flex; align-items: flex-start; justify-content: space-between; border-bottom: 2px solid #0f5c6e; padding-bottom: 12px; margin-bottom: 16px; gap: 16px; }
  .rep-title { margin: 0 0 4px; font-size: 20px; font-weight: 800; color: #0f5c6e; letter-spacing: -0.02em; }
  .rep-sub { margin: 0; font-size: 12px; color: #64748b; }
  .rep-meta { text-align: right; font-size: 10px; color: #64748b; }
  .rep-kpis { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; }
  .rep-kpi-card { flex: 1 1 120px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 14px; min-width: 110px; }
  .rep-kpi-card.sucesso { background: #f0fdf4; border-color: #86efac; }
  .rep-kpi-card.alerta { background: #fffbeb; border-color: #fde68a; }
  .rep-kpi-card.perigo { background: #fef2f2; border-color: #fca5a5; }
  .rep-kpi-val { font-size: 18px; font-weight: 800; color: #0f172a; line-height: 1.1; margin-bottom: 2px; }
  .rep-kpi-card.sucesso .rep-kpi-val { color: #15803d; }
  .rep-kpi-card.alerta .rep-kpi-val { color: #b45309; }
  .rep-kpi-card.perigo .rep-kpi-val { color: #b91c1c; }
  .rep-kpi-lbl { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; font-weight: 600; }
  .rep-summary { background: #f1f5f9; border-left: 3px solid #0f5c6e; padding: 10px 14px; border-radius: 4px; margin-bottom: 16px; font-size: 11px; }
  .rep-summary-title { font-weight: 700; font-size: 11px; color: #0f5c6e; margin-bottom: 4px; }
  .rep-summary-text { margin: 0; color: #334155; }
  .rep-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 10.5px; page-break-inside: auto; }
  .rep-table tr { page-break-inside: avoid; page-break-after: auto; }
  .rep-table th { background: #f1f5f9; color: #334155; font-weight: 700; text-transform: uppercase; font-size: 9px; letter-spacing: 0.04em; padding: 7px 10px; border-bottom: 2px solid #cbd5e1; border-top: 1px solid #e2e8f0; }
  .rep-table td { padding: 6px 10px; border-bottom: 1px solid #e2e8f0; color: #1e293b; vertical-align: top; }
  .rep-table tbody tr:nth-child(even) { background: #fafafa; }
  .rep-empty { padding: 20px; text-align: center; color: #94a3b8; font-style: italic; }
  .rep-notes { font-size: 9.5px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 8px; margin-top: 16px; font-style: italic; }
  .rep-footer { margin-top: 24px; padding-top: 8px; border-top: 1px dashed #cbd5e1; display: flex; justify-content: space-between; font-size: 9px; color: #94a3b8; }
</style>
</head>
<body>
<div class="rep-header">
  <div>
    <h1 class="rep-title">${esc(cfg.titulo || 'Relatório Gerencial')}</h1>
    <p class="rep-sub">${esc(cfg.subtitulo || 'Meu Cantinho Gestão & INSS')}</p>
  </div>
  <div class="rep-meta">
    <div><b>Gerado em:</b> ${agora}</div>
    <div><b>Sistema:</b> Meu cantinho Gestão & INSS</div>
  </div>
</div>
${kpisHtml}
${resumoHtml}
${tableHtml}
${notasHtml}
<div class="rep-footer">
  <span>Documento gerado automaticamente pelo assistente de gestão.</span>
  <span>Página 1 de 1</span>
</div>
</body>
</html>`;
}

export function registrarRelatorio(cfg) {
  loadStoredReports();
  const id = 'rep_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const rep = {
    id,
    config: cfg,
    criadoEm: new Date().toISOString()
  };
  window._reports[id] = rep;
  saveReportsStorage();
  return rep;
}

export function appendAiReportCard(rep) {
  const chat = $('#ai-chat');
  if (!chat) return null;
  const d = document.createElement('div');
  d.className = 'ai-msg report';
  d.dataset.reportId = rep.id;

  const validDestaques = ['padrao', 'sucesso', 'alerta', 'perigo'];
  const kpisHtml = Array.isArray(rep.config.kpis) && rep.config.kpis.length ? `
    <div class="ai-report-kpis">
      ${rep.config.kpis.slice(0, 4).map(k => {
        const destaque = validDestaques.includes(k.destaque) ? k.destaque : 'padrao';
        const cardClass = (destaque !== 'padrao') ? ` ${destaque}` : '';
        return `
          <div class="ai-report-kpi${cardClass}">
            <b>${esc(k.valor)}</b>
            <span>${esc(k.rotulo)}</span>
          </div>
        `;
      }).join('')}
    </div>
  ` : '';

  const rowsCount = Array.isArray(rep.config.linhas) ? rep.config.linhas.length : 0;
  const fileName = rep.config.nome_arquivo || 'relatorio.pdf';

  d.innerHTML = `
    <div class="ai-report-card">
      <div class="ai-report-head">
        <div>
          <span class="ai-report-badge">📄 Relatório em PDF</span>
          <h4 class="ai-report-title">${esc(rep.config.titulo)}</h4>
          <p class="ai-report-sub">${esc(rep.config.subtitulo || (rowsCount + ' registro(s) organizados'))}</p>
        </div>
      </div>
      ${kpisHtml}
      ${rep.config.resumo_executivo ? `<div class="ai-report-summary-box">${esc(rep.config.resumo_executivo)}</div>` : ''}
      <div class="ai-report-actions">
        <button type="button" class="ai-report-btn primary" data-a="dl-report" data-report-id="${esc(rep.id)}">
          📥 Baixar PDF (${esc(fileName)})
        </button>
        <button type="button" class="ai-report-btn secondary" data-a="view-report" data-report-id="${esc(rep.id)}">
          🖨️ Visualizar / Imprimir
        </button>
      </div>
    </div>
  `;

  chat.appendChild(d);
  chat.scrollTop = chat.scrollHeight;
  return d;
}

export async function baixarRelatorioPdf(reportId) {
  loadStoredReports();
  const rep = (window._reports || {})[reportId];
  if (!rep) {
    toast('Relatório não encontrado ou expirado.');
    return;
  }
  toast('Preparando PDF para download…');

  const filename = rep.config.nome_arquivo || `${norm(rep.config.titulo || 'relatorio').replace(/[^a-z0-9_-]+/g, '_')}.pdf`;
  const html = buildReportHtml(rep.config);

  try {
    const h2p = await loadHtml2Pdf();
    if (h2p) {
      const container = document.createElement('div');
      container.style.position = 'fixed';
      container.style.left = '-9999px';
      container.style.top = '0';
      container.style.width = (rep.config.colunas && rep.config.colunas.length > 5) ? '297mm' : '210mm';
      container.style.background = '#ffffff';
      container.innerHTML = html;
      document.body.appendChild(container);

      const opt = {
        margin: [10, 10, 10, 10],
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, letterRendering: true, logging: false },
        jsPDF: { unit: 'mm', format: 'a4', orientation: (rep.config.colunas && rep.config.colunas.length > 5) ? 'landscape' : 'portrait' }
      };

      await h2p().set(opt).from(container).save();
      container.remove();
      toast('PDF baixado com sucesso!');
      return;
    }
  } catch (err) {
    console.warn('Erro ao gerar com html2pdf, acionando fallback de impressão:', err);
  }

  visualizarRelatorioPdf(reportId, true);
}

export function visualizarRelatorioPdf(reportId, autoPrint = false) {
  loadStoredReports();
  const rep = (window._reports || {})[reportId];
  if (!rep) {
    toast('Relatório não encontrado.');
    return;
  }
  const html = buildReportHtml(rep.config);
  const win = window.open('', '_blank');
  if (!win) {
    toast('O navegador bloqueou a janela pop-up. Permita pop-ups para visualizar o relatório.');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  if (autoPrint) {
    setTimeout(() => {
      try { win.focus(); win.print(); } catch (e) { logError('imprimir', e); }
    }, 500);
  }
}

if (typeof window !== 'undefined') {
  window.buildReportHtml = buildReportHtml;
  window.registrarRelatorio = registrarRelatorio;
  window.appendAiReportCard = appendAiReportCard;
  window.baixarRelatorioPdf = baixarRelatorioPdf;
  window.visualizarRelatorioPdf = visualizarRelatorioPdf;
  window.loadStoredReports = loadStoredReports;
}

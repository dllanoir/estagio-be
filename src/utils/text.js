export const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const norm = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export const up = s => String(s ?? '').toLocaleUpperCase('pt-BR');

export const toHtml = t => esc(t).replace(/\r?\n/g, '<br>');

export const plain = h => String(h || '').replace(/<[^>]+>/g, ' ');

export const txt = h => {
  const t = document.createElement('template');
  t.innerHTML = String(h || '').replace(/<li>/gi, '• ').replace(/<\/(li|p|div)>|<br\s*\/?>/gi, '\n');
  return t.content.textContent.trim();
};

export function clean(h) {
  const t = document.createElement('template');
  t.innerHTML = h;
  const ok = /^(B|STRONG|I|EM|U|S|STRIKE|UL|OL|LI|BR|DIV|P)$/;
  (function w(n) {
    [...n.childNodes].forEach(k => {
      if (k.nodeType === 1) {
        w(k);
        if (!ok.test(k.tagName)) k.replaceWith(...k.childNodes);
        else [...k.attributes].forEach(a => k.removeAttribute(a.name));
      } else if (k.nodeType !== 3) {
        k.remove();
      }
    });
  })(t.content);
  return t.innerHTML;
}

export const hs = c => (Array.isArray(c?.hist) ? c.hist : []).map((h, i) => ({ h, i })).sort((a, b) => (b.h.d ? Date.parse(b.h.d) : -1) - (a.h.d ? Date.parse(a.h.d) : -1) || a.i - b.i);

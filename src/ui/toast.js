export function toast(m, type = 'info', duration = 5000, action = null) {
  const c = document.querySelector('#tt');
  if (!c) return;
  const it = document.createElement('div');
  it.className = 'toast-item' + (type === 'warn' ? ' warn' : type === 'danger' ? ' danger' : type === 'ok' ? ' ok' : '');
  const sp = document.createElement('div');
  sp.className = 'toast-item-txt';
  sp.textContent = m;
  it.appendChild(sp);

  if (action && action.label && typeof action.onClick === 'function') {
    const actBtn = document.createElement('button');
    actBtn.type = 'button';
    actBtn.className = 'btn sm';
    actBtn.style.cssText = 'margin-left:8px;padding:2px 8px;font-size:11.5px;font-weight:700;flex:none;background:var(--pn);color:var(--ink);border:1px solid var(--ln);cursor:pointer;';
    actBtn.textContent = action.label;
    actBtn.onclick = (e) => {
      e.stopPropagation();
      action.onClick();
      it.remove();
    };
    it.appendChild(actBtn);
  }

  const cl = document.createElement('button');
  cl.type = 'button';
  cl.className = 'toast-close';
  cl.innerHTML = '&times;';
  cl.setAttribute('aria-label', 'Fechar notificação');
  cl.onclick = () => it.remove();
  it.appendChild(cl);

  c.appendChild(it);
  if (duration > 0) {
    setTimeout(() => {
      if (it.parentElement) it.remove();
    }, duration);
  }
}

if (typeof window !== 'undefined') window.toast = toast;

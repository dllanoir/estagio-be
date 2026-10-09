let _errCount = 0;

export function logError(context, err) {
  _errCount++;
  console.error(`[${context}]`, err);
  const el = document.getElementById('cfg-diag-err-count');
  if (el) el.textContent = String(_errCount);
}

export const storage = (() => {
  const memory = new Map();
  let native = null;
  let isMemoryFallback = false;
  try {
    const probe = '__cantinho_storage_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    native = localStorage;
  } catch (e) {
    isMemoryFallback = true;
  }
  return {
    get isVolatile() {
      return isMemoryFallback || !native;
    },
    get persistent() {
      return !this.isVolatile;
    },
    getItem: k => {
      try {
        return (native && !isMemoryFallback) ? native.getItem(k) : (memory.get(k) ?? null);
      } catch (e) {
        return memory.get(k) ?? null;
      }
    },
    setItem: (k, v) => {
      try {
        if (native && !isMemoryFallback) {
          native.setItem(k, v);
        } else {
          memory.set(k, String(v));
        }
      } catch (e) {
        isMemoryFallback = true;
        memory.set(k, String(v));
        checkVolatileStorage();
        throw e;
      }
    },
    removeItem: k => {
      try {
        if (native && !isMemoryFallback) native.removeItem(k);
        else memory.delete(k);
      } catch (e) {
        memory.delete(k);
      }
    }
  };
})();

export function checkVolatileStorage() {
  let banner = document.getElementById('volatile-storage-banner');
  if (storage.isVolatile) {
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'volatile-storage-banner';
      banner.setAttribute('role', 'alert');
      banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999999;background:#b91c1c;color:#fff;padding:10px 16px;display:flex;align-items:center;justify-content:space-between;font-weight:600;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
      banner.innerHTML = `<span>Seus dados NÃO estão sendo salvos neste navegador. Baixe um backup agora.</span><button type="button" class="btn sm" id="btn-volatile-backup" style="background:#fff;color:#b91c1c;border:none;font-weight:bold;cursor:pointer;padding:4px 10px;border-radius:4px;">Baixar backup</button>`;
      document.body.prepend(banner);
      banner.querySelector('#btn-volatile-backup')?.addEventListener('click', () => {
        if (typeof window.exportBackup === 'function') window.exportBackup();
      });
    }
  } else if (banner) {
    banner.remove();
  }
}

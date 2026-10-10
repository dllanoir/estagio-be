import { SUPABASE_CONFIG } from './config/supabase.js';

(function() {
  try {
    const raw = localStorage.getItem(SUPABASE_CONFIG.authStorageKey);
    const curPage = encodeURIComponent(window.location.pathname.split('/').pop() || 'app.html');
    if (!raw) {
      window.location.replace('./index.html?redirect=' + curPage);
      return;
    }
    const sess = JSON.parse(raw);
    const token = sess?.access_token || sess?.currentSession?.access_token;
    if (!token) {
      window.location.replace('./index.html?redirect=' + curPage);
      return;
    }
    const exp = sess?.expires_at || sess?.currentSession?.expires_at;
    if (exp && exp < (Date.now() / 1000) - 30) {
      if (!sess?.refresh_token && !sess?.currentSession?.refresh_token) {
        window.location.replace('./index.html?redirect=' + curPage);
      }
    }
    const removeGuard = () => {
      const g = document.getElementById('auth-guard-css');
      if (g) g.remove();
      if (document.body) {
        document.body.style.visibility = 'visible';
        document.body.style.opacity = '1';
        document.body.style.pointerEvents = 'auto';
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', removeGuard);
    } else {
      removeGuard();
    }
    setTimeout(removeGuard, 1500);
  } catch (e) {
    window.location.replace('./index.html');
  }
})();

import { SUPABASE_CONFIG } from './config/supabase.js';

(function() {
  try {
    const raw = localStorage.getItem(SUPABASE_CONFIG.authStorageKey);
    const curPage = encodeURIComponent(window.location.pathname.split('/').pop() || 'index.html');
    if (!raw) {
      window.location.replace('login.html?redirect=' + curPage);
      return;
    }
    const sess = JSON.parse(raw);
    const token = sess?.access_token || sess?.currentSession?.access_token;
    if (!token) {
      window.location.replace('login.html?redirect=' + curPage);
      return;
    }
    const exp = sess?.expires_at || sess?.currentSession?.expires_at;
    if (exp && exp < (Date.now() / 1000) - 30) {
      if (!sess?.refresh_token && !sess?.currentSession?.refresh_token) {
        window.location.replace('login.html?redirect=' + curPage);
        return;
      }
    }
  } catch (e) {
    window.location.replace('login.html');
  }
})();

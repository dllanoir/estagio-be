import { sb, getAuthToken } from './supabase.service.js';
import { STORAGE_KEYS } from '../config/constants.js';
import { SUPABASE_CONFIG } from '../config/supabase.js';

let CURRENT_USER = null;

export function getCurrentUser() {
  return CURRENT_USER;
}

export function updateUserSessionUI(user) {
  if (!user) return;
  const emailEl = document.getElementById('user-email-text');
  const avatarEl = document.getElementById('user-avatar');
  if (emailEl) {
    emailEl.textContent = user.email || 'Usuário';
    emailEl.title = user.email || '';
  }
  if (avatarEl && user.email) {
    avatarEl.textContent = user.email.charAt(0).toUpperCase();
  }
}

export async function checkAuthSession() {
  try {
    if (sb && sb.auth && typeof sb.auth.getSession === 'function') {
      const { data: { session }, error } = await sb.auth.getSession();
      if (error || !session) {
        console.warn('Sessão inexistente ou expirada. Redirecionando...');
        const curPage = encodeURIComponent(window.location.pathname.split('/').pop() || 'app.html');
        window.location.replace('./index.html?redirect=' + curPage);
        return null;
      }
      CURRENT_USER = session.user;
      updateUserSessionUI(session.user);

      const guard = document.getElementById('auth-guard-css');
      if (guard) guard.remove();
      document.body.style.visibility = 'visible';
      document.body.style.opacity = '1';
      document.body.style.pointerEvents = 'auto';
      return session;
    } else {
      const token = getAuthToken();
      if (!token) {
        const curPage = encodeURIComponent(window.location.pathname.split('/').pop() || 'app.html');
        window.location.replace('./index.html?redirect=' + curPage);
        return null;
      }
      const guard = document.getElementById('auth-guard-css');
      if (guard) guard.remove();
      document.body.style.visibility = 'visible';
      document.body.style.opacity = '1';
      document.body.style.pointerEvents = 'auto';
      return { access_token: token };
    }
  } catch (err) {
    console.error('Erro na validação de sessão:', err);
    const curPage = encodeURIComponent(window.location.pathname.split('/').pop() || 'app.html');
    window.location.replace('./index.html?redirect=' + curPage);
    return null;
  }
}

export async function doLogout() {
  if (!confirm('Deseja realmente sair da sua conta e encerrar a sessão?')) return;
  try {
    if (sb && sb.auth && typeof sb.auth.signOut === 'function') {
      await sb.auth.signOut();
    }
  } catch (e) {
    console.warn('Erro ao deslogar no Supabase:', e);
  } finally {
    localStorage.removeItem(SUPABASE_CONFIG.authStorageKey);
    localStorage.removeItem(STORAGE_KEYS.DB);
    const curPage = encodeURIComponent(window.location.pathname.split('/').pop() || 'app.html');
    window.location.replace('./index.html?redirect=' + curPage);
  }
}

export function setupAuthListener() {
  if (sb && sb.auth && typeof sb.auth.onAuthStateChange === 'function') {
    sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || (!session && event !== 'INITIAL_SESSION')) {
        localStorage.removeItem(SUPABASE_CONFIG.authStorageKey);
        localStorage.removeItem(STORAGE_KEYS.DB);
        window.location.replace('./index.html');
      } else if (session?.user) {
        CURRENT_USER = session.user;
        updateUserSessionUI(session.user);
      }
    });
  }
}

if (typeof window !== 'undefined') window.doLogout = doLogout;

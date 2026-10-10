import { createClient } from '@supabase/supabase-js';
import { SUPABASE_CONFIG } from './config/supabase.js';

let targetApp = new URLSearchParams(window.location.search).get('redirect') || './app.html';
if (targetApp === 'index.html' || targetApp === 'login.html') {
  targetApp = './app.html';
}

const sb = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

function showAlert(msg, isSuccess = false) {
  const el = document.getElementById('auth-msg');
  if (!el) return;
  el.className = 'auth-alert ' + (isSuccess ? 'success' : 'error');
  el.textContent = msg;
  el.style.display = 'block';
}

function clearAlert() {
  const el = document.getElementById('auth-msg');
  if (el) el.style.display = 'none';
}

async function checkExistingSession() {
  if (!sb) return;
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session && session.user) {
      showAlert('Sessão ativa encontrada. Entrando...', true);
      setTimeout(() => {
        window.location.replace(targetApp);
      }, 350);
    }
  } catch (e) {
    console.warn('Erro ao verificar sessão existente:', e);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  checkExistingSession();

  document.getElementById('form-login')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAlert();
    let email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const remember = document.getElementById('login-remember').checked;
    const btn = document.getElementById('btn-login');

    if (!email || !password) {
      showAlert('Preencha seu usuário/e-mail e sua senha.');
      return;
    }

    // Se o usuário digitou apenas um nome de usuário (ex: admin), anexa o domínio interno padrão
    if (!email.includes('@')) {
      email = `${email.toLowerCase()}@cantinho.local`;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> <span>Autenticando...</span>';

    try {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;

      if (!remember) {
        sessionStorage.setItem('cantinho_session_only', '1');
      } else {
        sessionStorage.removeItem('cantinho_session_only');
      }

      showAlert('Autenticado com sucesso! Carregando sistema...', true);
      setTimeout(() => {
        window.location.replace(targetApp);
      }, 500);
    } catch (err) {
      console.error('Falha de login:', err);
      let msg = 'E-mail ou senha incorretos. Em caso de dúvidas, contate o administrador.';
      if (err.message && err.message.toLowerCase().includes('network')) {
        msg = 'Erro de conexão com o servidor. Verifique sua internet.';
      } else if (err.message && err.message.includes('Invalid login credentials')) {
        msg = 'E-mail ou senha incorretos. Solicite suporte ao administrador se esqueceu seus dados.';
      } else if (err.message) {
        msg = err.message;
      }
      showAlert(msg);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<span>Acessar Sistema</span>';
    }
  });
});

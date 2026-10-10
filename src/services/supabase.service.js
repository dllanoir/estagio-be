import { createClient } from '@supabase/supabase-js';
import { SUPABASE_CONFIG } from '../config/supabase.js';

export function getAuthToken() {
  try {
    const raw = localStorage.getItem(SUPABASE_CONFIG.authStorageKey);
    if (raw) {
      const sess = JSON.parse(raw);
      return sess?.access_token || sess?.currentSession?.access_token || null;
    }
  } catch (e) {}
  return null;
}

export function getAuthHeaders() {
  const token = getAuthToken() || SUPABASE_CONFIG.anonKey;
  return {
    apikey: SUPABASE_CONFIG.anonKey,
    Authorization: `Bearer ${token}`
  };
}

export async function invokeEdgeFunction(functionName, body = {}, options = {}) {
  const token = getAuthToken() || SUPABASE_CONFIG.anonKey;
  const url = `${SUPABASE_CONFIG.url}/functions/v1/${functionName}`;
  const signal = options.signal;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_CONFIG.anonKey,
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body),
    signal
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const rawError = data.error || data.message;
    const msg = (typeof rawError === 'object' ? rawError?.message : rawError) || `Erro ${res.status} na Edge Function (${functionName})`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const sb = (typeof window !== 'undefined' && (window.supabase?.createClient || createClient))
  ? (createClient || window.supabase.createClient)(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : {
      from: (tbl) => ({
        select: async (cols = '*') => {
          try {
            const ctrl = new AbortController();
            const tid = setTimeout(() => ctrl.abort(), 12000);
            const r = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/${tbl}?select=${encodeURIComponent(cols)}`, {
              headers: getAuthHeaders(),
              signal: ctrl.signal
            });
            clearTimeout(tid);
            const d = await r.json();
            return { data: r.ok ? d : null, error: r.ok ? null : d };
          } catch (e) { return { data: null, error: e }; }
        },
        upsert: async (records) => {
          try {
            const ctrl = new AbortController();
            const tid = setTimeout(() => ctrl.abort(), 15000);
            const r = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/${tbl}`, {
              method: 'POST',
              headers: {
                ...getAuthHeaders(),
                'Content-Type': 'application/json',
                Prefer: 'resolution=merge-duplicates'
              },
              body: JSON.stringify(records),
              signal: ctrl.signal
            });
            clearTimeout(tid);
            return { error: r.ok ? null : await r.text() };
          } catch (e) { return { error: e }; }
        },
        delete: () => ({
          eq: async (col, val) => {
            try {
              const ctrl = new AbortController();
              const tid = setTimeout(() => ctrl.abort(), 12000);
              const r = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/${tbl}?${col}=eq.${encodeURIComponent(val)}`, {
                method: 'DELETE',
                headers: getAuthHeaders(),
                signal: ctrl.signal
              });
              clearTimeout(tid);
              return { error: r.ok ? null : await r.text() };
            } catch (e) { return { error: e }; }
          }
        }),
        insert: async (records) => {
          try {
            const ctrl = new AbortController();
            const tid = setTimeout(() => ctrl.abort(), 15000);
            const r = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/${tbl}`, {
              method: 'POST',
              headers: {
                ...getAuthHeaders(),
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(records),
              signal: ctrl.signal
            });
            clearTimeout(tid);
            return { error: r.ok ? null : await r.text() };
          } catch (e) { return { error: e }; }
        }
      }),
      rpc: async (fn, params) => {
        try {
          const ctrl = new AbortController();
          const tid = setTimeout(() => ctrl.abort(), 15000);
          const r = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/rpc/${fn}`, {
            method: 'POST',
            headers: {
              ...getAuthHeaders(),
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(params),
            signal: ctrl.signal
          });
          clearTimeout(tid);
          const d = await r.json();
          return { data: r.ok ? d : null, error: r.ok ? null : d };
        } catch (e) { return { data: null, error: e }; }
      },
      functions: {
        invoke: async (fn, opts = {}) => {
          try {
            const data = await invokeEdgeFunction(fn, opts.body, opts);
            return { data, error: null };
          } catch (error) {
            return { data: null, error };
          }
        }
      }
    };

if (sb && typeof sb === 'object') {
  if (!sb.functions) {
    sb.functions = {
      invoke: async (fn, opts = {}) => {
        try {
          const data = await invokeEdgeFunction(fn, opts.body, opts);
          return { data, error: null };
        } catch (error) {
          return { data: null, error };
        }
      }
    };
  }
}

if (typeof window !== 'undefined') window.sb = sb;

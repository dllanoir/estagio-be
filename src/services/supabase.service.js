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
      }
    };

if (typeof window !== 'undefined') window.sb = sb;

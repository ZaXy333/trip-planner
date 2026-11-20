import { createClient } from '@supabase/supabase-js';

const configuredSupabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseUrl = configuredSupabaseUrl
  ?.replace(/\/+$/, '')
  .replace(/\/(?:auth|rest)\/v1$/i, '');
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Brak zmiennych środowiskowych Supabase w pliku .env');
}

const parsedSupabaseUrl = new URL(supabaseUrl);
if (parsedSupabaseUrl.pathname !== '/' || parsedSupabaseUrl.search || parsedSupabaseUrl.hash) {
  throw new Error(
    'VITE_SUPABASE_URL musi być bazowym URL-em projektu, bez ścieżek takich jak /rest/v1.'
  );
}

const REMEMBER_ME_KEY = 'trip_planner_remember_me_v1';

const readRememberPreference = () => {
  try {
    return window.localStorage.getItem(REMEMBER_ME_KEY) !== 'false';
  } catch {
    return true;
  }
};

let rememberSession = readRememberPreference();

export const isRememberMeEnabled = () => rememberSession;

export const setRememberMeEnabled = (remember: boolean) => {
  rememberSession = remember;
  try {
    window.localStorage.setItem(REMEMBER_ME_KEY, String(remember));
  } catch {
    // Pamięć sesji nadal działa, jeśli przeglądarka blokuje localStorage.
  }
};

const sessionStorageAdapter = {
  getItem(key: string) {
    try {
      if (rememberSession) {
        return window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key);
      }
      return window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string) {
    const storage = rememberSession ? window.localStorage : window.sessionStorage;
    storage.setItem(key, value);
  },
  removeItem(key: string) {
    try {
      window.localStorage.removeItem(key);
      window.sessionStorage.removeItem(key);
    } catch {
      // Supabase auth handles storage errors as an expired session.
    }
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: sessionStorageAdapter,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

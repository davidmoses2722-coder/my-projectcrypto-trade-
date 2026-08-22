/**
 * useCredentials — Runtime API key management
 * ─────────────────────────────────────────────────────────────────────────────
 * Telegram keys are stored in localStorage so users can enter them through the
 * web UI without touching .env files. Falls back to VITE_ env vars if no
 * localStorage entry exists.
 *
 * Gate.io trading credentials are managed server-side (AES-256-CBC encrypted
 * in the database) and are never stored in localStorage.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "pcb_credentials";

export interface Credentials {
  telegramToken:  string;
  telegramChatId: string;
}

function loadFromStorage(): Credentials {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Credentials>;
      return {
        telegramToken:  parsed.telegramToken  ?? "",
        telegramChatId: parsed.telegramChatId ?? "",
      };
    }
  } catch { /* ignore */ }

  // Fall back to env vars
  return {
    telegramToken:  import.meta.env.VITE_TELEGRAM_TOKEN    || "",
    telegramChatId: import.meta.env.VITE_TELEGRAM_CHAT_ID  || "",
  };
}

function saveToStorage(creds: Credentials) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
  } catch { /* ignore */ }
}

export function clearCredentials() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

// ── Singleton runtime store so services can read without React ───────────────

let _runtimeCreds: Credentials = loadFromStorage();

export function getRuntimeCredentials(): Credentials {
  return _runtimeCreds;
}

export function setRuntimeCredentials(creds: Credentials) {
  _runtimeCreds = creds;
  saveToStorage(creds);
}

// ── Validators ───────────────────────────────────────────────────────────────

export function isValidTelegramToken(token: string) {
  return /^\d+:[A-Za-z0-9_-]{35,}$/.test(token);
}

export function isValidChatId(id: string) {
  return /^-?\d+$/.test(id.trim());
}

export function credentialStatus(creds: Credentials) {
  const hasTelegram =
    isValidTelegramToken(creds.telegramToken) &&
    isValidChatId(creds.telegramChatId);
  return { hasTelegram, hasAny: hasTelegram };
}

// ── React hook ───────────────────────────────────────────────────────────────

export function useCredentials() {
  const [credentials, setCredentialsState] = useState<Credentials>(_runtimeCreds);

  // Keep singleton in sync whenever state changes
  const saveCredentials = useCallback((creds: Credentials) => {
    setRuntimeCredentials(creds);
    setCredentialsState(creds);
  }, []);

  const clearAll = useCallback(() => {
    const empty: Credentials = { telegramToken: "", telegramChatId: "" };
    clearCredentials();
    _runtimeCreds = empty;
    setCredentialsState(empty);
  }, []);

  // Rehydrate on mount (e.g. after hot reload)
  useEffect(() => {
    const stored = loadFromStorage();
    setRuntimeCredentials(stored);
    setCredentialsState(stored);
  }, []);

  const status = credentialStatus(credentials);

  return {
    credentials,
    saveCredentials,
    clearAll,
    ...status,
  };
}

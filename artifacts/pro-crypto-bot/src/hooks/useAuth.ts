/**
 * useAuth — JWT authentication connected to the backend API
 * ─────────────────────────────────────────────────────────────────────────────
 * Calls POST /api/auth/login  to log in
 * Calls POST /api/auth/register to create an account
 * Calls GET  /api/auth/me  to verify token on page load
 * Stores JWT in localStorage as "pcb_jwt"
 * Auto-locks after 30 minutes of inactivity
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { SERVER_URL } from "../config/urls";

const TOKEN_KEY   = "pcb_jwt";
const SESSION_KEY = "pcb_session_ts";
const LOCK_AFTER  = 30 * 60 * 1000; // 30 minutes

export type AuthState = "loading" | "setup" | "locked" | "authenticated";
export type AuthMode  = "login" | "register";

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}
function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(SESSION_KEY);
}
function touchSession() {
  localStorage.setItem(SESSION_KEY, String(Date.now()));
}
function isSessionValid(): boolean {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return false;
  return Date.now() - Number(raw) < LOCK_AFTER;
}

const BASE = SERVER_URL || "";

async function apiLogin(usernameOrEmail: string, password: string) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usernameOrEmail, password }),
  });
  const json = await res.json();
  return json as { ok: boolean; data?: { token: string }; error?: string };
}

async function apiRegister(username: string, password: string) {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const json = await res.json();
  return json as { ok: boolean; data?: { token: string }; error?: string };
}

async function apiMe(token: string) {
  const res = await fetch(`${BASE}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json as { ok: boolean };
}

export function useAuth() {
  const [state, setState]   = useState<AuthState>("loading");
  const [error, setError]   = useState("");
  const [mode, setMode]     = useState<AuthMode>("login");
  const activityRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // On mount — check if token exists and session is still valid
  useEffect(() => {
    const token = getToken();
    if (!token) {
      // No token ever set — show register screen first time
      setState("setup");
      return;
    }
    if (!isSessionValid()) {
      setState("locked");
      return;
    }
    // Verify token with server
    apiMe(token).then((r) => {
      if (r?.ok) {
        setState("authenticated");
      } else {
        clearToken();
        setState("setup");
      }
    }).catch(() => {
      // Server unreachable — keep locked so user can retry
      setState("locked");
    });
  }, []);

  // Activity timer — reset inactivity lock
  const resetActivity = useCallback(() => {
    touchSession();
    clearTimeout(activityRef.current);
    activityRef.current = setTimeout(() => {
      setState("locked");
    }, LOCK_AFTER);
  }, []);

  useEffect(() => {
    if (state !== "authenticated") return;
    const events = ["mousedown", "keydown", "touchstart", "scroll"];
    events.forEach((e) => window.addEventListener(e, resetActivity, { passive: true }));
    resetActivity();
    return () => {
      events.forEach((e) => window.removeEventListener(e, resetActivity));
      clearTimeout(activityRef.current);
    };
  }, [state, resetActivity]);

  // Register (onSetup in LoginScreen)
  const setupPin = useCallback(async (username: string, password: string): Promise<boolean> => {
    setError("");
    if (!username || username.length < 3) {
      setError("Username must be at least 3 characters");
      return false;
    }
    if (!password || password.length < 8) {
      setError("Password must be at least 8 characters");
      return false;
    }
    try {
      const res = await apiRegister(username, password);
      if (res.ok && res.data?.token) {
        setToken(res.data.token);
        touchSession();
        setState("authenticated");
        return true;
      }
      setError(res.error ?? "Registration failed");
      return false;
    } catch {
      setError("Cannot reach server — make sure the API is running");
      return false;
    }
  }, []);

  // Login
  const login = useCallback(async (usernameOrEmail: string, password: string): Promise<boolean> => {
    setError("");
    try {
      const res = await apiLogin(usernameOrEmail, password);
      if (res.ok && res.data?.token) {
        setToken(res.data.token);
        touchSession();
        setState("authenticated");
        return true;
      }
      setError(res.error ?? "Invalid credentials");
      return false;
    } catch {
      setError("Cannot reach server — make sure the API is running");
      return false;
    }
  }, []);

  // Lock
  const lock = useCallback(() => {
    localStorage.removeItem(SESSION_KEY);
    setState("locked");
  }, []);

  // Reset (clear token — go back to register)
  const resetPin = useCallback(() => {
    clearToken();
    setError("");
    setState("setup");
  }, []);

  return {
    state,
    error,
    attempts: 0,       // kept for LoginScreen compat
    mode,
    setMode,
    setupPin,          // register
    login,
    lock,
    resetPin,
    getToken,
  };
}

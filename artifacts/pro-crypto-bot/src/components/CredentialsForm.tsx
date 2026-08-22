/**
 * CredentialsForm — API key management
 *
 * Gate.io keys → saved encrypted in the backend DB via /api/exchanges/save-keys
 * Telegram      → saved in browser localStorage (client-side service)
 */

import { useState, useEffect } from "react";
import { useCredentials } from "../hooks/useCredentials";
import { testTelegramConnection } from "../services/telegram";
import { SERVER_URL } from "../config/urls";
import { PremiumCard, PremiumCardContent } from "./premium/PremiumCard";

const TOKEN_KEY = "pcb_jwt";
function getJwt(): string | null { return localStorage.getItem(TOKEN_KEY); }

// ─── Field ────────────────────────────────────────────────────────────────────
function Field({
  label, value, onChange, placeholder, type = "text", hint, mono = false, disabled = false,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder: string; type?: string; hint?: string; mono?: boolean; disabled?: boolean;
}) {
  const [show, setShow] = useState(false);
  const isPassword = type === "password";
  return (
    <div className="space-y-1.5">
      <label className="text-[13px] font-bold font-semibold text-gray-400 uppercase tracking-wider">
        {label}
      </label>
      <div className="relative">
        <input
          type={isPassword && !show ? "password" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={`w-full bg-gray-800 border border-gray-700 rounded-xl px-3.5 py-2.5 text-sm
            text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/60
            focus:ring-1 focus:ring-cyan-500/20 transition-all
            ${mono ? "" : ""} ${isPassword ? "pr-20" : ""}
            ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
        />
        {isPassword && value && !disabled && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500
              hover:text-gray-300 bg-gray-700 px-2 py-1 rounded-lg transition-colors"
          >
            {show ? "Hide" : "Show"}
          </button>
        )}
      </div>
      {hint && <p className="text-xs text-gray-600">{hint}</p>}
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-sm font-semibold px-2.5 py-1
        rounded-full border ${
          ok
            ? "bg-green-500/10 border-green-500/30 text-green-400"
            : "bg-red-500/10 border-red-500/30 text-red-400"
        }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-green-400 animate-pulse" : "bg-red-400"}`}
      />
      {label}
    </span>
  );
}

// ─── Result box ───────────────────────────────────────────────────────────────
function ResultBox({ msg }: { msg: string }) {
  const isOk = msg.startsWith("✅");
  return (
    <div
      className={`text-sm font-semibold px-3 py-2 rounded-xl border ${
        isOk
          ? "bg-green-500/10 border-green-500/25 text-green-400"
          : "bg-red-500/10 border-red-500/25 text-red-400"
      }`}
    >
      {msg}
    </div>
  );
}

// ─── Spinner ──────────────────────────────────────────────────────────────────
function Spinner({ color = "cyan" }: { color?: string }) {
  return (
    <span
      className={`w-3.5 h-3.5 border border-${color}-400/30 border-t-${color}-400
        rounded-full animate-spin inline-block`}
    />
  );
}

// ─── Gate.io section (backend-encrypted storage) ─────────────────────────────
function GateioSection() {
  const [apiKey,    setApiKey]    = useState("");
  const [secret,    setSecret]    = useState("");
  const [label,     setLabel]     = useState("");
  const [paper,     setPaper]     = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [testing,   setTesting]   = useState(false);
  const [deleting,  setDeleting]  = useState(false);
  const [msg,       setMsg]       = useState("");
  const [hasKeys,   setHasKeys]   = useState(false);
  const [maskedKey, setMaskedKey] = useState("");
  const [showForm,  setShowForm]  = useState(false);
  const [showDel,   setShowDel]   = useState(false);

  // Load current key status from backend on mount
  useEffect(() => {
    const token = getJwt();
    if (!token) return;
    fetch(`${SERVER_URL}/api/exchanges`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) return;
        const gateio = (d.data?.supported ?? []).find(
          (e: { id: string }) => e.id === "gateio",
        );
        if (gateio?.hasKeys) {
          setHasKeys(true);
          setMaskedKey(gateio.maskedKey ?? "");
        }
      })
      .catch(() => {});
  }, []);

  const authHeaders = () => {
    const token = getJwt();
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };

  const handleSave = async () => {
    if (!apiKey.trim() || !secret.trim()) {
      setMsg("❌ API Key and Secret are required.");
      return;
    }
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch(`${SERVER_URL}/api/exchanges/save-keys`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ exchange: "gateio", apiKey, secret, paper, label: label || undefined }),
      });
      const d = await res.json();
      if (d.ok) {
        setMsg("✅ Gate.io keys saved & encrypted in database.");
        setHasKeys(true);
        setMaskedKey(d.data?.maskedKey ?? "");
        setApiKey("");
        setSecret("");
        setShowForm(false);
      } else {
        setMsg(`❌ ${d.error ?? "Failed to save keys"}`);
      }
    } catch (e) {
      setMsg(`❌ Network error: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleTestBalance = async () => {
    setTesting(true);
    setMsg("");
    try {
      const res = await fetch(`${SERVER_URL}/api/exchanges/balance?exchange=gateio`, {
        headers: authHeaders(),
      });
      const d = await res.json();
      if (d.ok) {
        const total = d.data?.totalUsd != null ? ` · ~$${Number(d.data.totalUsd).toFixed(2)} USDT` : "";
        setMsg(`✅ Gate.io balance fetched successfully${total}`);
      } else {
        setMsg(`❌ ${d.error ?? "Balance fetch failed"}`);
      }
    } catch (e) {
      setMsg(`❌ Network error: ${String(e)}`);
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setMsg("");
    try {
      const res = await fetch(`${SERVER_URL}/api/exchanges/gateio/keys`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const d = await res.json();
      if (d.ok) {
        setMsg("✅ Gate.io keys removed.");
        setHasKeys(false);
        setMaskedKey("");
        setShowDel(false);
      } else {
        setMsg(`❌ ${d.error ?? "Delete failed"}`);
      }
    } catch (e) {
      setMsg(`❌ Network error: ${String(e)}`);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <PremiumCard animatedBorder>
      <PremiumCardContent className="p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xl">🔷</span>
          <div>
            <h3 className="text-base font-bold text-white">Gate.io API Keys</h3>
            <p className="text-xs text-gray-500">Live trading · Encrypted &amp; stored in database</p>
          </div>
        </div>
        <StatusBadge ok={hasKeys} label={hasKeys ? "Connected" : "Not Set"} />
      </div>

      {/* Existing key summary */}
      {hasKeys && !showForm && (
        <div className="flex items-center justify-between bg-green-500/8 border border-green-500/20
          rounded-xl px-4 py-3 gap-3 flex-wrap">
          <div>
            <p className="text-green-400 text-sm font-semibold">API key active</p>
            {maskedKey && (
              <p className="text-gray-500 text-xs mt-0.5">{maskedKey}</p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleTestBalance}
              disabled={testing}
              className="text-xs bg-cyan-500/10 border border-cyan-500/30 text-cyan-400
                hover:bg-cyan-500/20 px-3 py-1.5 rounded-xl transition-all
                disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {testing ? <><Spinner color="cyan" /> Testing…</> : "⚡ Test Balance"}
            </button>
            <button
              onClick={() => setShowForm(true)}
              className="text-xs bg-gray-700 border border-gray-600 text-gray-300
                hover:bg-gray-600 px-3 py-1.5 rounded-xl transition-all"
            >
              🔄 Replace
            </button>
            <button
              onClick={() => setShowDel((s) => !s)}
              className="text-xs bg-red-500/10 border border-red-500/30 text-red-400
                hover:bg-red-500/20 px-3 py-1.5 rounded-xl transition-all"
            >
              🗑️
            </button>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {showDel && (
        <div className="bg-red-500/8 border border-red-500/20 rounded-xl p-3 space-y-2">
          <p className="text-red-400 text-sm font-semibold">
            ⚠️ Remove Gate.io keys from the database?
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="text-xs bg-red-500/20 border border-red-500/40 text-red-400
                px-4 py-1.5 rounded-xl hover:bg-red-500/30 transition-all
                disabled:opacity-50 flex items-center gap-1.5"
            >
              {deleting ? <><Spinner color="red" /> Deleting…</> : "Yes, delete"}
            </button>
            <button
              onClick={() => setShowDel(false)}
              className="text-xs text-gray-500 hover:text-gray-300 px-4 py-1.5
                rounded-xl border border-gray-800 transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Form — shown when no keys yet OR replacing */}
      {(!hasKeys || showForm) && (
        <div className="space-y-3">
          <Field
            label="API Key"
            value={apiKey}
            onChange={setApiKey}
            placeholder="Paste your Gate.io API key..."
            type="password"
            hint="Gate.io → Account → API Management → Create API key"
          />
          <Field
            label="Secret Key"
            value={secret}
            onChange={setSecret}
            placeholder="Paste your Gate.io secret key..."
            type="password"
            hint="Only shown once when you create the key. Enable Spot trading — never Withdrawal."
          />
          <Field
            label="Label (optional)"
            value={label}
            onChange={setLabel}
            placeholder="e.g. Pro Crypto Bot"
            hint="A name to identify this key in your DB."
          />

          {/* Paper mode toggle */}
          <label className="flex items-center gap-3 cursor-pointer select-none group">
            <div
              onClick={() => setPaper((p) => !p)}
              className={`relative w-10 h-5 rounded-full transition-colors
                ${paper ? "bg-yellow-500/60" : "bg-cyan-500/60"}`}
            >
              <div
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform
                  ${paper ? "translate-x-0.5" : "translate-x-5"}`}
              />
            </div>
            <span className="text-xs text-gray-400 group-hover:text-gray-300 transition-colors">
              {paper
                ? <><span className="text-yellow-400 font-semibold">Paper mode</span> — no real orders</>
                : <><span className="text-cyan-400 font-semibold">Live mode</span> — real orders on Gate.io</>
              }
            </span>
          </label>

          {/* Setup guide */}
          <details className="group">
            <summary className="cursor-pointer text-xs text-cyan-400 hover:text-cyan-300
              font-medium flex items-center gap-1 select-none">
              <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
              How to create a Gate.io API key
            </summary>
            <ol className="mt-3 space-y-1.5 text-xs text-gray-400 pl-4 list-none">
              <li>1. Log in to <span className="text-cyan-400">gate.io</span></li>
              <li>2. Go to <strong className="text-white">Account → API Management</strong></li>
              <li>3. Click <strong className="text-white">Create API Key</strong></li>
              <li>4. Enable <strong className="text-white">Spot Trading</strong> only</li>
              <li>5. ⚠️ Do <strong className="text-red-400">NOT</strong> enable Withdrawal</li>
              <li>6. Optionally restrict to your server's IP</li>
              <li>7. Copy your API Key and Secret before closing</li>
            </ol>
          </details>

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-sm
                py-2.5 px-6 rounded-xl transition-all active:scale-95
                disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {saving ? <><Spinner color="black" /> Saving…</> : "🔒 Save to Database"}
            </button>
            {hasKeys && showForm && (
              <button
                onClick={() => { setShowForm(false); setApiKey(""); setSecret(""); setMsg(""); }}
                className="text-xs text-gray-500 hover:text-gray-300 px-4
                  rounded-xl border border-gray-800 transition-all"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {msg && <ResultBox msg={msg} />}

      {/* Security note */}
      <div className="flex items-start gap-2 text-xs text-gray-600 border-t border-white/5 pt-3">
        <span className="text-green-500 shrink-0">🔐</span>
        <span>
          Keys are encrypted with AES-256-CBC before storage. They never appear in API responses — only masked previews.
        </span>
      </div>
      </PremiumCardContent>
    </PremiumCard>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export function CredentialsForm() {
  const { credentials, saveCredentials, clearAll, hasTelegram } = useCredentials();

  const [form, setForm] = useState({
    telegramToken:  credentials.telegramToken,
    telegramChatId: credentials.telegramChatId,
  });
  const [saved,      setSaved]      = useState(false);
  const [testing,    setTesting]    = useState<"telegram" | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [showClear,  setShowClear]  = useState(false);

  const set = (key: keyof typeof form) => (val: string) =>
    setForm((f) => ({ ...f, [key]: val }));

  const handleSave = () => {
    saveCredentials(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleTestTelegram = async () => {
    saveCredentials(form);
    setTesting("telegram");
    setTestResult({});
    try {
      const res = await testTelegramConnection();
      if (res.ok) {
        const botStr = res.botUsername ? `: @${res.botUsername}` : "";
        setTestResult({ telegram: `✅ Bot connected${botStr} — test message sent!` });
      } else {
        setTestResult({ telegram: `❌ ${res.error ?? "Telegram connection failed"}` });
      }
    } catch (e) {
      setTestResult({ telegram: `❌ Error: ${String(e)}` });
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">🔑 API Configuration</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Gate.io keys encrypted in DB · Telegram stored locally
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge ok={hasTelegram} label={hasTelegram ? "Telegram ✓" : "Telegram ✗"} />
        </div>
      </div>

      {/* ── Gate.io — backend-encrypted ─────────────────────────────────── */}
      <GateioSection />

      {/* ── Telegram Section ──────────────────────────────────────────────── */}
      <PremiumCard hoverGlow>
        <PremiumCardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">✈️</span>
            <div>
              <h3 className="text-base font-bold text-white">Telegram Alerts</h3>
              <p className="text-xs text-slate-500">Real-time signals, trades &amp; SL alerts</p>
            </div>
          </div>
          <StatusBadge ok={hasTelegram} label={hasTelegram ? "Active" : "Not Set"} />
        </div>

        <Field label="Bot Token" value={form.telegramToken} onChange={set("telegramToken")}
          placeholder="123456789:ABCdef..." type="password"
          hint="Get from @BotFather on Telegram → /newbot" />
        <Field label="Chat ID" value={form.telegramChatId} onChange={set("telegramChatId")}
          placeholder="-1001234567890 or 123456789"
          hint="Your chat/group ID. Send a message to @userinfobot to find it." />

        <details className="group">
          <summary className="cursor-pointer text-xs text-cyan-400 hover:text-cyan-300
            font-medium flex items-center gap-1 select-none">
            <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
            How to set up a Telegram bot
          </summary>
          <ol className="mt-3 space-y-1.5 text-xs text-gray-400 pl-4 list-none">
            <li>1. Open Telegram → search <span className="text-cyan-400">@BotFather</span></li>
            <li>2. Send <code className="text-green-400">/newbot</code> → get your Token</li>
            <li>3. Start a chat with your new bot</li>
            <li>4. Message <span className="text-cyan-400">@userinfobot</span> to get your Chat ID</li>
          </ol>
        </details>

        <button onClick={handleTestTelegram} disabled={testing === "telegram"}
          className="flex items-center gap-2 text-xs bg-blue-500/10 border border-blue-500/30
            text-blue-400 hover:bg-blue-500/20 px-3 py-2 rounded-xl transition-all
            disabled:opacity-50 disabled:cursor-not-allowed">
          {testing === "telegram" ? <><Spinner color="blue" /> Sending test message…</> : <>✈️ Test Telegram</>}
        </button>
        {testResult.telegram && <ResultBox msg={testResult.telegram} />}

        {/* ── Save Telegram / Clear ─────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <button onClick={handleSave}
          className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-sm
            py-3 px-6 rounded-xl transition-all active:scale-95">
          {saved ? "✅ Saved!" : "💾 Save Telegram Keys"}
        </button>
        <button onClick={() => setShowClear((s) => !s)}
          className="text-xs text-gray-600 hover:text-red-400 border border-gray-800
            hover:border-red-500/30 px-3 py-3 rounded-xl transition-all">
          🗑️ Clear
        </button>
      </div>

      {showClear && (
        <div className="bg-red-500/8 border border-red-500/20 rounded-xl p-4 space-y-3">
          <p className="text-red-400 text-sm font-semibold">
            ⚠️ This will clear Telegram keys from localStorage. Gate.io keys stay in the DB.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => {
                clearAll();
                setForm({ telegramToken: "", telegramChatId: "" });
                setShowClear(false);
              }}
              className="text-xs bg-red-500/20 border border-red-500/40 text-red-400
                px-4 py-2 rounded-xl hover:bg-red-500/30 transition-all"
            >
              Yes, clear
            </button>
            <button onClick={() => setShowClear(false)}
              className="text-xs text-gray-500 hover:text-gray-300 px-4 py-2
                rounded-xl border border-gray-800 transition-all">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Troubleshooting ─────────────────────────────────────────────── */}
      <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-4 space-y-2">
        <p className="text-sm font-semibold text-slate-400">🔧 Troubleshooting</p>
        <ul className="text-xs text-gray-600 space-y-1.5">
          <li>
            <span className="text-yellow-400">Gate.io "No keys"</span> — Log in first (top-right). Keys are tied to your account.
          </li>
          <li>
            <span className="text-yellow-400">Telegram not sending</span> — Make sure you started a conversation with your bot first.
          </li>
          <li>
            <span className="text-green-400">Live prices working?</span> — Check the <strong className="text-white">LIVE</strong> badge in the top header.
          </li>
        </ul>
      </div>
      </PremiumCardContent>
      </PremiumCard>
    </div>
  );
}

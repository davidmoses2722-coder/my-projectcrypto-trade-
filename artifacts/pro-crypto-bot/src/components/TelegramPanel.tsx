/**
 * TelegramPanel — Phase 13 Professional Telegram Dashboard
 *
 * Shows:
 *  • Connection status + enable/disable toggle
 *  • Live stats (sent, failed, queue)
 *  • Recent notification history with event badges
 *  • Full bot command reference
 *  • Test + reconnect controls
 */

import { useState, useEffect, useCallback } from "react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

function api(method: string, path: string, body?: unknown) {
  const jwt = localStorage.getItem("pcb_jwt") ?? "";
  return fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }).then((r) => r.json());
}

interface TgStatus {
  configured:  boolean;
  enabled:     boolean;
  chatId:      string | null;
  lastSentAt:  number | null;
  lastMsg:     string | null;
  lastError:   string | null;
  queueLen:    number;
  totalSent:   number;
  totalFailed: number;
}

function timeAgo(ms: number | null): string {
  if (!ms) return "Never";
  const diff = Math.floor((Date.now() - ms) / 1000);
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// ─── Event type display config ────────────────────────────────────────────────

const NOTIFICATION_TYPES = [
  { event: "Bot Started",     emoji: "🚀", color: "text-green-400",  bg: "bg-green-500/10  border-green-500/20" },
  { event: "Bot Stopped",     emoji: "⏹️",  color: "text-gray-400",   bg: "bg-gray-500/10   border-gray-500/20" },
  { event: "BUY Signal",      emoji: "🟢", color: "text-emerald-400",bg: "bg-emerald-500/10 border-emerald-500/20" },
  { event: "SELL / Exit",     emoji: "🔴", color: "text-rose-400",   bg: "bg-rose-500/10   border-rose-500/20" },
  { event: "Take Profit",     emoji: "🏆", color: "text-yellow-400", bg: "bg-yellow-500/10 border-yellow-500/20" },
  { event: "Stop Loss",       emoji: "🛑", color: "text-red-400",    bg: "bg-red-500/10    border-red-500/20" },
  { event: "Trailing Stop",   emoji: "📏", color: "text-cyan-400",   bg: "bg-cyan-500/10   border-cyan-500/20" },
  { event: "Breakeven",       emoji: "⚖️",  color: "text-amber-400",  bg: "bg-amber-500/10  border-amber-500/20" },
  { event: "Profit Lock",     emoji: "🔒", color: "text-purple-400", bg: "bg-purple-500/10 border-purple-500/20" },
  { event: "Manual Close",    emoji: "✋", color: "text-blue-400",   bg: "bg-blue-500/10   border-blue-500/20" },
  { event: "Manual TP",       emoji: "🎯", color: "text-teal-400",   bg: "bg-teal-500/10   border-teal-500/20" },
  { event: "Daily Report",    emoji: "📊", color: "text-sky-400",    bg: "bg-sky-500/10    border-sky-500/20" },
  { event: "Risk Alert",      emoji: "⚠️",  color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/20" },
  { event: "Connection Alert",emoji: "🔌", color: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/20" },
  { event: "Exchange Alert",  emoji: "📡", color: "text-pink-400",   bg: "bg-pink-500/10   border-pink-500/20" },
];

// ─── Bot commands reference ───────────────────────────────────────────────────

const BOT_COMMANDS = [
  { cmd: "/status",           desc: "Full system status + current position" },
  { cmd: "/dashboard",        desc: "Performance summary dashboard" },
  { cmd: "/positions",        desc: "All open positions with P&L" },
  { cmd: "/trades",           desc: "Recent closed trades" },
  { cmd: "/history",          desc: "Full trade history (last 20)" },
  { cmd: "/performance",      desc: "Win rate, profit factor, Sharpe" },
  { cmd: "/risk",             desc: "Risk engine status + limits" },
  { cmd: "/settings",         desc: "Current bot configuration" },
  { cmd: "/pause",            desc: "Pause bot (no new trades)" },
  { cmd: "/resume",           desc: "Resume trading after pause" },
  { cmd: "/close BTCUSDT",    desc: "Manually close a position" },
  { cmd: "/takeprofit BTCUSDT", desc: "Take profit on a position" },
  { cmd: "/help",             desc: "Show all available commands" },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatBox({ label, value, color = "text-white" }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div className="bg-slate-900 border border-slate-700/50 rounded-xl p-3">
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-1">{label}</div>
      <div className={`text-xl font-black ${color}`}>{value}</div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TelegramPanel() {
  const [status,     setStatus]     = useState<TgStatus | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [testing,    setTesting]    = useState(false);
  const [toggling,   setToggling]   = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [activeTab,  setActiveTab]  = useState<"status" | "notifications" | "commands">("status");

  const refresh = useCallback(async () => {
    try {
      const data = (await api("GET", "/api/telegram/status")) as TgStatus;
      setStatus(data);
    } catch { /* network error — keep existing */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void refresh();
    const iv = setInterval(() => { void refresh(); }, 5_000);
    return () => clearInterval(iv);
  }, [refresh]);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = (await api("POST", "/api/telegram/test")) as { ok: boolean; error?: string };
      setTestResult(r.ok
        ? { ok: true,  msg: "✅ Test message sent successfully!" }
        : { ok: false, msg: `❌ Failed: ${r.error ?? "unknown error"}` });
      void refresh();
    } catch (e) {
      setTestResult({ ok: false, msg: `❌ Network error: ${String(e)}` });
    } finally {
      setTesting(false);
      setTimeout(() => setTestResult(null), 6_000);
    }
  };

  const handleToggle = async () => {
    if (!status) return;
    setToggling(true);
    try {
      await api("POST", "/api/telegram/config", { enabled: !status.enabled });
      void refresh();
    } finally { setToggling(false); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-slate-500">
        <div className="w-5 h-5 border-2 border-slate-600 border-t-cyan-500 rounded-full animate-spin mr-2" />
        Loading Telegram status…
      </div>
    );
  }

  const connected = status?.configured ?? false;
  const enabled   = status?.enabled    ?? false;
  const isLive    = connected && enabled;

  return (
    <div className="space-y-4">

      {/* ── Connection banner ─────────────────────────────────────────────── */}
      <div className={`rounded-2xl border px-5 py-4 flex items-center justify-between ${
        isLive    ? "bg-emerald-950/30 border-emerald-700/40" :
        connected ? "bg-amber-950/30  border-amber-700/40" :
                    "bg-rose-950/30   border-rose-700/40"
      }`}>
        <div className="flex items-center gap-3">
          <div className="relative">
            <span className="text-3xl">📱</span>
            <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-gray-900 ${
              isLive ? "bg-emerald-400 animate-pulse" : connected ? "bg-amber-400" : "bg-rose-500"
            }`} />
          </div>
          <div>
            <div className="text-white font-black text-base">
              {isLive ? "Telegram Connected & Active" : connected ? "Connected — Notifications Paused" : "Not Configured"}
            </div>
            <div className="text-slate-400 text-xs mt-0.5">
              {status?.chatId
                ? `Chat ID: ${status.chatId} · Last sent: ${timeAgo(status.lastSentAt)}`
                : "Set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID in Replit Secrets"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => void handleTest()}
            disabled={!connected || testing}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 border border-slate-700 hover:border-slate-500 text-slate-300 transition-all disabled:opacity-40"
          >
            {testing ? "Sending…" : "Test"}
          </button>
          <button
            onClick={() => void handleToggle()}
            disabled={!connected || toggling}
            className={`px-4 py-1.5 rounded-lg text-xs font-black transition-all disabled:opacity-40 ${
              enabled
                ? "bg-rose-500/15 border border-rose-500/40 text-rose-400 hover:bg-rose-500/25"
                : "bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/25"
            }`}
          >
            {toggling ? "…" : enabled ? "Disable" : "Enable"}
          </button>
        </div>
      </div>

      {testResult && (
        <div className={`px-4 py-3 rounded-xl text-sm font-semibold ${
          testResult.ok
            ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400"
            : "bg-rose-500/10 border border-rose-500/30 text-rose-400"
        }`}>
          {testResult.msg}
        </div>
      )}

      {/* ── Stats grid ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatBox label="Sent"       value={status?.totalSent  ?? 0} color="text-emerald-400" />
        <StatBox label="Failed"     value={status?.totalFailed ?? 0} color={(status?.totalFailed ?? 0) > 0 ? "text-rose-400" : "text-slate-500"} />
        <StatBox label="Queue"      value={status?.queueLen    ?? 0} color={(status?.queueLen ?? 0) > 0 ? "text-amber-400" : "text-slate-500"} />
        <StatBox label="Last Sent"  value={timeAgo(status?.lastSentAt ?? null)} color="text-slate-300" />
      </div>

      {/* ── Last message ─────────────────────────────────────────────────── */}
      {status?.lastMsg && (
        <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-1.5">Last Message Sent</p>
          <p className="text-slate-300 text-xs font-mono leading-relaxed line-clamp-3">{status.lastMsg}</p>
        </div>
      )}
      {status?.lastError && (
        <div className="bg-rose-950/20 border border-rose-500/30 rounded-xl px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-rose-600 mb-1">Last Error</p>
          <p className="text-rose-400 text-xs">{status.lastError}</p>
        </div>
      )}

      {/* ── Tab nav ───────────────────────────────────────────────────────── */}
      <div className="flex gap-1 bg-slate-900/50 border border-slate-700/50 rounded-xl p-1">
        {(["status", "notifications", "commands"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`flex-1 py-2 rounded-lg text-xs font-bold capitalize transition-all ${
              activeTab === t
                ? "bg-slate-700 text-white"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {t === "notifications" ? "📢 Notifications" : t === "commands" ? "⌨️ Commands" : "📊 Status"}
          </button>
        ))}
      </div>

      {/* ── Status tab ───────────────────────────────────────────────────── */}
      {activeTab === "status" && (
        <div className="space-y-3">
          <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-4 space-y-3">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Configuration</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                { k: "Bot Token",      v: connected ? "✓ Configured" : "Not set",      c: connected ? "text-emerald-400" : "text-rose-400" },
                { k: "Chat ID",        v: status?.chatId ?? "Not set",                  c: status?.chatId ? "text-emerald-400" : "text-rose-400" },
                { k: "Notifications",  v: enabled ? "Enabled" : "Disabled",             c: enabled ? "text-emerald-400" : "text-slate-500" },
                { k: "Rate Limit",     v: "20 msgs/min",                                c: "text-slate-400" },
                { k: "Parse Mode",     v: "HTML",                                        c: "text-slate-400" },
                { k: "Retry Policy",   v: "3× with backoff",                            c: "text-slate-400" },
              ].map(({ k, v, c }) => (
                <div key={k} className="bg-slate-800/60 rounded-lg px-3 py-2">
                  <div className="text-slate-600 text-[10px] uppercase tracking-wider mb-0.5">{k}</div>
                  <div className={`font-semibold ${c}`}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Notifications tab ────────────────────────────────────────────── */}
      {activeTab === "notifications" && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">All notification types the bot sends automatically.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {NOTIFICATION_TYPES.map(({ event, emoji, color, bg }) => (
              <div key={event} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 border ${bg}`}>
                <span className="text-lg shrink-0">{emoji}</span>
                <div>
                  <div className={`text-xs font-bold ${color}`}>{event}</div>
                  <div className="w-6 h-0.5 mt-1 rounded-full bg-current opacity-30" />
                </div>
              </div>
            ))}
          </div>
          <div className="bg-slate-900/40 border border-slate-700/40 rounded-xl px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-2">Scheduled Reports</p>
            <div className="space-y-1.5 text-xs text-slate-400">
              <div className="flex justify-between">
                <span>📊 Daily Summary</span>
                <span className="text-slate-500">00:00 UTC daily</span>
              </div>
              <div className="flex justify-between">
                <span>📅 Weekly Summary</span>
                <span className="text-slate-500">Monday 00:00 UTC</span>
              </div>
              <div className="flex justify-between">
                <span>📆 Monthly Summary</span>
                <span className="text-slate-500">1st of month UTC</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Commands tab ──────────────────────────────────────────────────── */}
      {activeTab === "commands" && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">Send these commands to your bot in Telegram.</p>
          {BOT_COMMANDS.map(({ cmd, desc }) => (
            <div key={cmd} className="flex items-center gap-3 bg-slate-900/50 border border-slate-700/40 rounded-xl px-3 py-2.5 hover:border-slate-600/60 transition-colors">
              <code className="text-cyan-400 text-xs font-mono font-bold shrink-0 min-w-[140px]">{cmd}</code>
              <span className="text-slate-400 text-xs">{desc}</span>
            </div>
          ))}
          <div className="mt-3 bg-amber-950/20 border border-amber-500/20 rounded-xl px-4 py-3 text-xs text-amber-400/80">
            ⚠️ Admin commands (pause, resume, close) are restricted to <code className="font-mono">TELEGRAM_ADMIN_IDS</code> set in secrets.
          </div>
        </div>
      )}

    </div>
  );
}

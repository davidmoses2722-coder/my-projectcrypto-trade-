/**
 * PositionActionButtons — Phase 13 complete position control panel.
 *
 * Controls:
 *   🟢 Take Profit Now
 *   🔴 Close Position
 *   📉 Close 25% / 50% / 75%
 *   ⚖️  Move SL to Breakeven
 *   📏 Enable / Disable Trailing
 *   🔒 Lock Profit
 *
 * All actions require a confirmation modal.
 * Delegates exclusively to REST endpoints — no trading logic here.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { SERVER_URL } from "../config/urls";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface PositionActionButtonsProps {
  symbol:        string;
  pnlUsd:        number;
  pnlPct:        number;
  entry:         number;
  currentPrice:  number;
  positionSize?: number;
  calledBy?:     string;
  /** Pass live position data for trailing/breakeven state awareness */
  trailingActive?: boolean;
  breakevenActive?: boolean;
}

// ─── Action types ─────────────────────────────────────────────────────────────

type ActionType =
  | "take_profit"
  | "close"
  | "close_25"
  | "close_50"
  | "close_75"
  | "breakeven"
  | "trailing_on"
  | "trailing_off"
  | "lock_profit";

interface ActionMeta {
  label:    string;
  endpoint: string;
  body?:    Record<string, unknown>;
  confirm:  string;
  color:    "green" | "red" | "yellow" | "cyan" | "purple" | "orange";
}

const ACTION_META: Record<ActionType, ActionMeta> = {
  take_profit:  { label: "🟢 Take Profit",     endpoint: "take-profit", color: "green",  confirm: "Close at current price and book profit/loss." },
  close:        { label: "🔴 Close Position",   endpoint: "close",       color: "red",    confirm: "Immediately exit this entire position." },
  close_25:     { label: "Close 25%",           endpoint: "close-partial", body: { pct: 25 }, color: "orange", confirm: "Close 25% of the current position size." },
  close_50:     { label: "Close 50%",           endpoint: "close-partial", body: { pct: 50 }, color: "orange", confirm: "Close 50% of the current position size." },
  close_75:     { label: "Close 75%",           endpoint: "close-partial", body: { pct: 75 }, color: "orange", confirm: "Close 75% of the current position size." },
  breakeven:    { label: "⚖️ Breakeven",        endpoint: "breakeven",   color: "yellow", confirm: "Move Stop Loss to entry price — zero-loss protection." },
  trailing_on:  { label: "📏 Trailing ON",      endpoint: "trailing",    body: { enable: true  }, color: "cyan",   confirm: "Enable trailing stop — SL follows price up." },
  trailing_off: { label: "📏 Trailing OFF",     endpoint: "trailing",    body: { enable: false }, color: "cyan",   confirm: "Disable trailing stop — SL returns to fixed level." },
  lock_profit:  { label: "🔒 Lock Profit",      endpoint: "lock-profit", color: "purple", confirm: "Lock current profit level — SL moves to secure gains." },
};

const COLOR_CLASSES: Record<string, { btn: string; modal: string }> = {
  green:  { btn: "bg-green-500/10 hover:bg-green-500/20 border-green-500/30 hover:border-green-500/50 text-green-400",   modal: "bg-green-500/20 hover:bg-green-500/30 border-green-500/40 text-green-400" },
  red:    { btn: "bg-red-500/10 hover:bg-red-500/20 border-red-500/30 hover:border-red-500/50 text-red-400",             modal: "bg-red-500/20 hover:bg-red-500/30 border-red-500/40 text-red-400" },
  yellow: { btn: "bg-yellow-500/10 hover:bg-yellow-500/20 border-yellow-500/30 hover:border-yellow-500/50 text-yellow-400", modal: "bg-yellow-500/20 hover:bg-yellow-500/30 border-yellow-500/40 text-yellow-400" },
  cyan:   { btn: "bg-cyan-500/10 hover:bg-cyan-500/20 border-cyan-500/30 hover:border-cyan-500/50 text-cyan-400",        modal: "bg-cyan-500/20 hover:bg-cyan-500/30 border-cyan-500/40 text-cyan-400" },
  purple: { btn: "bg-purple-500/10 hover:bg-purple-500/20 border-purple-500/30 hover:border-purple-500/50 text-purple-400", modal: "bg-purple-500/20 hover:bg-purple-500/30 border-purple-500/40 text-purple-400" },
  orange: { btn: "bg-orange-500/10 hover:bg-orange-500/20 border-orange-500/30 hover:border-orange-500/50 text-orange-400", modal: "bg-orange-500/20 hover:bg-orange-500/30 border-orange-500/40 text-orange-400" },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1000) return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1)    return n.toFixed(4);
  return n.toFixed(6);
}

function Row({ label, value, color = "text-white" }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-gray-800/60">
      <span className="text-gray-500 text-xs">{label}</span>
      <span className={`font-bold text-xs ${color}`}>{value}</span>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PositionActionButtons({
  symbol, pnlUsd, pnlPct, entry, currentPrice, positionSize,
  calledBy = "unknown", trailingActive = false, breakevenActive = false,
}: PositionActionButtonsProps) {
  console.log(`[UI] PositionActionButtons symbol=${symbol} component=${calledBy}`);

  const [modal,   setModal]   = useState<ActionType | null>(null);
  const [pending, setPending] = useState(false);
  const [notice,  setNotice]  = useState<{ ok: boolean; text: string } | null>(null);
  const [expanded, setExpanded] = useState(false);

  const flash = (ok: boolean, text: string) => {
    setNotice({ ok, text });
    setTimeout(() => setNotice(null), 4_500);
  };

  const handleConfirm = async () => {
    if (!modal) return;
    const meta = ACTION_META[modal];
    setModal(null);
    setPending(true);
    try {
      const token = localStorage.getItem("pcb_jwt") ?? "";
      const res   = await fetch(
        `${SERVER_URL}/api/positions/${encodeURIComponent(symbol)}/${meta.endpoint}`,
        {
          method:  "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          ...(meta.body ? { body: JSON.stringify(meta.body) } : {}),
        },
      );
      const data = await res.json() as { ok: boolean; error?: string; message?: string };
      if (data.ok) {
        flash(true, data.message ?? `${meta.label} — request queued`);
      } else {
        flash(false, data.error ?? "Request failed");
      }
    } catch {
      flash(false, "Network error — check connection");
    } finally {
      setPending(false);
    }
  };

  const up = pnlUsd >= 0;
  const currentMeta = modal ? ACTION_META[modal] : null;

  return (
    <>
      {/* ── Primary buttons ──────────────────────────────────────────────── */}
      <div className="space-y-2 mt-3">
        <div className="grid grid-cols-2 gap-2">
          <button
            disabled={pending}
            onClick={() => setModal("take_profit")}
            className={`py-2.5 rounded-xl border text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${COLOR_CLASSES.green.btn}`}
          >
            {pending ? "⏳ Working…" : "🟢 Take Profit"}
          </button>
          <button
            disabled={pending}
            onClick={() => setModal("close")}
            className={`py-2.5 rounded-xl border text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${COLOR_CLASSES.red.btn}`}
          >
            {pending ? "⏳ Working…" : "🔴 Close All"}
          </button>
        </div>

        {/* ── Advanced controls toggle ─────────────────────────────────── */}
        <button
          onClick={() => setExpanded(e => !e)}
          className="w-full py-1.5 text-xs text-gray-600 hover:text-gray-400 transition-colors flex items-center justify-center gap-1"
        >
          {expanded ? "▲ fewer controls" : "▾ more controls"}
        </button>

        {expanded && (
          <div className="space-y-2 animate-fade-in">
            {/* Partial close row */}
            <div>
              <p className="text-gray-600 text-[10px] uppercase tracking-wider mb-1.5">Partial Close</p>
              <div className="grid grid-cols-3 gap-1.5">
                {(["close_25", "close_50", "close_75"] as ActionType[]).map((a) => (
                  <button
                    key={a}
                    disabled={pending}
                    onClick={() => setModal(a)}
                    className={`py-2 rounded-lg border text-xs font-semibold transition-all disabled:opacity-40 ${COLOR_CLASSES.orange.btn}`}
                  >
                    {ACTION_META[a].label}
                  </button>
                ))}
              </div>
            </div>

            {/* Position management row */}
            <div>
              <p className="text-gray-600 text-[10px] uppercase tracking-wider mb-1.5">Position Management</p>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  disabled={pending || breakevenActive}
                  onClick={() => setModal("breakeven")}
                  className={`py-2 rounded-lg border text-xs font-semibold transition-all disabled:opacity-40 ${breakevenActive ? "bg-yellow-500/20 border-yellow-500/50 text-yellow-300" : COLOR_CLASSES.yellow.btn}`}
                >
                  {breakevenActive ? "✓ Breakeven" : ACTION_META.breakeven.label}
                </button>
                <button
                  disabled={pending}
                  onClick={() => setModal(trailingActive ? "trailing_off" : "trailing_on")}
                  className={`py-2 rounded-lg border text-xs font-semibold transition-all disabled:opacity-40 ${trailingActive ? "bg-cyan-500/20 border-cyan-500/50 text-cyan-300" : COLOR_CLASSES.cyan.btn}`}
                >
                  {trailingActive ? "📏 Trailing ON" : "📏 Trailing OFF"}
                </button>
              </div>
              <div className="mt-1.5">
                <button
                  disabled={pending}
                  onClick={() => setModal("lock_profit")}
                  className={`w-full py-2 rounded-lg border text-xs font-semibold transition-all disabled:opacity-40 ${COLOR_CLASSES.purple.btn}`}
                >
                  {ACTION_META.lock_profit.label}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Notification ─────────────────────────────────────────────────── */}
      {notice && (
        <div className={`mt-2 px-3 py-2 rounded-lg text-xs font-semibold text-center transition-all ${
          notice.ok
            ? "bg-green-500/15 border border-green-500/30 text-green-400"
            : "bg-red-500/15 border border-red-500/30 text-red-400"
        }`}>
          {notice.ok ? "✓ " : "✗ "}{notice.text}
        </div>
      )}

      {/* ── Confirmation Modal ───────────────────────────────────────────── */}
      {modal && currentMeta && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) setModal(null); }}
        >
          <div className="bg-gray-900 border border-gray-700/80 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl">
            <h3 className="text-white font-black text-lg mb-1">{currentMeta.label}</h3>
            <p className="text-gray-500 text-xs mb-5">{currentMeta.confirm}</p>

            <div className="mb-6 space-y-0 bg-gray-800/40 rounded-xl px-3 py-1">
              <Row label="Symbol"        value={`${symbol}/USDT`} />
              {entry > 0 && <Row label="Entry"  value={`$${fmt(entry)}`} />}
              <Row label="Current"       value={`$${fmt(currentPrice)}`} />
              <Row
                label="Unrealised P&L"
                value={`${up ? "+" : ""}$${Math.abs(pnlUsd).toFixed(2)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%)`}
                color={up ? "text-green-400" : "text-red-400"}
              />
              {positionSize != null && positionSize > 0 && (
                <Row label="Position Size" value={`$${positionSize.toFixed(2)}`} />
              )}
              {modal.startsWith("close_") && (
                <Row
                  label="Closing"
                  value={modal === "close_25" ? "25% of position" : modal === "close_50" ? "50% of position" : "75% of position"}
                  color="text-orange-400"
                />
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setModal(null)}
                className="py-3 rounded-xl bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 font-semibold text-sm transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleConfirm()}
                className={`py-3 rounded-xl font-bold text-sm transition-all border ${COLOR_CLASSES[currentMeta.color].modal}`}
              >
                ✓ Confirm
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

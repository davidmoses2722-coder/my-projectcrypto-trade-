/**
 * TradeExecutor — Real Order Entry Panel
 * ─────────────────────────────────────────────────────────────────────────────
 * Full manual trading interface:
 *   • Coin selector with live price + 24h change
 *   • BUY / SELL toggle
 *   • USDT amount input + quick % buttons (10% / 25% / 50% / 100%)
 *   • TP / SL / Trailing stop inputs (optional)
 *   • Fee preview
 *   • Confirm modal before execution
 *   • Live execution log
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useCallback } from "react";
import { CoinPrice } from "../types/crypto";
import { ExecuteOrderParams, ExecutionResult } from "../hooks/useTradeExecutor";
import { checkBinanceKeys } from "../services/binance";
import { calcFee } from "../hooks/useTradeExecutor";

// ─── Props ───────────────────────────────────────────────────────────────────

interface TradeExecutorProps {
  prices:         CoinPrice[];
  usdtBalance:    number | null;
  isExecuting:    boolean;
  execLog:        string[];
  onExecute:      (params: ExecuteOrderParams) => Promise<ExecutionResult>;
  onRefreshBal:   () => void;
}

// ─── Coin emoji map ──────────────────────────────────────────────────────────

const COIN_EMOJI: Record<string, string> = {
  BTC: "₿", ETH: "Ξ", SOL: "◎", BNB: "⬡", XRP: "✕", ADA: "₳", AVAX: "🔺", DOGE: "Ð",
};

// ─── Component ───────────────────────────────────────────────────────────────

export function TradeExecutor({ prices, usdtBalance, isExecuting, execLog, onExecute, onRefreshBal }: TradeExecutorProps) {
  const isReal = checkBinanceKeys();

  const [symbol,       setSymbol]       = useState("BTC");
  const [side,         setSide]         = useState<"BUY" | "SELL">("BUY");
  const [usdtAmount,   setUsdtAmount]   = useState(100);
  const [tpEnabled,    setTpEnabled]    = useState(false);
  const [slEnabled,    setSlEnabled]    = useState(true);
  const [trailEnabled, setTrailEnabled] = useState(false);
  const [tpPct,        setTpPct]        = useState(3);
  const [slPct,        setSlPct]        = useState(1.5);
  const [trailPct,     setTrailPct]     = useState(1.5);
  const [strategy,     setStrategy]     = useState("manual");
  const [showConfirm,  setShowConfirm]  = useState(false);
  const [lastResult,   setLastResult]   = useState<ExecutionResult | null>(null);

  const coin      = prices.find(p => p.symbol === symbol);
  const price     = coin?.price ?? 0;
  const qty       = price > 0 ? usdtAmount / price : 0;
  const fee       = calcFee(usdtAmount);
  const tpPrice   = tpEnabled  ? price * (1 + (side === "BUY" ? tpPct : -tpPct) / 100)   : undefined;
  const slPrice   = slEnabled  ? price * (1 - (side === "BUY" ? slPct : -slPct) / 100)    : undefined;
  const rr        = (tpEnabled && slEnabled && slPct > 0) ? (tpPct / slPct).toFixed(2) : null;

  const maxUsdt   = usdtBalance ?? 10000;

  const handleConfirm = useCallback(async () => {
    setShowConfirm(false);
    const result = await onExecute({
      symbol,
      side,
      usdtAmount,
      tp:           tpPrice,
      sl:           slPrice,
      trailingStop: trailEnabled ? trailPct : undefined,
      entryReason:  "Manual order",
      strategy,
    });
    setLastResult(result);
  }, [symbol, side, usdtAmount, tpPrice, slPrice, trailEnabled, trailPct, strategy, onExecute]);

  return (
    <div className="space-y-4">

      {/* ── Mode badge ────────────────────────────────────────────────── */}
      <div className={`flex items-center justify-between px-4 py-2.5 rounded-xl border ${
        isReal
          ? "bg-green-500/10 border-green-500/30"
          : "bg-yellow-500/10 border-yellow-500/30"
      }`}>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full animate-pulse ${isReal ? "bg-green-400" : "bg-yellow-400"}`} />
          <span className={`text-xs font-bold ${isReal ? "text-green-400" : "text-yellow-400"}`}>
            {isReal ? "🔗 LIVE TRADING — Binance Connected" : "🔶 SIMULATION MODE — No Binance Keys"}
          </span>
        </div>
        {isReal && (
          <button onClick={onRefreshBal} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
            Refresh Balance
          </button>
        )}
      </div>

      {/* ── Balance display ───────────────────────────────────────────── */}
      {isReal && usdtBalance !== null && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex items-center justify-between">
          <span className="text-gray-500 text-xs">Available USDT</span>
          <span className="text-white font-bold text-lg">
            ${usdtBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

        {/* ══ LEFT — Order Form ══════════════════════════════════════════ */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-4">
          <h3 className="text-white font-bold text-sm flex items-center gap-2">
            <span>📝</span> Place Order
          </h3>

          {/* BUY / SELL toggle */}
          <div className="grid grid-cols-2 gap-2">
            {(["BUY", "SELL"] as const).map(s => (
              <button
                key={s}
                onClick={() => setSide(s)}
                className={`py-2.5 rounded-xl text-sm font-bold transition-all ${
                  side === s
                    ? s === "BUY"
                      ? "bg-green-500 text-white shadow-lg shadow-green-500/20"
                      : "bg-red-500 text-white shadow-lg shadow-red-500/20"
                    : "bg-gray-800 text-gray-500 hover:text-gray-300"
                }`}
              >
                {s === "BUY" ? "▲ LONG / BUY" : "▼ SHORT / SELL"}
              </button>
            ))}
          </div>

          {/* Coin selector */}
          <div>
            <label className="text-gray-500 text-xs block mb-2">Select Asset</label>
            <div className="grid grid-cols-4 gap-1.5">
              {prices.map(p => {
                const up = p.changePercent24h >= 0;
                return (
                  <button
                    key={p.symbol}
                    onClick={() => setSymbol(p.symbol)}
                    className={`flex flex-col items-center py-2 px-1 rounded-xl text-xs transition-all border ${
                      symbol === p.symbol
                        ? "bg-cyan-500/15 border-cyan-500/40 text-cyan-400"
                        : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600"
                    }`}
                  >
                    <span className="text-base leading-none mb-0.5">{COIN_EMOJI[p.symbol] ?? "●"}</span>
                    <span className="font-bold">{p.symbol}</span>
                    <span className={`text-xs ${up ? "text-green-400" : "text-red-400"}`}>
                      {up ? "+" : ""}{p.changePercent24h.toFixed(1)}%
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Live price */}
          {coin && (
            <div className="bg-gray-800/60 rounded-xl px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-xs">{coin.name} Price</p>
                <p className="text-white font-bold text-xl">
                  ${price >= 100
                    ? price.toLocaleString(undefined, { maximumFractionDigits: 1 })
                    : price.toFixed(4)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-gray-500 text-xs">24h Range</p>
                <p className="text-xs text-gray-400">
                  ${coin.low24h.toLocaleString(undefined, { maximumFractionDigits: 0 })} –
                  ${coin.high24h.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </p>
              </div>
            </div>
          )}

          {/* USDT Amount */}
          <div>
            <label className="text-gray-500 text-xs block mb-2">Amount (USDT)</label>
            <input
              type="number"
              value={usdtAmount}
              onChange={e => setUsdtAmount(Math.max(1, parseFloat(e.target.value) || 1))}
              className="w-full bg-gray-800 border border-gray-700 text-white text-lg rounded-xl px-4 py-2.5 focus:outline-none focus:border-cyan-500 transition-colors"
              min={1}
              step={10}
            />
            {/* Quick % buttons */}
            <div className="grid grid-cols-4 gap-1.5 mt-2">
              {[10, 25, 50, 100].map(pct => (
                <button
                  key={pct}
                  onClick={() => setUsdtAmount(Math.floor(maxUsdt * pct / 100))}
                  className="text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 hover:text-gray-200 rounded-lg py-1.5 transition-all"
                >
                  {pct}%
                </button>
              ))}
            </div>
          </div>

          {/* Strategy tag */}
          <div>
            <label className="text-gray-500 text-xs block mb-2">Strategy Tag</label>
            <div className="flex gap-2 flex-wrap">
              {["manual", "scalping", "swing", "dca", "sniper"].map(s => (
                <button
                  key={s}
                  onClick={() => setStrategy(s)}
                  className={`text-xs px-3 py-1 rounded-lg border transition-all capitalize ${
                    strategy === s
                      ? "bg-cyan-500/15 border-cyan-500/40 text-cyan-400"
                      : "bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* TP / SL / Trailing */}
          <div className="space-y-3 pt-1">
            <p className="text-gray-500 text-[13px] font-bold uppercase tracking-wider tracking-wider">Risk Management</p>

            {/* Take Profit */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setTpEnabled(v => !v)}
                className={`shrink-0 w-10 h-5 rounded-full transition-all ${tpEnabled ? "bg-green-500" : "bg-gray-700"} relative`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${tpEnabled ? "left-5" : "left-0.5"}`} />
              </button>
              <span className="text-xs text-gray-400 w-24 shrink-0">🎯 Take Profit</span>
              {tpEnabled && (
                <>
                  <input
                    type="number"
                    value={tpPct}
                    onChange={e => setTpPct(Math.max(0.1, parseFloat(e.target.value) || 0.1))}
                    className="w-16 bg-gray-800 border border-green-500/30 text-green-400 text-xs rounded-lg px-2 py-1 text-center focus:outline-none"
                    step={0.5} min={0.1}
                  />
                  <span className="text-xs text-gray-600">%</span>
                  <span className="text-xs text-green-400 ml-auto">
                    ${tpPrice?.toLocaleString(undefined, { maximumFractionDigits: price < 1 ? 5 : 1 })}
                  </span>
                </>
              )}
            </div>

            {/* Stop Loss */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSlEnabled(v => !v)}
                className={`shrink-0 w-10 h-5 rounded-full transition-all ${slEnabled ? "bg-red-500" : "bg-gray-700"} relative`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${slEnabled ? "left-5" : "left-0.5"}`} />
              </button>
              <span className="text-xs text-gray-400 w-24 shrink-0">🛑 Stop Loss</span>
              {slEnabled && (
                <>
                  <input
                    type="number"
                    value={slPct}
                    onChange={e => setSlPct(Math.max(0.1, parseFloat(e.target.value) || 0.1))}
                    className="w-16 bg-gray-800 border border-red-500/30 text-red-400 text-xs rounded-lg px-2 py-1 text-center focus:outline-none"
                    step={0.5} min={0.1}
                  />
                  <span className="text-xs text-gray-600">%</span>
                  <span className="text-xs text-red-400 ml-auto">
                    ${slPrice?.toLocaleString(undefined, { maximumFractionDigits: price < 1 ? 5 : 1 })}
                  </span>
                </>
              )}
            </div>

            {/* Trailing Stop */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setTrailEnabled(v => !v)}
                className={`shrink-0 w-10 h-5 rounded-full transition-all ${trailEnabled ? "bg-purple-500" : "bg-gray-700"} relative`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${trailEnabled ? "left-5" : "left-0.5"}`} />
              </button>
              <span className="text-xs text-gray-400 w-24 shrink-0">📏 Trailing</span>
              {trailEnabled && (
                <>
                  <input
                    type="number"
                    value={trailPct}
                    onChange={e => setTrailPct(Math.max(0.1, parseFloat(e.target.value) || 0.1))}
                    className="w-16 bg-gray-800 border border-purple-500/30 text-purple-400 text-xs rounded-lg px-2 py-1 text-center focus:outline-none"
                    step={0.5} min={0.1}
                  />
                  <span className="text-xs text-gray-600">%</span>
                </>
              )}
            </div>
          </div>

          {/* Order summary */}
          <div className="bg-gray-800/60 rounded-xl p-4 space-y-2 text-xs">
            <div className="flex justify-between text-gray-500">
              <span>Price</span>
              <span className="text-white">${price.toLocaleString(undefined, { maximumFractionDigits: price < 1 ? 5 : 1 })}</span>
            </div>
            <div className="flex justify-between text-gray-500">
              <span>Quantity</span>
              <span className="text-white">{qty.toFixed(6)} {symbol}</span>
            </div>
            <div className="flex justify-between text-gray-500">
              <span>USDT Amount</span>
              <span className="text-white">${usdtAmount.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-gray-500">
              <span>Est. Fee (0.075%)</span>
              <span className="text-yellow-400">-${fee.toFixed(4)}</span>
            </div>
            {rr && (
              <div className="flex justify-between text-gray-500">
                <span>Risk : Reward</span>
                <span className={parseFloat(rr) >= 2 ? "text-green-400" : parseFloat(rr) >= 1 ? "text-yellow-400" : "text-red-400"}>
                  1 : {rr}
                </span>
              </div>
            )}
            <div className="border-t border-gray-700 pt-2 flex justify-between font-bold">
              <span className="text-gray-400">Net After Fee</span>
              <span className="text-white">${(usdtAmount - fee).toFixed(2)}</span>
            </div>
          </div>

          {/* Execute button */}
          <button
            onClick={() => setShowConfirm(true)}
            disabled={isExecuting || usdtAmount <= 0 || price <= 0}
            className={`w-full py-3.5 rounded-xl font-black text-sm transition-all ${
              isExecuting
                ? "bg-gray-700 text-gray-500 cursor-wait"
                : side === "BUY"
                  ? "bg-green-500 hover:bg-green-400 text-white shadow-lg shadow-green-500/20 hover:shadow-green-500/30"
                  : "bg-red-500 hover:bg-red-400 text-white shadow-lg shadow-red-500/20 hover:shadow-red-500/30"
            }`}
          >
            {isExecuting ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Executing…
              </span>
            ) : (
              `${isReal ? "🔗 EXECUTE" : "🔶 SIMULATE"} ${side} ${symbol}`
            )}
          </button>

          {/* Last result */}
          {lastResult && (
            <div className={`rounded-xl px-4 py-3 text-xs border ${
              lastResult.success
                ? "bg-green-500/10 border-green-500/30 text-green-400"
                : "bg-red-500/10 border-red-500/30 text-red-400"
            }`}>
              {lastResult.success ? (
                <span>
                  ✅ {lastResult.isReal ? "LIVE" : "SIM"} order{lastResult.orderId ? ` #${lastResult.orderId}` : ""} placed
                </span>
              ) : (
                <span>❌ {lastResult.error}</span>
              )}
            </div>
          )}
        </div>

        {/* ══ RIGHT — Execution Log ══════════════════════════════════════ */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 flex flex-col">
          <h3 className="text-white font-bold text-sm flex items-center gap-2 mb-3">
            <span>📟</span> Execution Log
            <span className="ml-auto text-gray-600 text-xs font-normal">{execLog.length} entries</span>
          </h3>
          <div className="flex-1 overflow-y-auto space-y-1 max-h-96 scrollbar-hide">
            {execLog.length === 0 ? (
              <p className="text-gray-700 text-xs text-center py-8">No activity yet — place a trade to see the log</p>
            ) : (
              execLog.map((line, i) => (
                <p key={i} className={`text-xs leading-relaxed ${
                  line.includes("❌") ? "text-red-400" :
                  line.includes("✅") || line.includes("🏆") ? "text-green-400" :
                  line.includes("🛑") ? "text-red-300" :
                  line.includes("🔗") || line.includes("📐") ? "text-cyan-400" :
                  line.includes("🔶") ? "text-yellow-400" :
                  line.includes("🚀") ? "text-purple-400" :
                  "text-gray-500"
                }`}>
                  {line}
                </p>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Confirm modal ─────────────────────────────────────────────────── */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-sm space-y-5">
            <h3 className="text-white font-black text-lg text-center">
              {side === "BUY" ? "🟢" : "🔴"} Confirm {side}
            </h3>

            <div className="space-y-2 text-sm">
              {[
                ["Asset",   `${symbol}/USDT`],
                ["Side",    side],
                ["Price",   `$${price.toLocaleString(undefined, { maximumFractionDigits: price < 1 ? 5 : 1 })}`],
                ["Amount",  `$${usdtAmount.toLocaleString()} USDT`],
                ["Qty",     `${qty.toFixed(6)} ${symbol}`],
                ["Fee",     `-$${fee.toFixed(4)}`],
                ...(tpPrice ? [["Take Profit", `$${tpPrice.toLocaleString(undefined, { maximumFractionDigits: price < 1 ? 5 : 1 })}`]] : []),
                ...(slPrice ? [["Stop Loss",   `$${slPrice.toLocaleString(undefined, { maximumFractionDigits: price < 1 ? 5 : 1 })}`]] : []),
                ["Mode",    isReal ? "🔗 LIVE — Will execute on Binance" : "🔶 SIMULATION"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <span className="text-gray-500">{k}</span>
                  <span className={`font-semibold text-xs ${
                    v?.toString().includes("LIVE") ? "text-green-400" :
                    v?.toString().includes("SIM") ? "text-yellow-400" :
                    k === "Fee" ? "text-yellow-400" : "text-white"
                  }`}>{v}</span>
                </div>
              ))}
            </div>

            {isReal && (
              <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl px-3 py-2 text-xs text-orange-400 text-center">
                ⚠️ This will place a REAL order on Binance. Funds will be used.
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-semibold transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                className={`py-2.5 rounded-xl text-white text-sm font-black transition-all ${
                  side === "BUY"
                    ? "bg-green-500 hover:bg-green-400"
                    : "bg-red-500 hover:bg-red-400"
                }`}
              >
                {isReal ? "EXECUTE NOW" : "SIMULATE"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

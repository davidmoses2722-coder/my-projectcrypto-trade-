/**
 * useTradeExecutor — Real Trade Execution Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles manual + automated order placement with full lifecycle:
 *   open → (TP / SL / trailing / manual close) → closed
 *
 * • Routes BTC orders through  order() + size()  (exact provided API)
 * • Routes other coins through placeMarketOrder() (quoteOrderQty)
 * • Simulates execution when no Binance keys are configured
 * • Tracks fees (0.075% taker per side = 0.15% round-trip)
 * • Sends Telegram alerts at every lifecycle event
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { Trade, CoinPrice } from "../types/crypto";
import {
  checkBinanceKeys,
  order,
  size,
  placeMarketOrder,
  fetchAccountInfo,
  SYMBOL_MAP,
} from "../services/binance";
import {
  telegramAlert,
  notifyTradeOpen,
  notifyTradeClosed,
  hasValidTelegramConfig,
} from "../services/telegram";
import { INITIAL_TRADES } from "../data/mockData";

// ─── Constants ───────────────────────────────────────────────────────────────

const TAKER_FEE = 0.00075; // 0.075% taker fee (Binance default)

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ExecuteOrderParams {
  symbol:        string;
  side:          "BUY" | "SELL";
  usdtAmount:    number;
  tp?:           number;   // take-profit price
  sl?:           number;   // stop-loss price
  trailingStop?: number;   // trailing stop % (e.g. 1.5 = 1.5%)
  entryReason?:  string;
  strategy?:     string;
  tags?:         string[];
}

export interface ExecutionResult {
  success:  boolean;
  trade?:   Trade;
  error?:   string;
  orderId?: string;
  isReal:   boolean;
}

export interface TradeExecutorState {
  isExecuting: boolean;
  lastError:   string | null;
  execLog:     string[];
  usdtBalance: number | null;
}

// ─── Fee helpers ─────────────────────────────────────────────────────────────

export function calcFee(notional: number): number {
  return parseFloat((notional * TAKER_FEE).toFixed(4));
}

export function calcNet(pnl: number, entryNotional: number, exitNotional: number): number {
  return parseFloat((pnl - calcFee(entryNotional) - calcFee(exitNotional)).toFixed(4));
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useTradeExecutor(prices: CoinPrice[]) {
  const [trades, setTrades]   = useState<Trade[]>(INITIAL_TRADES.map(t => ({
    ...t,
    isReal:      false,
    fees:        calcFee(t.total),
    tp:          t.price * 1.03,
    sl:          t.price * 0.985,
    entryReason: "Initial seed trade",
    strategy:    "swing",
  })));

  const [state, setState] = useState<TradeExecutorState>({
    isExecuting: false,
    lastError:   null,
    execLog:     ["⚡ Trade executor ready.", hasValidTelegramConfig ? "📲 Telegram alerts: ON" : "📵 Telegram alerts: OFF"],
    usdtBalance: null,
  });

  const tickRef = useRef(0);

  // ── Log helper ──────────────────────────────────────────────────────────
  const addLog = useCallback((msg: string) => {
    setState(s => ({
      ...s,
      execLog: [`[${new Date().toLocaleTimeString()}] ${msg}`, ...s.execLog.slice(0, 99)],
    }));
  }, []);

  // ── Refresh USDT balance ─────────────────────────────────────────────────
  const refreshBalance = useCallback(async () => {
    if (!checkBinanceKeys()) return;
    try {
      const acct = await fetchAccountInfo();
      const usdt = acct.balances.find(b => b.asset === "USDT");
      const bal  = usdt ? parseFloat(usdt.free) : null;
      setState(s => ({ ...s, usdtBalance: bal }));
      if (bal !== null) addLog(`💰 Balance refreshed: $${bal.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDT`);
    } catch (e) {
      addLog(`⚠️ Balance fetch failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [addLog]);

  // ─────────────────────────────────────────────────────────────────────────
  // executeOrder — the main entry point
  // ─────────────────────────────────────────────────────────────────────────
  const executeOrder = useCallback(async (params: ExecuteOrderParams): Promise<ExecutionResult> => {
    const { symbol, side, usdtAmount, tp, sl, trailingStop, entryReason, strategy, tags } = params;

    setState(s => ({ ...s, isExecuting: true, lastError: null }));
    addLog(`🚀 Executing ${side} ${symbol} — $${usdtAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

    const currentPrice = prices.find(p => p.symbol === symbol)?.price;
    if (!currentPrice) {
      const err = `No live price for ${symbol}`;
      setState(s => ({ ...s, isExecuting: false, lastError: err }));
      addLog(`❌ ${err}`);
      return { success: false, error: err, isReal: false };
    }

    const amount  = parseFloat((usdtAmount / currentPrice).toFixed(6));
    const fees    = calcFee(usdtAmount);
    const isReal  = checkBinanceKeys();

    addLog(`📐 Entry: $${currentPrice.toLocaleString()} | Qty: ${amount} ${symbol} | Fee: $${fees.toFixed(4)}`);
    if (tp)           addLog(`🎯 TP set @ $${tp.toLocaleString()}`);
    if (sl)           addLog(`🛑 SL set @ $${sl.toLocaleString()}`);
    if (trailingStop) addLog(`📏 Trailing stop: ${trailingStop}%`);

    let orderId: string | undefined;

    // ── Send to Binance (or simulate) ────────────────────────────────────
    if (isReal) {
      try {
        addLog(`🔗 Sending order to Binance (${SYMBOL_MAP[symbol] || symbol})…`);

        let result;
        if (symbol === "BTC") {
          // Use exact provided order() + size() API for BTC
          let balance = usdtAmount;
          try {
            const acct  = await fetchAccountInfo();
            const usdt  = acct.balances.find(b => b.asset === "USDT");
            balance     = usdt ? parseFloat(usdt.free) : usdtAmount;
            setState(s => ({ ...s, usdtBalance: balance }));
          } catch { /* use fallback */ }

          const qty = size(balance, currentPrice);
          addLog(`📐 BTC qty via size(): ${qty} BTC (1% of $${balance.toFixed(2)})`);
          result  = await order(side, qty);
        } else {
          result  = await placeMarketOrder(symbol, side, usdtAmount);
        }

        orderId = String(result.orderId);
        addLog(`✅ ORDER FILLED on Binance | ID: ${orderId} | Status: ${result.status}`);
        addLog(`   Executed: ${result.executedQty} ${symbol} | Quote: $${parseFloat(result.cummulativeQuoteQty).toFixed(2)}`);

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setState(s => ({ ...s, isExecuting: false, lastError: msg }));
        addLog(`❌ Binance order FAILED: ${msg}`);
        telegramAlert(`❌ ORDER FAILED — ${side} ${symbol}\n${msg}\n⏰ ${new Date().toLocaleString()}`);
        return { success: false, error: msg, isReal: true };
      }
    } else {
      addLog(`🔶 SIMULATION mode — no Binance keys. Order simulated at $${currentPrice.toLocaleString()}`);
      orderId = `SIM-${Date.now()}`;
    }

    // ── Build trade record ───────────────────────────────────────────────
    const trade: Trade = {
      id:           `tr-${Date.now()}-${symbol}`,
      coin:         symbol,
      symbol,
      type:         side,
      amount,
      price:        currentPrice,
      total:        usdtAmount,
      pnl:          0,
      pnlPercent:   0,
      timestamp:    new Date(),
      status:       "open",
      orderId,
      fees,
      realised:     0,
      isReal,
      tp,
      sl,
      trailingStop: trailingStop ?? 0,
      highWater:    currentPrice,
      entryReason:  entryReason ?? "Manual order",
      strategy:     strategy ?? "manual",
      tags:         tags ?? [],
    };

    setTrades(prev => [trade, ...prev.slice(0, 49)]);

    // ── Telegram notification ────────────────────────────────────────────
    if (hasValidTelegramConfig) {
      notifyTradeOpen({
        type:   side,
        symbol,
        amount,
        price:  currentPrice,
        total:  usdtAmount,
      });
      if (tp || sl) {
        telegramAlert(
          `📋 ${isReal ? "LIVE" : "SIM"} ${side} ${symbol}\n` +
          `Entry: $${currentPrice.toLocaleString()}\n` +
          (tp ? `🎯 TP: $${tp.toLocaleString()}\n` : "") +
          (sl ? `🛑 SL: $${sl.toLocaleString()}\n` : "") +
          `Fee: $${fees.toFixed(4)}\n⏰ ${new Date().toLocaleString()}`
        );
      }
    }

    setState(s => ({ ...s, isExecuting: false }));
    return { success: true, trade, orderId, isReal };
  }, [prices, addLog]);

  // ─────────────────────────────────────────────────────────────────────────
  // closePosition — close an open trade at market price
  // ─────────────────────────────────────────────────────────────────────────
  const closePosition = useCallback(async (tradeId: string, reason: Trade["exitReason"] = "MANUAL"): Promise<ExecutionResult> => {
    const trade = trades.find(t => t.id === tradeId);
    if (!trade || trade.status !== "open") {
      return { success: false, error: "Trade not found or already closed", isReal: false };
    }

    const currentPrice = prices.find(p => p.symbol === trade.symbol)?.price;
    if (!currentPrice) {
      return { success: false, error: `No live price for ${trade.symbol}`, isReal: false };
    }

    addLog(`🔒 Closing ${trade.type} ${trade.symbol} @ $${currentPrice.toLocaleString()} — reason: ${reason}`);

    const isReal = checkBinanceKeys() && !!trade.isReal;
    let orderId: string | undefined;

    // ── Send close order to Binance ──────────────────────────────────────
    if (isReal) {
      try {
        const closeSide: "BUY" | "SELL" = trade.type === "BUY" ? "SELL" : "BUY";
        let result;
        if (trade.symbol === "BTC") {
          result  = await order(closeSide, trade.amount);
        } else {
          result  = await placeMarketOrder(trade.symbol, closeSide, trade.total);
        }
        orderId = String(result.orderId);
        addLog(`✅ CLOSE ORDER FILLED on Binance | ID: ${orderId}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        addLog(`❌ Close order failed: ${msg}`);
        telegramAlert(`❌ CLOSE FAILED — ${trade.symbol}\n${msg}`);
        return { success: false, error: msg, isReal: true };
      }
    }

    // ── Calculate final PnL ──────────────────────────────────────────────
    const rawPnl = trade.type === "BUY"
      ? (currentPrice - trade.price) * trade.amount
      : (trade.price - currentPrice) * trade.amount;

    const exitFees  = calcFee(currentPrice * trade.amount);
    const entryFees = trade.fees ?? calcFee(trade.total);
    const realised  = calcNet(rawPnl, trade.total, currentPrice * trade.amount);
    const pnlPct    = (rawPnl / trade.total) * 100;
    const duration  = Date.now() - trade.timestamp.getTime();

    setTrades(prev => prev.map(t => {
      if (t.id !== tradeId) return t;
      return {
        ...t,
        status:     "closed",
        exitPrice:  currentPrice,
        exitTime:   new Date(),
        exitReason: reason,
        pnl:        rawPnl,
        pnlPercent: pnlPct,
        fees:       entryFees + exitFees,
        realised,
        duration,
      };
    }));

    addLog(
      `${rawPnl >= 0 ? "🏆" : "📉"} CLOSED ${trade.symbol}: ` +
      `${rawPnl >= 0 ? "+" : ""}$${rawPnl.toFixed(2)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%) ` +
      `| Net: $${realised.toFixed(2)} | ${reason}`
    );

    // ── Telegram close notification ──────────────────────────────────────
    if (hasValidTelegramConfig) {
      notifyTradeClosed({
        type:       trade.type,
        symbol:     trade.symbol,
        amount:     trade.amount,
        entryPrice: trade.price,
        exitPrice:  currentPrice,
        pnl:        rawPnl,
        pnlPercent: pnlPct,
        reason:     (reason === "TP" || reason === "SL" ? reason : "MANUAL") as "TP" | "SL" | "MANUAL",
      });
    }

    return { success: true, orderId, isReal };
  }, [trades, prices, addLog]);

  // ─────────────────────────────────────────────────────────────────────────
  // TP / SL / Trailing stop watcher — runs every 3 seconds
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      tickRef.current += 1;

      setTrades(prev => {
        let changed = false;
        const next  = prev.map(trade => {
          if (trade.status !== "open") return trade;

          const coin = prices.find(p => p.symbol === trade.symbol);
          if (!coin) return trade;

          const cp   = coin.price;
          let   hw   = Math.max(trade.highWater ?? trade.price, cp);

          // Unrealized PnL
          const rawPnl    = trade.type === "BUY"
            ? (cp - trade.price) * trade.amount
            : (trade.price - cp) * trade.amount;
          const pnlPct    = (rawPnl / trade.total) * 100;
          const updated   = { ...trade, pnl: rawPnl, pnlPercent: pnlPct, highWater: hw };

          // ── Trailing stop update ────────────────────────────────────────
          if (trade.trailingStop && trade.trailingStop > 0 && trade.type === "BUY") {
            const trailPrice = hw * (1 - trade.trailingStop / 100);
            if (cp <= trailPrice) {
              changed = true;
              addLog(`📏 TRAILING STOP HIT: ${trade.symbol} @ $${cp.toLocaleString()} (trail: $${trailPrice.toLocaleString()})`);
              if (hasValidTelegramConfig) {
                telegramAlert(
                  `📏 TRAILING STOP — ${trade.symbol}\n` +
                  `Exit: $${cp.toLocaleString()} | Net: $${calcNet(rawPnl, trade.total, cp * trade.amount).toFixed(2)}`
                );
              }
              return {
                ...updated,
                status:     "closed" as const,
                exitPrice:  cp,
                exitTime:   new Date(),
                exitReason: "TRAILING" as const,
                realised:   calcNet(rawPnl, trade.total, cp * trade.amount),
                duration:   Date.now() - trade.timestamp.getTime(),
              };
            }
          }

          // ── Take-profit ─────────────────────────────────────────────────
          const tpHit = trade.tp && (
            trade.type === "BUY"  ? cp >= trade.tp :
            trade.type === "SELL" ? cp <= trade.tp : false
          );

          if (tpHit) {
            changed = true;
            const fees = calcFee(cp * trade.amount);
            const net  = calcNet(rawPnl, trade.total, cp * trade.amount);
            addLog(`🏆 TAKE PROFIT HIT: ${trade.symbol} +$${rawPnl.toFixed(2)} (+${pnlPct.toFixed(2)}%) | Net: $${net.toFixed(2)}`);
            if (hasValidTelegramConfig) {
              telegramAlert(
                `🏆 TAKE PROFIT — ${trade.symbol}\n` +
                `+$${rawPnl.toFixed(2)} (+${pnlPct.toFixed(2)}%)\nFees: $${fees.toFixed(4)} | Net: $${net.toFixed(2)}\n` +
                `⏰ ${new Date().toLocaleString()}`
              );
              notifyTradeClosed({ type: trade.type, symbol: trade.symbol, amount: trade.amount, entryPrice: trade.price, exitPrice: cp, pnl: rawPnl, pnlPercent: pnlPct, reason: "TP" as "TP" });
            }
            return {
              ...updated,
              status:     "closed" as const,
              exitPrice:  cp,
              exitTime:   new Date(),
              exitReason: "TP" as const,
              realised:   net,
              fees:       (trade.fees ?? 0) + fees,
              duration:   Date.now() - trade.timestamp.getTime(),
            };
          }

          // ── Stop-loss ───────────────────────────────────────────────────
          const slHit = trade.sl && (
            trade.type === "BUY"  ? cp <= trade.sl :
            trade.type === "SELL" ? cp >= trade.sl : false
          );

          if (slHit) {
            changed = true;
            const fees = calcFee(cp * trade.amount);
            const net  = calcNet(rawPnl, trade.total, cp * trade.amount);
            addLog(`🛑 STOP LOSS HIT: ${trade.symbol} $${rawPnl.toFixed(2)} (${pnlPct.toFixed(2)}%) | Net: $${net.toFixed(2)}`);
            if (hasValidTelegramConfig) {
              telegramAlert(
                `🛑 STOP LOSS — ${trade.symbol}\n` +
                `$${rawPnl.toFixed(2)} (${pnlPct.toFixed(2)}%)\nFees: $${fees.toFixed(4)} | Net: $${net.toFixed(2)}\n` +
                `⏰ ${new Date().toLocaleString()}`
              );
              notifyTradeClosed({ type: trade.type, symbol: trade.symbol, amount: trade.amount, entryPrice: trade.price, exitPrice: cp, pnl: rawPnl, pnlPercent: pnlPct, reason: "SL" as "SL" });
            }
            return {
              ...updated,
              status:     "closed" as const,
              exitPrice:  cp,
              exitTime:   new Date(),
              exitReason: "SL" as const,
              realised:   net,
              fees:       (trade.fees ?? 0) + fees,
              duration:   Date.now() - trade.timestamp.getTime(),
            };
          }

          if (changed || updated.pnl !== trade.pnl) changed = true;
          return updated;
        });
        return changed ? next : prev;
      });
    }, 3000);

    return () => clearInterval(interval);
  }, [prices, addLog]);

  // ── Derived totals ───────────────────────────────────────────────────────
  const openTrades   = trades.filter(t => t.status === "open");
  const closedTrades = trades.filter(t => t.status === "closed");

  const totalUnrealized = openTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const totalRealised   = closedTrades.reduce((s, t) => s + (t.realised ?? t.pnl ?? 0), 0);
  const totalFees       = trades.reduce((s, t) => s + (t.fees ?? 0), 0);
  const totalPnL        = totalUnrealized + totalRealised;

  return {
    trades,
    openTrades,
    closedTrades,
    totalPnL,
    totalRealised,
    totalUnrealized,
    totalFees,
    executeOrder,
    closePosition,
    refreshBalance,
    state,
    addLog,
  };
}

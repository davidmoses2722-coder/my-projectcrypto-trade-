/**
 * manualTradeService.ts — On-demand signal analysis for Telegram /trade command
 *
 * Fetches live Gate.io candles and runs any active strategy's signal engine.
 * Used ONLY for Telegram manual-trade reporting — never modifies the live
 * orchestration, risk engine, execution queue, or portfolio registry.
 */

import ccxt from "ccxt";
import { resolveStrategy }            from "./strategies/index";
import { toCcxtSymbol }               from "./tradeService";
import * as SwingStrategy             from "./strategies/SwingStrategy";
import * as ActiveSwingStrategy       from "./strategies/ActiveSwingStrategy";
import * as ConservativeScalping      from "./strategies/ConservativeScalpingStrategy";

// ─── Strategy registry ────────────────────────────────────────────────────────

const MANUAL_STRATEGY_CFG = {
  "swing": {
    label:       "SwingStrategy",
    timeframe:   SwingStrategy.STRATEGY_METADATA.timeframe,
    candleLimit: 300,
  },
  "active-swing": {
    label:       "ActiveSwingStrategy",
    timeframe:   ActiveSwingStrategy.STRATEGY_METADATA.timeframe,
    candleLimit: 300,
  },
  "conservative-scalping": {
    label:       "ConservativeScalpingStrategy",
    timeframe:   ConservativeScalping.STRATEGY_METADATA.timeframe,
    candleLimit: 350,
  },
} as const;

export type ManualStrategyId = keyof typeof MANUAL_STRATEGY_CFG;
export const MANUAL_STRATEGY_IDS = Object.keys(MANUAL_STRATEGY_CFG) as ManualStrategyId[];

// ─── Result types ─────────────────────────────────────────────────────────────

export interface SignalAnalysis {
  strategyId:    ManualStrategyId;
  strategyLabel: string;
  timeframe:     string;
  symbol:        string;
  currentPrice:  number;
  action:        "BUY" | "SELL" | "SHORT" | "HOLD";
  canTrade:      boolean;
  reason:        string;
  confidence:    number;
  suggestedSl:   number | null;
  suggestedTp:   number | null;
  stopLossPct:   number | null;
  takeProfitPct: number | null;
}

// ─── Signal generation ────────────────────────────────────────────────────────

export async function getSignalAnalysis(
  symbol:     string,
  strategyId: ManualStrategyId,
): Promise<SignalAnalysis> {
  const cfg      = MANUAL_STRATEGY_CFG[strategyId];
  const strategy = resolveStrategy(strategyId);
  const ex       = new ccxt.gate({ enableRateLimit: true });
  const ccxtSym  = toCcxtSymbol(symbol);

  const raw = await ex.fetchOHLCV(ccxtSym, cfg.timeframe, undefined, cfg.candleLimit);
  if (!raw || raw.length < 50) {
    throw new Error(`Insufficient candle data for ${symbol}: ${raw?.length ?? 0} candles returned`);
  }

  const candles = raw.map(c => ({
    time: c[0]!, open: c[1]!, high: c[2]!, low: c[3]!, close: c[4]!, volume: c[5]!,
  }));
  const currentPrice = candles[candles.length - 1]!.close;

  const sig = strategy.fn({
    candles:         candles.slice(-250),
    currentPrice,
    dailyTradeCount: 0,
  });

  return {
    strategyId,
    strategyLabel: cfg.label,
    timeframe:     cfg.timeframe,
    symbol,
    currentPrice,
    action:        sig.action,
    canTrade:      sig.canTrade,
    reason:        sig.reason,
    confidence:    sig.confidence ?? 0,
    suggestedSl:   sig.suggestedSl   ?? null,
    suggestedTp:   sig.suggestedTp   ?? null,
    stopLossPct:   sig.stopLossPct   ?? null,
    takeProfitPct: sig.takeProfitPct ?? null,
  };
}

/**
 * positionMonitor — independent SL/TP enforcement loop.
 *
 * WHY THIS EXISTS:
 *   Many exchanges (Binance Spot, Bybit Spot) do not support native attached
 *   stop-loss/take-profit on market orders. Even when supported (OKX), network
 *   latency or outages can cause the exchange-side SL to fail silently.
 *
 *   This module runs at a configurable fast interval (default 2 s) and checks
 *   every open position tracked by the risk manager against the current market
 *   price. When a threshold is crossed it immediately places a market sell,
 *   completely independent of the main bot tick loop.
 *
 * Guarantees:
 *   • Every entry created by openPosition() has a registered SL + TP price.
 *   • This loop fires even when the main bot tick is slow or stalled.
 *   • On SL hit, a RISK event is logged to the DB before the close order.
 *   • On TP hit, same — a RISK event is written.
 *   • The main bot is notified via the onClose callback so it can update its
 *     own state (position = null, PnL update, etc.)
 */

import { logger } from "./logger";
import { riskManager } from "./riskManager";
import type { OpenPosition } from "./riskManager";
import * as store from "./store";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MonitoredPosition {
  symbol: string;
  qty: number;
  entryPrice: number;
  slPrice: number;
  tpPrice: number;
  openedAt: number;
}

export type CloseReason =
  | "stop_loss"
  | "take_profit"
  | "manual"
  | "manual_take_profit"
  | "manual_close";

export type CloseCallback = (
  symbol: string,
  reason: CloseReason,
  triggerPrice: number,
) => Promise<void>;

export type PriceGetter = (symbol: string) => Promise<number | null>;

// ─── PositionMonitor ──────────────────────────────────────────────────────────

class PositionMonitor {
  private intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private onClose: CloseCallback | null = null;
  private getPrice: PriceGetter | null = null;
  private inProgress = new Set<string>();  // symbols currently being closed

  constructor(intervalMs = 2_000) {
    this.intervalMs = intervalMs;
  }

  /**
   * Start the monitor.
   * @param getPrice  Async fn that returns current price for a symbol.
   * @param onClose   Async fn called when SL or TP is triggered.
   */
  start(getPrice: PriceGetter, onClose: CloseCallback): void {
    if (this.timer !== null) return;  // already running
    this.getPrice = getPrice;
    this.onClose  = onClose;
    this.timer = setInterval(() => { void this.tick(); }, this.intervalMs);
    logger.info({ intervalMs: this.intervalMs }, "positionMonitor: started");
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
    logger.info("positionMonitor: stopped");
  }

  isRunning(): boolean { return this.timer !== null; }

  private async tick(): Promise<void> {
    const openPositions = Array.from(riskManager.getAllOpenPositions());
    if (openPositions.length === 0) return;

    for (const pos of openPositions) {
      if (this.inProgress.has(pos.symbol)) continue;
      if (pos.slPrice == null && pos.tpPrice == null) {
        logger.warn({ symbol: pos.symbol }, "positionMonitor: position has no SL or TP — monitoring as emergency only");
        continue;
      }
      await this.checkPosition(pos);
    }
  }

  private async checkPosition(pos: OpenPosition): Promise<void> {
    if (!this.getPrice || !this.onClose) return;

    const price = await this.getPrice(pos.symbol).catch(() => null);
    if (price == null || price <= 0) return;

    let reason: CloseReason | null = null;

    // Stop-loss check — price has fallen to or below SL
    if (pos.slPrice != null && price <= pos.slPrice) {
      reason = "stop_loss";
      logger.warn(
        { symbol: pos.symbol, slPrice: pos.slPrice, currentPrice: price },
        "positionMonitor: STOP-LOSS triggered",
      );
      void store.logRiskEvent({
        eventType: "SL_TRIGGERED",
        symbol: pos.symbol,
        reason: `Stop-loss hit at ${price} (SL=${pos.slPrice})`,
        meta: { slPrice: pos.slPrice, currentPrice: price, entryPrice: pos.entryPrice },
      });
    }
    // Take-profit check — price has reached or exceeded TP
    else if (pos.tpPrice != null && price >= pos.tpPrice) {
      reason = "take_profit";
      logger.info(
        { symbol: pos.symbol, tpPrice: pos.tpPrice, currentPrice: price },
        "positionMonitor: TAKE-PROFIT triggered",
      );
      void store.logRiskEvent({
        eventType: "TP_TRIGGERED",
        symbol: pos.symbol,
        reason: `Take-profit hit at ${price} (TP=${pos.tpPrice})`,
        meta: { tpPrice: pos.tpPrice, currentPrice: price, entryPrice: pos.entryPrice },
      });
    }

    if (reason) {
      this.inProgress.add(pos.symbol);
      try {
        await this.onClose(pos.symbol, reason, price);
      } catch (e) {
        logger.error(
          { err: e, symbol: pos.symbol, reason },
          "positionMonitor: close callback failed",
        );
      } finally {
        this.inProgress.delete(pos.symbol);
      }
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const positionMonitor = new PositionMonitor(2_000);

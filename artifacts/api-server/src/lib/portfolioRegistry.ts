/**
 * portfolioRegistry — centralized in-memory multi-position registry.
 *
 * Tracks every open position across all symbols and strategy engines.
 * Acts as the source-of-truth for:
 *   • Multiple simultaneous positions (up to config.maxOpenPositions)
 *   • Per-symbol and per-strategy allocation limits
 *   • Total USDT exposure tracking
 *   • Live unrealized PnL (updated via updatePrice each tick)
 *   • canOpen() guard evaluated before every new entry
 *
 * All mutations are synchronous (in-memory only) — no DB/Redis dependency.
 * The bot.ts tick loop calls updatePrice() every tick for live PnL.
 */

import { notify } from "./telegramNotifier";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PortfolioPosition {
  id: string;               // orderId string — registry key
  symbol: string;
  strategy: string;         // engine name, e.g. "ScalpingStrategy"
  side: "long";
  entryPrice: number;
  qty: number;
  sizeUsdt: number;         // notional USDT at entry time
  slPrice: number;
  tpPrice: number;
  openedAt: number;         // Unix ms
  lastPrice: number;        // updated every tick
  unrealizedPnl: number;    // (lastPrice - entryPrice) * qty
  unrealizedPnlPct: number; // (unrealizedPnl / sizeUsdt) * 100
  dryRun: boolean;
}

export interface PortfolioConfig {
  maxTotalExposureUsdt: number;  // hard cap on total concurrent USDT exposure
  maxOpenPositions: number;      // max concurrent open positions (across all symbols)
  maxPerSymbol: number;          // max positions per trading pair
  maxPerStrategy: number;        // max positions per strategy engine
}

export interface PortfolioSnapshot {
  positions: PortfolioPosition[];
  openCount: number;
  totalExposureUsdt: number;
  totalUnrealizedPnl: number;
  bySymbol: Record<string, { count: number; exposureUsdt: number; unrealizedPnl: number }>;
  byStrategy: Record<string, { count: number; exposureUsdt: number }>;
  config: PortfolioConfig;
}

export interface OpenGuardResult {
  allowed: boolean;
  reason?: string;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_PORTFOLIO_CONFIG: PortfolioConfig = {
  maxTotalExposureUsdt: 1_000,
  maxOpenPositions:     5,
  maxPerSymbol:         1,
  maxPerStrategy:       1,
};

// ─── Registry class ───────────────────────────────────────────────────────────

class PortfolioRegistry {
  private positions = new Map<string, PortfolioPosition>();
  private cfg: PortfolioConfig = { ...DEFAULT_PORTFOLIO_CONFIG };

  // ── Config ────────────────────────────────────────────────────────────────

  updateConfig(patch: Partial<PortfolioConfig>): void {
    this.cfg = { ...this.cfg, ...patch };
  }

  getConfig(): PortfolioConfig {
    return { ...this.cfg };
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  /** Register a newly filled position. Called from handleEntryFilled. */
  register(params: {
    id:         string;
    symbol:     string;
    strategy:   string;
    entryPrice: number;
    qty:        number;
    sizeUsdt:   number;
    slPrice:    number;
    tpPrice:    number;
    dryRun:     boolean;
    openedAt?:  number;   // preserved on restore; defaults to now for new fills
  }): void {
    const pos: PortfolioPosition = {
      ...params,
      side:             "long",
      openedAt:         params.openedAt ?? Date.now(),
      lastPrice:        params.entryPrice,
      unrealizedPnl:    0,
      unrealizedPnlPct: 0,
    };
    this.positions.set(params.id, pos);
    // Notify when total exposure crosses 80% of max after this registration
    const totalExp = this.getTotalExposure();
    const maxExp   = this.cfg.maxTotalExposureUsdt;
    if (maxExp > 0 && totalExp / maxExp >= 0.8) {
      notify("PORTFOLIO_HIGH_EXPOSURE", {
        exposureUsdt: totalExp,
        maxUsdt:      maxExp,
        pct:          ((totalExp / maxExp) * 100).toFixed(1),
      }, "exposure");
    }
  }

  /** Remove a closed position. Returns true if it was found. */
  deregister(id: string): boolean {
    return this.positions.delete(id);
  }

  /**
   * Update the current market price for every open position in a given symbol.
   * Called on every tick so the UI shows live unrealized PnL.
   */
  updatePrice(symbol: string, price: number): void {
    for (const pos of this.positions.values()) {
      if (pos.symbol === symbol) {
        pos.lastPrice        = price;
        pos.unrealizedPnl    = (price - pos.entryPrice) * pos.qty;
        pos.unrealizedPnlPct = pos.sizeUsdt > 0
          ? (pos.unrealizedPnl / pos.sizeUsdt) * 100
          : 0;
      }
    }
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  getAll(): PortfolioPosition[] {
    return Array.from(this.positions.values()).sort((a, b) => a.openedAt - b.openedAt);
  }

  /** Total USDT currently deployed across all open positions. */
  getTotalExposure(): number {
    let total = 0;
    for (const p of this.positions.values()) total += p.sizeUsdt;
    return total;
  }

  /**
   * Gate check — call this before every entry.
   * Returns { allowed: false, reason } when any limit is breached.
   */
  canOpen(symbol: string, strategy: string, sizeUsdt: number): OpenGuardResult {
    const all = this.getAll();
    const { cfg } = this;

    // Max total concurrent positions
    if (all.length >= cfg.maxOpenPositions) {
      const reason = `Portfolio: max ${cfg.maxOpenPositions} concurrent positions reached (${all.length} open)`;
      notify("PORTFOLIO_LIMIT_REACHED", { reason }, "limit");
      return { allowed: false, reason };
    }

    // Max total exposure
    const totalExposure = this.getTotalExposure();
    if (totalExposure + sizeUsdt > cfg.maxTotalExposureUsdt) {
      return {
        allowed: false,
        reason: `Portfolio: max exposure $${cfg.maxTotalExposureUsdt} would be exceeded ($${(totalExposure + sizeUsdt).toFixed(2)})`,
      };
    }

    // Max per symbol
    const symbolCount = all.filter(p => p.symbol === symbol).length;
    if (symbolCount >= cfg.maxPerSymbol) {
      return {
        allowed: false,
        reason: `Portfolio: already ${symbolCount}/${cfg.maxPerSymbol} position(s) open for ${symbol}`,
      };
    }

    // Max per strategy
    const stratCount = all.filter(p => p.strategy === strategy).length;
    if (stratCount >= cfg.maxPerStrategy) {
      return {
        allowed: false,
        reason: `Portfolio: already ${stratCount}/${cfg.maxPerStrategy} position(s) open for ${strategy}`,
      };
    }

    return { allowed: true };
  }

  /** Full portfolio snapshot — returned via /api/portfolio and /api/status. */
  getSnapshot(): PortfolioSnapshot {
    const positions        = this.getAll();
    const totalExposureUsdt    = positions.reduce((s, p) => s + p.sizeUsdt, 0);
    const totalUnrealizedPnl   = positions.reduce((s, p) => s + p.unrealizedPnl, 0);

    const bySymbol:   PortfolioSnapshot["bySymbol"]   = {};
    const byStrategy: PortfolioSnapshot["byStrategy"] = {};

    for (const p of positions) {
      if (!bySymbol[p.symbol]) {
        bySymbol[p.symbol] = { count: 0, exposureUsdt: 0, unrealizedPnl: 0 };
      }
      bySymbol[p.symbol]!.count++;
      bySymbol[p.symbol]!.exposureUsdt  += p.sizeUsdt;
      bySymbol[p.symbol]!.unrealizedPnl += p.unrealizedPnl;

      if (!byStrategy[p.strategy]) {
        byStrategy[p.strategy] = { count: 0, exposureUsdt: 0 };
      }
      byStrategy[p.strategy]!.count++;
      byStrategy[p.strategy]!.exposureUsdt += p.sizeUsdt;
    }

    return {
      positions,
      openCount: positions.length,
      totalExposureUsdt,
      totalUnrealizedPnl,
      bySymbol,
      byStrategy,
      config: this.getConfig(),
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/** Process-level singleton shared across bot, routes, and workers. */
export const portfolioRegistry = new PortfolioRegistry();

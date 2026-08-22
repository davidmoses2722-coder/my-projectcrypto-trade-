/**
 * portfolioManager.ts — Phase 10.0 Portfolio Manager
 *
 * Supports multiple named portfolios with independent risk profiles
 * and allocation presets (Conservative / Balanced / Aggressive).
 *
 * ADVISORY — manages configuration and allocation logic; does not
 * execute trades directly.
 */

import { logger } from "./logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RiskPreset = "conservative" | "balanced" | "aggressive" | "custom";

export interface PortfolioAllocation {
  strategyId:    string;
  strategyName:  string;
  allocationPct: number;   // % of portfolio capital
  maxPositionPct: number;  // max per-trade % of portfolio
  enabled:       boolean;
}

export interface Portfolio {
  id:               string;
  name:             string;
  description:      string;
  riskPreset:       RiskPreset;
  totalCapitalUsdt: number;
  allocations:      PortfolioAllocation[];
  maxDailyLossPct:  number;
  maxDrawdownPct:   number;
  maxOpenTrades:    number;
  active:           boolean;
  createdAt:        string;
  updatedAt:        string;
}

export interface PortfolioSummary {
  id:               string;
  name:             string;
  riskPreset:       RiskPreset;
  totalCapitalUsdt: number;
  active:           boolean;
  strategyCount:    number;
  createdAt:        string;
}

// ─── Risk preset definitions ──────────────────────────────────────────────────

const PRESET_CONFIGS: Record<RiskPreset, Omit<Portfolio, "id" | "name" | "description" | "totalCapitalUsdt" | "createdAt" | "updatedAt">> = {
  conservative: {
    riskPreset:      "conservative",
    maxDailyLossPct:  2,
    maxDrawdownPct:   8,
    maxOpenTrades:    2,
    active:           false,
    allocations: [
      { strategyId: "swing",       strategyName: "Swing",       allocationPct: 40, maxPositionPct: 5,  enabled: true  },
      { strategyId: "dca",         strategyName: "DCA",         allocationPct: 35, maxPositionPct: 5,  enabled: true  },
      { strategyId: "grid",        strategyName: "Grid",        allocationPct: 25, maxPositionPct: 5,  enabled: true  },
      { strategyId: "day-trading", strategyName: "Day Trading", allocationPct: 0,  maxPositionPct: 0,  enabled: false },
      { strategyId: "scalping",    strategyName: "Scalping",    allocationPct: 0,  maxPositionPct: 0,  enabled: false },
    ],
  },
  balanced: {
    riskPreset:      "balanced",
    maxDailyLossPct:  4,
    maxDrawdownPct:   15,
    maxOpenTrades:    4,
    active:           false,
    allocations: [
      { strategyId: "swing",       strategyName: "Swing",       allocationPct: 30, maxPositionPct: 10, enabled: true },
      { strategyId: "day-trading", strategyName: "Day Trading", allocationPct: 25, maxPositionPct: 8,  enabled: true },
      { strategyId: "scalping",    strategyName: "Scalping",    allocationPct: 20, maxPositionPct: 8,  enabled: true },
      { strategyId: "dca",         strategyName: "DCA",         allocationPct: 15, maxPositionPct: 5,  enabled: true },
      { strategyId: "grid",        strategyName: "Grid",        allocationPct: 10, maxPositionPct: 5,  enabled: true },
    ],
  },
  aggressive: {
    riskPreset:      "aggressive",
    maxDailyLossPct:  8,
    maxDrawdownPct:   25,
    maxOpenTrades:    6,
    active:           false,
    allocations: [
      { strategyId: "scalping",    strategyName: "Scalping",    allocationPct: 35, maxPositionPct: 15, enabled: true },
      { strategyId: "day-trading", strategyName: "Day Trading", allocationPct: 30, maxPositionPct: 12, enabled: true },
      { strategyId: "swing",       strategyName: "Swing",       allocationPct: 20, maxPositionPct: 10, enabled: true },
      { strategyId: "dca",         strategyName: "DCA",         allocationPct: 10, maxPositionPct: 8,  enabled: true },
      { strategyId: "grid",        strategyName: "Grid",        allocationPct: 5,  maxPositionPct: 5,  enabled: true },
    ],
  },
  custom: {
    riskPreset:      "custom",
    maxDailyLossPct:  5,
    maxDrawdownPct:   20,
    maxOpenTrades:    4,
    active:           false,
    allocations: [
      { strategyId: "swing",       strategyName: "Swing",       allocationPct: 25, maxPositionPct: 10, enabled: true },
      { strategyId: "scalping",    strategyName: "Scalping",    allocationPct: 25, maxPositionPct: 10, enabled: true },
      { strategyId: "day-trading", strategyName: "Day Trading", allocationPct: 20, maxPositionPct: 10, enabled: true },
      { strategyId: "dca",         strategyName: "DCA",         allocationPct: 20, maxPositionPct: 5,  enabled: true },
      { strategyId: "grid",        strategyName: "Grid",        allocationPct: 10, maxPositionPct: 5,  enabled: true },
    ],
  },
};

// ─── Service class ────────────────────────────────────────────────────────────

class PortfolioManagerService {
  private portfolios = new Map<string, Portfolio>();
  private nextId = 1;

  constructor() {
    // Seed with default portfolios
    this.create({ name: "Conservative Portfolio", description: "Low risk, capital preservation", riskPreset: "conservative", totalCapitalUsdt: 1000 });
    this.create({ name: "Balanced Portfolio",     description: "Moderate risk, steady growth",  riskPreset: "balanced",     totalCapitalUsdt: 1000 });
    this.create({ name: "Aggressive Portfolio",   description: "High risk, maximum returns",    riskPreset: "aggressive",   totalCapitalUsdt: 1000 });
  }

  create(data: { name: string; description: string; riskPreset: RiskPreset; totalCapitalUsdt: number }): Portfolio {
    const id      = `port_${this.nextId++}`;
    const preset  = PRESET_CONFIGS[data.riskPreset];
    const now     = new Date().toISOString();
    const portfolio: Portfolio = {
      ...preset,
      id,
      name:             data.name,
      description:      data.description,
      totalCapitalUsdt: data.totalCapitalUsdt,
      active:           false,
      createdAt:        now,
      updatedAt:        now,
    };
    this.portfolios.set(id, portfolio);
    logger.info({ id, name: data.name, preset: data.riskPreset }, "PortfolioManager: created");
    return portfolio;
  }

  update(id: string, patch: Partial<Portfolio>): Portfolio | null {
    const p = this.portfolios.get(id);
    if (!p) return null;
    const updated = { ...p, ...patch, id, updatedAt: new Date().toISOString() };
    this.portfolios.set(id, updated);
    return updated;
  }

  activate(id: string): boolean {
    const p = this.portfolios.get(id);
    if (!p) return false;
    // Deactivate all others
    for (const [pid, port] of this.portfolios) {
      this.portfolios.set(pid, { ...port, active: pid === id });
    }
    logger.info({ id, name: p.name }, "PortfolioManager: activated");
    return true;
  }

  delete(id: string): boolean {
    if (!this.portfolios.has(id)) return false;
    this.portfolios.delete(id);
    return true;
  }

  getAll(): Portfolio[] {
    return Array.from(this.portfolios.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  getById(id: string): Portfolio | null { return this.portfolios.get(id) ?? null; }

  getActive(): Portfolio | null {
    return Array.from(this.portfolios.values()).find((p) => p.active) ?? null;
  }

  getSummaries(): PortfolioSummary[] {
    return this.getAll().map((p) => ({
      id:               p.id,
      name:             p.name,
      riskPreset:       p.riskPreset,
      totalCapitalUsdt: p.totalCapitalUsdt,
      active:           p.active,
      strategyCount:    p.allocations.filter((a) => a.enabled).length,
      createdAt:        p.createdAt,
    }));
  }

  applyPreset(id: string, preset: RiskPreset): Portfolio | null {
    const p = this.portfolios.get(id);
    if (!p) return null;
    const presetCfg = PRESET_CONFIGS[preset];
    return this.update(id, { ...presetCfg, riskPreset: preset });
  }
}

export const portfolioManager = new PortfolioManagerService();

import { describe, expect, it } from "vitest";
import { RiskManager } from "./riskManager";

const entry = {
  symbol: "BTCUSDT",
  side: "buy" as const,
  requestedAmountUsdt: 20,
  currentPrice: 100,
  balanceFreeUsdt: 1_000,
  slPrice: 99,
  tpPrice: 101,
};

describe("source-specific risk state", () => {
  it("increments the automated daily counter but not the manual manager", () => {
    const bot = new RiskManager(1, "BOT");
    const manual = new RiskManager(1, "MANUAL");

    bot.recordEntry("BTCUSDT", "buy", 100, 0.2, 20, 99, 101);

    expect(bot.getState().dailyTradeCount).toBe(1);
    expect(manual.getState().dailyTradeCount).toBe(0);
  });

  it("does not let a bot position block a manual position on the same symbol", () => {
    const bot = new RiskManager(1, "BOT");
    const manual = new RiskManager(1, "MANUAL");

    bot.recordEntry("BTCUSDT", "buy", 100, 0.2, 20, 99, 101);

    expect(bot.check(entry).allowed).toBe(false);
    expect(manual.check(entry).allowed).toBe(true);
  });

  it("keeps the automated daily cap out of manual execution", () => {
    const bot = new RiskManager(1, "BOT");
    const manual = new RiskManager(1, "MANUAL");
    bot.updateConfig({ maxTradesPerDay: 1 });

    bot.recordEntry("BTCUSDT", "buy", 100, 0.2, 20, 99, 101);

    expect(bot.check({ ...entry, symbol: "ETHUSDT" }).reason).toContain("Daily trade cap");
    expect(manual.check({ ...entry, symbol: "ETHUSDT" }).allowed).toBe(true);
  });

  it("keeps bot risk configuration changes out of manual configuration", () => {
    const bot = new RiskManager(1, "BOT");
    const manual = new RiskManager(1, "MANUAL");
    bot.updateConfig({ maxOpenPositions: 1, maxTradesPerDay: 1 });

    expect(bot.getConfig().maxOpenPositions).toBe(1);
    expect(manual.getConfig().maxOpenPositions).toBe(2);
    expect(manual.getConfig().maxTradesPerDay).toBe(20);
  });
});
import { useState, useEffect, useCallback, useRef } from "react";
import { Signal, Trade, BotConfig } from "../types/crypto";
import { INITIAL_SIGNALS, INITIAL_TRADES, DEFAULT_BOT_CONFIG } from "../data/mockData";
import { CoinPrice } from "../types/crypto";
import {
  telegramAlert,
  notifySignal,
  notifyTradeOpen,
  notifyTradeClosed,
  notifyBotStatus,
  hasValidTelegramConfig,
} from "../services/telegram";
import {
  hasValidBinanceKeys,
  placeMarketOrder,
  order,
  size,
  fetchAccountInfo,
} from "../services/binance";
import {
  computeIndicators,
  scoreToSignal,
  generateReason,
  aiScore,
} from "../utils/indicators";

// ─────────────────────────────────────────────────────────────────────────────
// Coin name map
// ─────────────────────────────────────────────────────────────────────────────
const COIN_NAMES: Record<string, string> = {
  BTC:  "Bitcoin",
  ETH:  "Ethereum",
  SOL:  "Solana",
  BNB:  "BNB",
  XRP:  "XRP",
  ADA:  "Cardano",
  AVAX: "Avalanche",
  DOGE: "Dogecoin",
};

// ─────────────────────────────────────────────────────────────────────────────
// Signal generator — uses REAL computed indicators from sparkline data
// ─────────────────────────────────────────────────────────────────────────────
function generateSignal(prices: CoinPrice[], config: BotConfig): Signal | null {
  const eligible = prices.filter((p) => config.enabledCoins.includes(p.symbol));
  if (!eligible.length) return null;

  // Score every coin and pick the one with the highest absolute indicator score
  let bestCoin: CoinPrice | null = null;
  let bestSnap = null;
  let bestAbsScore = -1;

  for (const coin of eligible) {
    const sparkline = coin.sparkline;
    if (!sparkline || sparkline.length < 5) continue;

    // Volume ratio: crude approximation using price momentum
    const priceChg = Math.abs(coin.changePercent24h) / 2;
    const volumeRatio = 0.8 + priceChg * 0.1;

    const snap = computeIndicators(sparkline, volumeRatio);
    if (!snap) continue;

    if (Math.abs(snap.score) > bestAbsScore) {
      bestAbsScore = Math.abs(snap.score);
      bestCoin     = coin;
      bestSnap     = snap;
    }
  }

  if (!bestCoin || !bestSnap) return null;

  const { type, strength, confidence } = scoreToSignal(bestSnap.score);
  const reason                          = generateReason(bestSnap);

  const tpMult = 1 + config.takeProfitPercent / 100;
  const slMult = 1 - config.stopLossPercent  / 100;

  // ATR-adjusted targets (if ATR data is meaningful)
  const atrAdj = bestSnap.atrValue > 0 ? bestSnap.atrValue * 1.5 : 0;
  const target  = type === "SELL"
    ? bestCoin.price * slMult - atrAdj
    : bestCoin.price * tpMult + atrAdj;
  const stopLoss = type === "SELL"
    ? bestCoin.price * tpMult + atrAdj
    : bestCoin.price * slMult - atrAdj;

  // Map real RSI to the legacy display bucket
  const rsiDisplay = bestSnap.rsiValue ?? 50;

  // Explicitly invoke aiScore() for verification / external callers
  const verifiedAiScore = aiScore(
    rsiDisplay,
    bestSnap.macdValue,
    bestSnap.aiTrendDir
  );

  return {
    id:         `sig-${Date.now()}-${bestCoin.symbol}`,
    coin:       COIN_NAMES[bestCoin.symbol] || bestCoin.symbol,
    symbol:     bestCoin.symbol,
    type,
    strength,
    price:      bestCoin.price,
    target:     Math.max(0, target),
    stopLoss:   Math.max(0, stopLoss),
    confidence,
    reason,
    timestamp:  new Date(),
    indicators: {
      // Legacy display fields
      rsi:    rsiDisplay,
      macd:   bestSnap.macdSignal,
      ema:    bestSnap.emaSignal,
      volume: bestSnap.volumeSignal,
      // Real computed values
      rsiRaw:      bestSnap.rsiValue,
      macdRaw:     bestSnap.macdValue,
      ema20:       bestSnap.ema20,
      ema50:       bestSnap.ema50,
      atrPercent:  bestSnap.atrPercent,
      stochastic:  bestSnap.stochValue,
      bbPosition:  bestSnap.bbPosition,
      trend:       bestSnap.trend,
      score:       bestSnap.score,
      // AI Score breakdown
      aiScoreRaw:  verifiedAiScore,
      aiScoreNorm: bestSnap.aiScoreNorm,
      aiRsiPart:   bestSnap.aiRsiPart,
      aiMacdPart:  bestSnap.aiMacdPart,
      aiTrendPart: bestSnap.aiTrendPart,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────
const LS_KEY = "pcb_bot_config";

const STRATEGY_PRESETS: Record<BotConfig["strategy"], {
  stopLossPercent: number;
  takeProfitPercent: number;
  tickMs: number;
}> = {
  scalping:      { stopLossPercent: 0.5,  takeProfitPercent: 1.0,  tickMs: 3_000   },
  swing:         { stopLossPercent: 3.5,  takeProfitPercent: 7.0,  tickMs: 300_000 },
  "day-trading": { stopLossPercent: 1.5,  takeProfitPercent: 3.0,  tickMs: 60_000  },
  dca:           { stopLossPercent: 5.0,  takeProfitPercent: 10.0, tickMs: 600_000 },
  grid:          { stopLossPercent: 2.0,  takeProfitPercent: 4.0,  tickMs: 30_000  },
};

function loadConfig(): BotConfig {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { ...DEFAULT_BOT_CONFIG, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULT_BOT_CONFIG;
}

export function useBotEngine(prices: CoinPrice[]) {
  const [config, setConfig]     = useState<BotConfig>(loadConfig);
  const [signals, setSignals]   = useState<Signal[]>(INITIAL_SIGNALS);
  const [trades, setTrades]     = useState<Trade[]>(INITIAL_TRADES);
  const [botLog, setBotLog]     = useState<string[]>([
    "⚡ Bot engine initialized. Awaiting start command.",
    "📡 Market data feed connected.",
    "🔍 Scanning 8 pairs across 5 strategies.",
    "📐 Indicator engine: EMA · RSI · MACD · ATR · Bollinger · Stochastic",
    hasValidBinanceKeys
      ? "✅ Binance API keys detected — live trading enabled."
      : "⚠️  No Binance API keys — running in simulation mode.",
    hasValidTelegramConfig
      ? "✅ Telegram notifications enabled."
      : "📵 Telegram not configured — alerts disabled.",
  ]);
  const [totalPnL, setTotalPnL] = useState(0);
  const tickRef                 = useRef(0);

  const addLog = useCallback((msg: string) => {
    setBotLog((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 49)]);
  }, []);

  const startBot = useCallback(() => {
    const current = loadConfig();
    const tickMs  = STRATEGY_PRESETS[current.strategy]?.tickMs ?? 5000;
    setConfig((c) => ({ ...c, isRunning: true }));
    addLog("🚀 Bot STARTED — scanning markets with real indicators...");
    addLog(`📊 Strategy: ${current.strategy.toUpperCase()} | Risk: ${current.riskLevel.toUpperCase()} | Tick: ${tickMs / 1000}s`);
    addLog(`📐 SL: ${current.stopLossPercent}% | TP: ${current.takeProfitPercent}% | Using: EMA·RSI·MACD·ATR·BB·Stoch`);
    if (hasValidBinanceKeys) addLog("🔗 Live Binance trading: ACTIVE");
    if (hasValidTelegramConfig) {
      addLog("📣 Telegram alerts: ON");
      notifyBotStatus(true, current.strategy);
    }
  }, [addLog]);

  const stopBot = useCallback(() => {
    setConfig((c) => ({ ...c, isRunning: false }));
    addLog("⛔ Bot STOPPED by user.");
    if (hasValidTelegramConfig) notifyBotStatus(false);
  }, [addLog]);

  const updateConfig = useCallback((updates: Partial<BotConfig>) => {
    setConfig((c) => {
      let next = { ...c, ...updates };
      if (updates.strategy && updates.strategy !== c.strategy) {
        const preset = STRATEGY_PRESETS[updates.strategy];
        next = { ...next, stopLossPercent: preset.stopLossPercent, takeProfitPercent: preset.takeProfitPercent };
      }
      try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // ── Bot tick ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!config.isRunning) return;

    const interval = setInterval(async () => {
      tickRef.current += 1;

      // Generate signal every ~15s (every 3 ticks of 5s)
      if (tickRef.current % 3 === 0) {
        const sig = generateSignal(prices, config);
        if (sig) {
          setSignals((prev) => [sig, ...prev.slice(0, 19)]);

          const scoreTag = sig.indicators.score > 0
            ? `+${sig.indicators.score.toFixed(0)}`
            : sig.indicators.score.toFixed(0);

          addLog(
            `🎯 Signal: ${sig.type} ${sig.symbol} @ $${sig.price.toLocaleString(undefined, { maximumFractionDigits: 4 })} | Score: ${scoreTag} | RSI: ${sig.indicators.rsiRaw?.toFixed(1) ?? "N/A"} | Conf: ${sig.confidence}%`
          );

          // Detailed indicator log
          addLog(
            `   📐 MACD: ${sig.indicators.macd} | EMA: ${sig.indicators.ema} | BB: ${sig.indicators.bbPosition ?? "N/A"} | Trend: ${sig.indicators.trend}`
          );

          // AI Score breakdown log
          const aiTag = sig.indicators.aiScoreRaw >= 0
            ? `+${sig.indicators.aiScoreRaw}`
            : `${sig.indicators.aiScoreRaw}`;
          addLog(
            `   🤖 AI Score: ${aiTag}/7 | RSI(${sig.indicators.aiRsiPart >= 0 ? "+" : ""}${sig.indicators.aiRsiPart}) MACD(${sig.indicators.aiMacdPart >= 0 ? "+" : ""}${sig.indicators.aiMacdPart}) Trend(${sig.indicators.aiTrendPart >= 0 ? "+" : ""}${sig.indicators.aiTrendPart})`
          );

          // Telegram alert for STRONG signals
          if (sig.strength === "STRONG" && hasValidTelegramConfig) {
            notifySignal({
              type:       sig.type,
              symbol:     sig.symbol,
              price:      sig.price,
              target:     sig.target,
              stopLoss:   sig.stopLoss,
              confidence: sig.confidence,
              strength:   sig.strength,
              reason:     sig.reason,
            });
          }

          // Auto-execute strong BUY/SELL signals
          if (sig.strength === "STRONG" && sig.type !== "HOLD") {
            const trade: Trade = {
              id:         `tr-${Date.now()}`,
              coin:       sig.coin,
              symbol:     sig.symbol,
              type:       sig.type,
              amount:     parseFloat((config.maxTradeAmount / sig.price).toFixed(6)),
              price:      sig.price,
              total:      config.maxTradeAmount,
              pnl:        0,
              pnlPercent: 0,
              timestamp:  new Date(),
              status:     "open",
            };
            setTrades((prev) => [trade, ...prev.slice(0, 29)]);
            addLog(`✅ AUTO-TRADE: ${trade.type} ${trade.amount} ${trade.symbol} @ $${trade.price.toFixed(2)}`);

            if (hasValidTelegramConfig) {
              notifyTradeOpen({
                type:   trade.type,
                symbol: trade.symbol,
                amount: trade.amount,
                price:  trade.price,
                total:  trade.total,
              });
            }

            if (hasValidBinanceKeys) {
              try {
                // Fetch live account balance to compute exact BTC qty via size()
                let liveBalance = trade.total;   // fallback: use USDT amount
                try {
                  const account = await fetchAccountInfo();
                  const usdtBal = account.balances.find((b) => b.asset === "USDT");
                  liveBalance   = usdtBal ? parseFloat(usdtBal.free) : trade.total;
                } catch {
                  // ignore — use fallback balance
                }

                if (trade.symbol === "BTC") {
                  // Use order() + size() for BTC — exact provided API
                  const qty = size(liveBalance, trade.price);
                  addLog(`📐 BTC qty via size(): ${qty} BTC (1% of $${liveBalance.toFixed(2)})`);
                  await order(trade.type, qty);
                  addLog(`🔗 BINANCE ORDER (order/size): ${trade.type} ${qty} BTC @ ~$${trade.price.toFixed(2)}`);
                } else {
                  // Multi-coin: use quoteOrderQty (USDT)
                  await placeMarketOrder(trade.symbol, trade.type, trade.total);
                  addLog(`🔗 BINANCE ORDER PLACED: ${trade.type} ${trade.symbol} $${trade.total}`);
                }
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                addLog(`❌ Binance order failed: ${msg}`);
                // Direct one-liner alert via telegramAlert() — the exact provided API
                telegramAlert(`❌ PROCRYPTOBOT ORDER ERROR\n${msg}\n⏰ ${new Date().toLocaleString()}`);
              }
            }
          }
        }
      }

      // Update open trade P&Ls every tick
      setTrades((prev) =>
        prev.map((t) => {
          if (t.status !== "open") return t;
          const currentCoin = prices.find((p) => p.symbol === t.symbol);
          if (!currentCoin) return t;

          const pnl        = t.type === "BUY"
            ? (currentCoin.price - t.price) * t.amount
            : (t.price - currentCoin.price) * t.amount;
          const pnlPercent = (pnl / t.total) * 100;

          const tpHit = t.type === "BUY" && currentCoin.price >= t.price * (1 + config.takeProfitPercent / 100);
          const slHit = t.type === "BUY" && currentCoin.price <= t.price * (1 - config.stopLossPercent  / 100);

          if (tpHit) {
            addLog(`🏆 TP HIT: ${t.symbol} +${pnlPercent.toFixed(2)}%`);
            if (hasValidTelegramConfig) {
              // Fast direct alert via alert() — immediate, no queue
              telegramAlert(
                `🏆 TAKE PROFIT HIT — ${t.symbol}\n+$${pnl.toFixed(2)} (+${pnlPercent.toFixed(2)}%)\n⏰ ${new Date().toLocaleString()}`
              );
              notifyTradeClosed({
                type:       t.type,
                symbol:     t.symbol,
                amount:     t.amount,
                entryPrice: t.price,
                exitPrice:  currentCoin.price,
                pnl,
                pnlPercent,
                reason:     "TP",
              });
            }
          }

          if (slHit) {
            addLog(`🛑 SL HIT: ${t.symbol} ${pnlPercent.toFixed(2)}%`);
            if (hasValidTelegramConfig) {
              // Fast direct alert via alert() — immediate, no queue
              telegramAlert(
                `🛑 STOP LOSS HIT — ${t.symbol}\n$${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)\n⏰ ${new Date().toLocaleString()}`
              );
              notifyTradeClosed({
                type:       t.type,
                symbol:     t.symbol,
                amount:     t.amount,
                entryPrice: t.price,
                exitPrice:  currentCoin.price,
                pnl,
                pnlPercent,
                reason:     "SL",
              });
            }
          }

          return {
            ...t,
            pnl,
            pnlPercent,
            status: tpHit || slHit ? "closed" : "open",
          };
        })
      );
    }, STRATEGY_PRESETS[config.strategy]?.tickMs ?? 5000);

    return () => clearInterval(interval);
  }, [config, prices, addLog]);

  useEffect(() => {
    const total = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    setTotalPnL(total);
  }, [trades]);

  return { config, signals, trades, botLog, totalPnL, startBot, stopBot, updateConfig };
}

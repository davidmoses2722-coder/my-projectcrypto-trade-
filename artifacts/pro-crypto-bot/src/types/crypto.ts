export interface CoinPrice {
  id: string;
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  changePercent24h: number;
  volume24h: number;
  marketCap: number;
  high24h: number;
  low24h: number;
  sparkline?: number[];
}

export interface Signal {
  id: string;
  coin: string;
  symbol: string;
  type: "BUY" | "SELL" | "HOLD";
  strength: "STRONG" | "MODERATE" | "WEAK";
  price: number;
  target: number;
  stopLoss: number;
  confidence: number;
  reason: string;
  timestamp: Date;
  indicators: {
    rsi: number;           // real computed RSI value (0–100)
    macd: "bullish" | "bearish" | "neutral";
    ema: "above" | "below" | "crossing";
    volume: "high" | "normal" | "low";
    // Extended real values
    rsiRaw:       number | null;
    macdRaw:      number;
    ema20:        number;
    ema50:        number;
    atrPercent:   number;
    stochastic:   number | null;
    bbPosition:   "upper" | "middle" | "lower" | null;
    trend:        "uptrend" | "downtrend" | "sideways";
    score:        number;  // composite score -100 to +100 (80% tech + 20% AI)
    // AI Score breakdown (from aiScore() function)
    aiScoreRaw:   number;  // raw aiScore in [-7, +7]
    aiScoreNorm:  number;  // normalized in [-100, +100]
    aiRsiPart:    number;  // RSI sub-score  (-2 / 0 / +2)
    aiMacdPart:   number;  // MACD sub-score (-2 / +2)
    aiTrendPart:  number;  // Trend sub-score(-3 / +3)
  };
}

export interface PortfolioAsset {
  id: string;
  symbol: string;
  name: string;
  amount: number;
  buyPrice: number;
  currentPrice: number;
  color: string;
}

export interface Trade {
  id:           string;
  coin:         string;
  symbol:       string;
  type:         "BUY" | "SELL";
  amount:       number;
  price:        number;       // entry price
  total:        number;       // USDT value at entry
  pnl?:         number;       // realized or unrealized PnL in USDT
  pnlPercent?:  number;
  timestamp:    Date;         // entry time
  status:       "open" | "closed" | "pending" | "cancelled";

  // ── Extended real-trade fields ───────────────────────────────────────────
  exitPrice?:      number;    // price at close
  exitTime?:       Date;      // close timestamp
  orderId?:        string;    // Binance order ID (if live)
  fees?:           number;    // trading fees in USDT
  realised?:       number;    // net PnL after fees
  isReal?:         boolean;   // true = executed on Binance, false = simulated
  tp?:             number;    // take-profit price
  sl?:             number;    // stop-loss price
  trailingStop?:   number;    // trailing stop % (0 = disabled)
  highWater?:      number;    // highest price seen (for trailing stop)
  duration?:       number;    // ms from open to close
  entryReason?:    string;    // signal reason / manual
  exitReason?:     "TP" | "SL" | "TRAILING" | "MANUAL" | "LIQUIDATION" | "CANCELLED";
  strategy?:       string;
  tags?:           string[];
}

export interface BotConfig {
  isRunning: boolean;
  strategy: "scalping" | "swing" | "day-trading" | "dca" | "grid";
  riskLevel: "low" | "medium" | "high";
  maxTradeAmount: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  enabledCoins: string[];
}

// ─── Order Book ──────────────────────────────────────────────────────────────

export interface OrderBookLevel {
  price:    number;
  quantity: number;
  total:    number;   // cumulative notional (price × qty)
  isWall:   boolean;  // true if qty > wall threshold
  depth:    number;   // 0–1, relative depth for bar rendering
}

export interface OrderBook {
  symbol:      string;
  bids:        OrderBookLevel[];  // sorted high→low
  asks:        OrderBookLevel[];  // sorted low→high
  spread:      number;
  spreadPct:   number;
  midPrice:    number;
  timestamp:   Date;
  lastUpdateId: number;
}

// ─── Liquidity Zones ─────────────────────────────────────────────────────────

export type ZoneType = "support" | "resistance" | "supply" | "demand" | "absorption";

export interface LiquidityZone {
  id:         string;
  type:       ZoneType;
  priceHigh:  number;
  priceLow:   number;
  midPrice:   number;
  strength:   number;   // 0–100
  volume:     number;   // notional USDT value at zone
  touchCount: number;   // how many times price has tested this zone
  isActive:   boolean;  // price is currently near this zone
  label:      string;
}

// ─── Sniper Entries ──────────────────────────────────────────────────────────

export type SniperStatus = "ARMED" | "TRIGGERED" | "EXPIRED" | "CANCELLED";

export interface SniperEntry {
  id:          string;
  symbol:      string;
  side:        "BUY" | "SELL";
  entryPrice:  number;
  targetPrice: number;
  stopLoss:    number;
  riskReward:  number;
  confidence:  number;   // 0–100
  zone:        LiquidityZone;
  status:      SniperStatus;
  reason:      string;
  indicators:  string[];
  timestamp:   Date;
  expiresAt:   Date;
}

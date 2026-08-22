/**
 * FuturesTerminal — Professional exchange-style Perp Futures terminal.
 *
 * Layout: Markets sidebar | Chart area | Order Book + Order Entry
 * Bottom: Positions | Open Orders | Order History
 *
 * Isolated from ManualTradingCenter's spot logic.
 * Supports both paper and live Gate.io futures.
 */
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  AlertTriangle, CheckCircle2, Clock3, TrendingUp, TrendingDown,
  ChevronDown, ChevronUp, X, ArrowUpDown, Zap, BarChart3, History,
  DollarSign, Percent, Shield, Activity,
} from "lucide-react";
import type { CoinPrice } from "../types/crypto";
import { SERVER_URL } from "../config/urls";
import { useSSE } from "../hooks/useSSE";
import type { IChartApi, ISeriesApi, UTCTimestamp, IPriceLine, PriceLineOptions } from "lightweight-charts";
import { createChart, ColorType, CrosshairMode } from "lightweight-charts";

// ─── Types ──────────────────────────────────────────────────────────────────

type PositionSide = "long" | "short";
type MarginMode = "isolated" | "cross";
type OrderType = "MARKET" | "LIMIT";
type BottomTab = "positions" | "orders" | "history";

interface FuturesPosition {
  symbol: string;
  side: PositionSide;
  contracts: number;
  entryPrice: number;
  markPrice: number;
  liquidationPrice: number | null;
  leverage: number;
  marginMode: MarginMode;
  initialMargin: number;
  unrealizedPnl: number;
  realizedPnl: number;
}

interface FuturesOrderRow {
  id?: number;
  orderId: string;
  symbol: string;
  side: string;
  orderType: string;
  limitPrice: string | null;
  quantity: string;
  status: string;
  positionSide: string | null;
  leverage: number | null;
  marginMode: string | null;
  reduceOnly?: boolean;
  filledAt: string | null;
  createdAt: string;
}

interface FuturesAccount {
  totalEquity: number;
  availableBalance: number;
  usedMargin: number;
  unrealizedPnl: number;
  marginMode: string;
  paper?: boolean;
}

interface Capability {
  supported: boolean;
  reason?: string;
  balanceUsdt?: number;
}

interface OrderBookEntry {
  price: number;
  amount: number;
  total: number;
}

interface OrderBookData {
  asks: OrderBookEntry[];
  bids: OrderBookEntry[];
  spread: number;
  midPrice: number;
}

interface RecentTrade {
  id: string;
  side: "buy" | "sell";
  price: number;
  amount: number;
  timestamp: number;
}

interface TickerData {
  symbol: string;
  last: number;
  markPrice: number | null;
  indexPrice: number | null;
  bid: number;
  ask: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  fundingRate: number | null;
  nextFundingTime: number | null;
}

interface FundingData {
  symbol: string;
  fundingRate: number;
  nextFundingTime: number | null;
  markPrice: number | null;
}

interface Props {
  symbol: string;
  prices: CoinPrice[];
  isPaper: boolean;
  onRefreshStatus?: () => Promise<void>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const FUTURES_SYMBOLS = [
  "BTC/USDT", "ETH/USDT", "SOL/USDT", "XRP/USDT", "DOGE/USDT",
  "ADA/USDT", "AVAX/USDT", "LINK/USDT", "DOT/USDT", "MATIC/USDT",
  "UNI/USDT", "LTC/USDT", "ATOM/USDT", "NEAR/USDT", "APT/USDT",
  "ARB/USDT", "OP/USDT", "SUI/USDT", "PEPE/USDT", "WIF/USDT",
];

const LEVERAGE_PRESETS = [1, 2, 3, 5, 10, 20, 25, 50, 75, 100, 125];

const TIMEFRAMES = [
  { label: "1m", value: "1m" },
  { label: "5m", value: "5m" },
  { label: "15m", value: "15m" },
  { label: "1h", value: "1h" },
  { label: "4h", value: "4h" },
  { label: "1d", value: "1d" },
];

interface FuturesCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const authHeaders = (): Record<string, string> => {
  const token = localStorage.getItem("pcb_jwt");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const fmt = (n: number, dp = 2) => {
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
};

const fmtPct = (n: number) => {
  if (!Number.isFinite(n)) return "0.00%";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
};

// ─── Sub-components ─────────────────────────────────────────────────────────

function AccountBar({ account, isPaper }: { account: FuturesAccount | null; isPaper: boolean }) {
  if (!account) return null;
  return (
    <div className="flex items-center gap-4 px-4 py-2 border-b border-white/[0.06] bg-[#0a0e14] text-[11px]">
      <div className="flex items-center gap-1.5">
        <DollarSign size={11} className="text-cyan-500" />
        <span className="text-slate-500">Equity</span>
        <span className="font-black text-white">${fmt(account.totalEquity)}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-slate-500">Available</span>
        <span className="font-mono text-white">${fmt(account.availableBalance)}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-slate-500">Margin</span>
        <span className="font-mono text-amber-400">${fmt(account.usedMargin)}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-slate-500">uPnL</span>
        <span className={`font-mono ${account.unrealizedPnl >= 0 ? "text-[#0ECB81]" : "text-[#F6465D]"}`}>
          {account.unrealizedPnl >= 0 ? "+" : ""}${fmt(account.unrealizedPnl)}
        </span>
      </div>
      <div className="ml-auto">
        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${isPaper ? "bg-amber-500/20 text-amber-400" : "bg-emerald-500/20 text-emerald-400"}`}>
          {isPaper ? "PAPER" : "LIVE"}
        </span>
      </div>
    </div>
  );
}

function TickerBar({ ticker, funding }: { ticker: TickerData | null; funding: FundingData | null }) {
  if (!ticker) return null;
  return (
    <div className="flex items-center gap-4 px-4 py-2 border-b border-white/[0.06] bg-[#0a0e14] text-[11px]">
      <div className="flex items-center gap-2">
        <span className="font-black text-white text-sm">{ticker.symbol}</span>
        <span className="font-black text-white text-lg">${fmt(ticker.last, ticker.last >= 100 ? 2 : 4)}</span>
        <span className={`font-bold ${ticker.last >= (ticker.bid + ticker.ask) / 2 ? "text-[#0ECB81]" : "text-[#F6465D]"}`}>
          {fmtPct(((ticker.last - ticker.high24h) / (ticker.high24h || 1)) * 100)}
        </span>
      </div>
      <div className="flex items-center gap-3 text-slate-500">
        <span>Mark <span className="text-slate-300">${fmt(ticker.markPrice ?? ticker.last)}</span></span>
        <span>Index <span className="text-slate-300">${fmt(ticker.indexPrice ?? ticker.last)}</span></span>
        <span>24h H <span className="text-[#0ECB81]">${fmt(ticker.high24h)}</span></span>
        <span>24h L <span className="text-[#F6465D]">${fmt(ticker.low24h)}</span></span>
        <span>24h Vol <span className="text-slate-300">{fmt(ticker.volume24h, 0)}</span></span>
      </div>
      {funding && (
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-slate-500">Funding</span>
          <span className={`font-bold ${funding.fundingRate >= 0 ? "text-[#0ECB81]" : "text-[#F6465D]"}`}>
            {(funding.fundingRate * 100).toFixed(4)}%
          </span>
          {funding.nextFundingTime && (
            <span className="text-slate-600">Next: {new Date(funding.nextFundingTime).toLocaleTimeString()}</span>
          )}
        </div>
      )}
    </div>
  );
}

function OrderBook({ data, lastPrice }: { data: OrderBookData | null; lastPrice: number }) {
  if (!data) return (
    <div className="flex-1 flex items-center justify-center text-slate-700 text-[11px]">Loading order book…</div>
  );

  const maxTotal = Math.max(data.asks[data.asks.length - 1]?.total ?? 0, data.bids[data.bids.length - 1]?.total ?? 0);
  const displayAsks = data.asks.slice(0, 12);
  const displayBids = data.bids.slice(0, 12);

  return (
    <div className="flex flex-col h-full text-[11px]">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/[0.06]">
        <span className="text-[10px] text-slate-600 font-black uppercase tracking-wider">Order Book</span>
        <span className="text-[10px] text-slate-700">Spread: ${fmt(data.spread, data.spread < 1 ? 4 : 2)}</span>
      </div>

      {/* Asks (reversed so lowest ask is at bottom) */}
      <div className="flex-1 overflow-hidden flex flex-col justify-end">
        {displayAsks.reverse().map((entry, i) => (
          <div key={`ask-${i}`} className="flex items-center px-3 py-0.5 relative">
            <div className="absolute right-0 top-0 bottom-0 bg-[#F6465D]/5" style={{ width: `${(entry.total / maxTotal) * 100}%` }} />
            <span className="flex-1 text-[#F6465D] font-mono">{fmt(entry.price, entry.price >= 100 ? 2 : 4)}</span>
            <span className="w-20 text-right text-slate-400 font-mono">{entry.amount.toFixed(4)}</span>
            <span className="w-20 text-right text-slate-600 font-mono">{entry.total.toFixed(4)}</span>
          </div>
        ))}
      </div>

      {/* Spread / Mid price */}
      <div className="px-3 py-1.5 border-y border-white/[0.06] bg-white/[0.02] flex items-center justify-between">
        <span className="font-black text-white text-sm">${fmt(lastPrice, lastPrice >= 100 ? 2 : 4)}</span>
        <span className="text-slate-500">≈ ${fmt(data.midPrice, data.midPrice >= 100 ? 2 : 4)}</span>
      </div>

      {/* Bids */}
      <div className="flex-1 overflow-hidden">
        {displayBids.map((entry, i) => (
          <div key={`bid-${i}`} className="flex items-center px-3 py-0.5 relative">
            <div className="absolute right-0 top-0 bottom-0 bg-[#0ECB81]/5" style={{ width: `${(entry.total / maxTotal) * 100}%` }} />
            <span className="flex-1 text-[#0ECB81] font-mono">{fmt(entry.price, entry.price >= 100 ? 2 : 4)}</span>
            <span className="w-20 text-right text-slate-400 font-mono">{entry.amount.toFixed(4)}</span>
            <span className="w-20 text-right text-slate-600 font-mono">{entry.total.toFixed(4)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecentTrades({ trades }: { trades: RecentTrade[] }) {
  return (
    <div className="flex flex-col h-full text-[11px]">
      <div className="px-3 py-1.5 border-b border-white/[0.06]">
        <span className="text-[10px] text-slate-600 font-black uppercase tracking-wider">Recent Trades</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {trades.length === 0 ? (
          <div className="py-4 text-center text-slate-700">No recent trades</div>
        ) : (
          trades.slice(0, 30).map((t) => (
            <div key={t.id} className="flex items-center px-3 py-0.5">
              <span className={`flex-1 font-mono ${t.side === "buy" ? "text-[#0ECB81]" : "text-[#F6465D]"}`}>
                {fmt(t.price, t.price >= 100 ? 2 : 4)}
              </span>
              <span className="w-20 text-right text-slate-400 font-mono">{t.amount.toFixed(4)}</span>
              <span className="w-16 text-right text-slate-600">
                {new Date(t.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function FuturesTerminal({ symbol, prices, isPaper, onRefreshStatus }: Props) {
  const base = symbol.split("_")[0] ?? symbol.split("/")[0] ?? symbol;
  const displaySymbol = symbol.includes("/") ? symbol : symbol.replace("_", "/");
  const coinPrice = prices.find(p => p.symbol === base);
  const livePrice = coinPrice?.price ?? 0;

  // ── State ───────────────────────────────────────────────────────────────
  const [selectedSymbol, setSelectedSymbol] = useState(displaySymbol);
  const [cap, setCap] = useState<Capability | null>(null);
  const [capLoading, setCapLoading] = useState(true);
  const [account, setAccount] = useState<FuturesAccount | null>(null);
  const [ticker, setTicker] = useState<TickerData | null>(null);
  const [funding, setFunding] = useState<FundingData | null>(null);
  const [orderBook, setOrderBook] = useState<OrderBookData | null>(null);
  const [recentTrades, setRecentTrades] = useState<RecentTrade[]>([]);
  const [positions, setPositions] = useState<FuturesPosition[]>([]);
  const [orders, setOrders] = useState<FuturesOrderRow[]>([]);
  const [bottomTab, setBottomTab] = useState<BottomTab>("positions");

  // Order form state
  const [positionSide, setPositionSide] = useState<PositionSide>("long");
  const [marginMode, setMarginMode] = useState<MarginMode>("isolated");
  const [leverage, setLeverage] = useState(20);
  const [orderType, setOrderType] = useState<OrderType>("MARKET");
  const [limitPrice, setLimitPrice] = useState(0);
  const [amountUsdt, setAmountUsdt] = useState(0);
  const [showTpSl, setShowTpSl] = useState(true);
  const [tpTrigger, setTpTrigger] = useState(0);
  const [slTrigger, setSlTrigger] = useState(0);
  const [reduceOnly, setReduceOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [closingSymbol, setClosingSymbol] = useState<string | null>(null);
  const [showMarkets, setShowMarkets] = useState(true);

  // ── Chart state ────────────────────────────────────────────────────────
  const [candles, setCandles] = useState<FuturesCandle[]>([]);
  const [timeframe, setTimeframe] = useState("1h");
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const lastCandleTimeRef = useRef<number>(0);
  const positionPriceLineRefs = useRef<Map<string, IPriceLine>>(new Map());

  // ── localStorage helpers for paper positions ──────────────────────────
  const FUTURES_POS_KEY = "pcb_futures_positions";
  const loadPersistedPositions = useCallback((): FuturesPosition[] => {
    try {
      const raw = localStorage.getItem(FUTURES_POS_KEY);
      if (raw) return JSON.parse(raw) as FuturesPosition[];
    } catch { /* ignore */ }
    return [];
  }, []);
  const persistPositions = useCallback((pos: FuturesPosition[]) => {
    try {
      // Only persist paper positions to localStorage for cross-tab sync
      if (isPaper && pos.length > 0) {
        localStorage.setItem(FUTURES_POS_KEY, JSON.stringify(pos));
      } else if (pos.length === 0) {
        localStorage.removeItem(FUTURES_POS_KEY);
      }
    } catch { /* ignore */ }
  }, [isPaper]);

  // ── Computed values ─────────────────────────────────────────────────────
  const currentPrice = ticker?.last ?? livePrice;
  const balance = account?.availableBalance ?? cap?.balanceUsdt ?? 0;

  const notionalQty = useMemo(() => {
    if (currentPrice <= 0) return 0;
    return (amountUsdt * leverage) / currentPrice;
  }, [amountUsdt, leverage, currentPrice]);

  const requiredMargin = amountUsdt;

  const estLiquidation = useMemo(() => {
    if (currentPrice <= 0 || leverage <= 0) return null;
    const maintenanceMarginRate = 0.004;
    if (positionSide === "long") {
      return currentPrice * (1 - 1 / leverage + maintenanceMarginRate);
    } else {
      return currentPrice * (1 + 1 / leverage - maintenanceMarginRate);
    }
  }, [currentPrice, leverage, positionSide]);

  const totalUnrealizedPnl = useMemo(() => {
    return positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
  }, [positions]);

  const canTrade = cap?.supported === true;

  // ── API fetchers ────────────────────────────────────────────────────────
  const fetchCapability = useCallback(async () => {
    setCapLoading(true);
    try {
      const r = await fetch(`${SERVER_URL}/api/futures/capability`, { headers: authHeaders() as HeadersInit });
      const d = await r.json() as Capability & { ok?: boolean };
      setCap({ supported: Boolean(d.supported), reason: d.reason, balanceUsdt: d.balanceUsdt });
    } catch (e) {
      setCap({ supported: false, reason: e instanceof Error ? e.message : "Could not reach futures API" });
    } finally {
      setCapLoading(false);
    }
  }, []);

  const fetchAccount = useCallback(async () => {
    try {
      const r = await fetch(`${SERVER_URL}/api/futures/account`, { headers: authHeaders() as HeadersInit });
      const d = await r.json() as FuturesAccount & { ok?: boolean; paper?: boolean };
      setAccount({ totalEquity: d.totalEquity, availableBalance: d.availableBalance, usedMargin: d.usedMargin, unrealizedPnl: d.unrealizedPnl, marginMode: d.marginMode, paper: d.paper });
    } catch { /* leave last-known */ }
  }, []);

  const fetchTicker = useCallback(async (sym: string) => {
    try {
      const r = await fetch(`${SERVER_URL}/api/futures/ticker/${encodeURIComponent(sym)}`, { headers: authHeaders() as HeadersInit });
      const d = await r.json() as TickerData & { ok?: boolean };
      if (d.ok !== false) setTicker(d);
    } catch { /* leave last-known */ }
  }, []);

  const fetchFunding = useCallback(async (sym: string) => {
    try {
      const r = await fetch(`${SERVER_URL}/api/futures/funding-rate/${encodeURIComponent(sym)}`, { headers: authHeaders() as HeadersInit });
      const d = await r.json() as FundingData & { ok?: boolean };
      if (d.ok !== false) setFunding(d);
    } catch { /* leave last-known */ }
  }, []);

  const fetchOrderBook = useCallback(async (sym: string) => {
    try {
      const r = await fetch(`${SERVER_URL}/api/futures/orderbook/${encodeURIComponent(sym)}?limit=20`, { headers: authHeaders() as HeadersInit });
      const d = await r.json() as OrderBookData & { ok?: boolean };
      if (d.ok !== false) setOrderBook({ asks: d.asks ?? [], bids: d.bids ?? [], spread: d.spread ?? 0, midPrice: d.midPrice ?? 0 });
    } catch { /* leave last-known */ }
  }, []);

  const fetchTrades = useCallback(async (sym: string) => {
    try {
      const r = await fetch(`${SERVER_URL}/api/futures/trades/${encodeURIComponent(sym)}?limit=50`, { headers: authHeaders() as HeadersInit });
      const d = await r.json() as { ok?: boolean; trades?: RecentTrade[] };
      setRecentTrades(d.trades ?? []);
    } catch { /* leave last-known */ }
  }, []);

  const fetchPositions = useCallback(async () => {
    if (!canTrade) { setPositions([]); return; }
    try {
      const r = await fetch(`${SERVER_URL}/api/futures/positions`, { headers: authHeaders() as HeadersInit });
      const d = await r.json() as { ok?: boolean; positions?: FuturesPosition[] };
      setPositions(d.positions ?? []);
    } catch { /* leave last-known */ }
  }, [canTrade]);

  const fetchOrders = useCallback(async () => {
    try {
      const r = await fetch(`${SERVER_URL}/api/futures/orders`, { headers: authHeaders() as HeadersInit });
      const d = await r.json() as { ok?: boolean; orders?: FuturesOrderRow[] };
      setOrders(d.orders ?? []);
    } catch { /* leave last-known */ }
  }, []);

  const fetchCandles = useCallback(async (sym: string, tf: string) => {
    try {
      const r = await fetch(`${SERVER_URL}/api/futures/candles/${encodeURIComponent(sym)}?interval=${tf}&limit=300`, { headers: authHeaders() as HeadersInit });
      const d = await r.json() as { ok?: boolean; candles?: FuturesCandle[] };
      if (d.ok !== false && d.candles?.length) {
        setCandles(d.candles);
        lastCandleTimeRef.current = d.candles[d.candles.length - 1]?.time ?? 0;
      }
    } catch { /* leave last-known */ }
  }, []);

  // ── Effects ─────────────────────────────────────────────────────────────
  useEffect(() => { void fetchCapability(); }, [fetchCapability]);
  useEffect(() => { void fetchAccount(); }, [fetchAccount]);
  useEffect(() => { void fetchTicker(selectedSymbol); }, [selectedSymbol, fetchTicker]);
  useEffect(() => { void fetchFunding(selectedSymbol); }, [selectedSymbol, fetchFunding]);
  useEffect(() => { void fetchOrderBook(selectedSymbol); }, [selectedSymbol, fetchOrderBook]);
  useEffect(() => { void fetchTrades(selectedSymbol); }, [selectedSymbol, fetchTrades]);
  useEffect(() => {
    // Seed positions from localStorage on first render (paper mode)
    if (isPaper && positions.length === 0) {
      const cached = loadPersistedPositions();
      if (cached.length > 0) setPositions(cached);
    }
    void fetchPositions();
  }, [fetchPositions, isPaper, loadPersistedPositions]);
  useEffect(() => { void fetchOrders(); }, [fetchOrders]);
  useEffect(() => { void fetchCandles(selectedSymbol, timeframe); }, [selectedSymbol, timeframe, fetchCandles]);

  // Polling — tick data and incremental candle update
  useEffect(() => {
    const id = setInterval(() => {
      void fetchTicker(selectedSymbol);
      void fetchOrderBook(selectedSymbol);
      void fetchTrades(selectedSymbol);
      void fetchPositions();
      void fetchAccount();
      // Incremental candle refresh every 10s for live updates
      void fetchCandles(selectedSymbol, timeframe);
    }, 5000);
    return () => clearInterval(id);
  }, [selectedSymbol, timeframe, fetchTicker, fetchOrderBook, fetchTrades, fetchPositions, fetchAccount, fetchCandles]);

  // ── Chart creation ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!chartContainerRef.current) return;
    const chart = createChart(chartContainerRef.current, {
      layout: { background: { type: ColorType.Solid, color: "#080d15" }, textColor: "#64748b", fontSize: 11 },
      grid: { vertLines: { color: "rgba(255,255,255,0.03)" }, horzLines: { color: "rgba(255,255,255,0.03)" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.06)" },
      timeScale: { borderColor: "rgba(255,255,255,0.06)", timeVisible: true },
      autoSize: true,
    });
    const candleSeries = chart.addCandlestickSeries({
      upColor: "#0ECB81", downColor: "#F6465D", borderVisible: false,
      wickUpColor: "#0ECB81", wickDownColor: "#F6465D",
    });
    const volSeries = chart.addHistogramSeries({
      priceFormat: { type: "volume" }, priceScaleId: "vol",
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volSeriesRef.current = volSeries;
    return () => { chart.remove(); chartRef.current = null; candleSeriesRef.current = null; volSeriesRef.current = null; positionPriceLineRefs.current.clear(); };
  }, []);

  // ── Chart data update ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!candleSeriesRef.current || !volSeriesRef.current || !candles.length) return;
    candleSeriesRef.current.setData(candles.map(c => ({
      time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close,
    })));
    volSeriesRef.current.setData(candles.map(c => ({
      time: c.time as UTCTimestamp, value: c.volume,
      color: c.close >= c.open ? "rgba(14,203,129,0.35)" : "rgba(246,70,93,0.35)",
    })));
    // Scroll to the latest candle
    chartRef.current?.timeScale().scrollToRealTime();
  }, [candles]);

  // ── Persist positions to localStorage ────────────────────────────────
  useEffect(() => { persistPositions(positions); }, [positions, persistPositions]);

  // ── Entry price lines on chart ───────────────────────────────────────────
  useEffect(() => {
    if (!candleSeriesRef.current) return;
    const cs = candleSeriesRef.current;
    const existing = positionPriceLineRefs.current;

    // Remove price lines for closed positions
    for (const [key, pl] of existing) {
      const stillOpen = positions.some(p => `${p.symbol}_${p.side}` === key);
      if (!stillOpen) {
        try { cs.removePriceLine(pl); } catch { /* already removed */ }
        existing.delete(key);
      }
    }

    // Add / update price lines for open positions on the current symbol
    for (const pos of positions) {
      const base = selectedSymbol.split("/")[0] ?? selectedSymbol.split("_")[0] ?? selectedSymbol;
      if (!pos.symbol.includes(base) && pos.symbol !== selectedSymbol) continue;
      if (pos.entryPrice <= 0) continue;

      const key = `${pos.symbol}_${pos.side}`;
      const color = pos.side === "long" ? "#0ECB81" : "#F6465D";
      const label = pos.side.toUpperCase();

      const existingPl = existing.get(key);
      if (existingPl) {
        // Remove old line and re-create with updated price
        try { cs.removePriceLine(existingPl); } catch { /* ignore */ }
      }

      const pl = cs.createPriceLine({
        price: pos.entryPrice,
        color,
        lineWidth: 1,
        lineStyle: 0,
        axisLabelVisible: true,
        title: `${label} Entry`,
      } as PriceLineOptions);
      existing.set(key, pl);
    }
  }, [positions, selectedSymbol]);

  // ── SSE ─────────────────────────────────────────────────────────────────
  useSSE((event) => {
    if (event.type === "position:open" || event.type === "position:close" || event.type === "position:update" || event.type === "order:created" || event.type === "order:update") {
      void fetchCapability();
      void fetchPositions();
      void fetchOrders();
      void fetchAccount();
    }
  });

  // ── Actions ─────────────────────────────────────────────────────────────
  const showFlash = (ok: boolean, text: string) => {
    setFlash({ ok, text });
    setTimeout(() => setFlash(null), 5000);
  };

  const setPctOfBalance = (pct: number) => {
    if (balance <= 0) return;
    setAmountUsdt(Math.round((balance * pct) / 100));
  };

  const handlePlaceOrder = async (side: "long" | "short") => {
    if (amountUsdt <= 0 || currentPrice === 0) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        symbol: selectedSymbol,
        positionSide: side,
        orderType,
        quantity: notionalQty,
        leverage,
        marginMode,
      };
      if (orderType === "LIMIT") body["limitPrice"] = limitPrice;
      if (showTpSl && tpTrigger > 0) body["tpPrice"] = tpTrigger;
      if (showTpSl && slTrigger > 0) body["slPrice"] = slTrigger;

      const r = await fetch(`${SERVER_URL}/api/futures/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() } as HeadersInit,
        body: JSON.stringify(body),
      });
      const d = await r.json() as { ok?: boolean; error?: string; paper?: boolean };
      if (!d.ok) throw new Error(d.error ?? "Order failed");

      const modeLabel = d.paper ? "Paper" : "Live";
      const sideLabel = side === "long" ? "LONG" : "SHORT";
      showFlash(true, `Position Opened: ${modeLabel} ${sideLabel} ${selectedSymbol} @ $${fmt(currentPrice)} (${leverage}x · $${fmt(amountUsdt)} margin)`);

      // Refresh positions, orders, account from the backend (which handles paper + live)
      void fetchPositions();
      void fetchOrders();
      void fetchAccount();
      void onRefreshStatus?.();

      setAmountUsdt(0);
    } catch (e) {
      showFlash(false, e instanceof Error ? e.message : "Order failed");
    } finally {
      setBusy(false);
    }
  };

  const closePosition = async (pos: FuturesPosition) => {
    setClosingSymbol(pos.symbol);
    try {
      const r = await fetch(`${SERVER_URL}/api/futures/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() } as HeadersInit,
        body: JSON.stringify({ symbol: pos.symbol, positionSide: pos.side, amount: pos.contracts }),
      });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (!d.ok) throw new Error(d.error ?? "Close failed");
      showFlash(true, `Closed ${pos.symbol} ${pos.side.toUpperCase()}.`);
      void fetchPositions();
      void fetchOrders();
      void fetchAccount();
      void onRefreshStatus?.();
    } catch (e) {
      showFlash(false, e instanceof Error ? e.message : "Close failed");
    } finally {
      setClosingSymbol(null);
    }
  };

  const cancelOrder = async (orderId: string, sym: string) => {
    try {
      const r = await fetch(`${SERVER_URL}/api/futures/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() } as HeadersInit,
        body: JSON.stringify({ symbol: sym, orderId }),
      });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (!d.ok) throw new Error(d.error ?? "Cancel failed");
      showFlash(true, "Order cancelled.");
      void fetchOrders();
    } catch (e) {
      showFlash(false, e instanceof Error ? e.message : "Cancel failed");
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 min-h-0 overflow-hidden flex-col bg-[#0d1117]">
      {/* Capability warning — hidden in paper mode */}
      {!isPaper && !capLoading && !canTrade && (
        <div className="flex items-start gap-2.5 mx-4 mt-3 px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px]">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <div>
            <div className="font-black uppercase tracking-wide mb-0.5">Futures trading unavailable</div>
            <div className="text-amber-400/80 leading-relaxed">
              {cap?.reason ?? "This Gate.io connection doesn't have futures permission enabled."}
              {" "}Every control below is real — it stays disabled until this is resolved.
            </div>
          </div>
        </div>
      )}

      {/* Account bar */}
      <AccountBar account={account} isPaper={isPaper} />

      {/* Ticker bar */}
      <TickerBar ticker={ticker} funding={funding} />

      {/* Main content: Markets sidebar | Chart placeholder | Order Book + Order Entry */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Markets sidebar */}
        {showMarkets && (
          <div className="w-[180px] flex-shrink-0 border-r border-white/[0.06] flex flex-col bg-[#0a0e14]">
            <div className="px-3 py-2 border-b border-white/[0.06]">
              <span className="text-[10px] text-slate-600 font-black uppercase tracking-wider">Perp Markets</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {FUTURES_SYMBOLS.map((sym) => {
                const isActive = sym === selectedSymbol;
                const baseCoin = sym.split("/")[0];
                const coinP = prices.find(p => p.symbol === baseCoin);
                const chg = coinP?.changePercent24h ?? 0;
                return (
                  <button key={sym} onClick={() => setSelectedSymbol(sym)}
                    className={`w-full flex items-center justify-between px-3 py-1.5 text-[11px] transition ${isActive ? "bg-cyan-500/10 border-l-2 border-cyan-500" : "hover:bg-white/[0.03] border-l-2 border-transparent"}`}>
                    <span className={`font-black ${isActive ? "text-white" : "text-slate-400"}`}>{baseCoin}</span>
                    <span className={`font-bold ${chg >= 0 ? "text-[#0ECB81]" : "text-[#F6465D]"}`}>
                      {chg >= 0 ? "+" : ""}{chg.toFixed(2)}%
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Live Futures Chart */}
        <div className="relative flex-1 min-h-0 flex flex-col bg-[#0d1117]">
          <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.06]">
            <button onClick={() => setShowMarkets(v => !v)} className="text-slate-600 hover:text-slate-300 transition">
              {showMarkets ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </button>
            <div className="flex items-center gap-3 text-[11px]">
              <span className="font-black text-white text-sm">{selectedSymbol}</span>
              <span className="text-slate-700">|</span>
              {/* Timeframe selector */}
              <div className="flex items-center gap-0.5">
                {TIMEFRAMES.map((tf) => (
                  <button key={tf.value} onClick={() => setTimeframe(tf.value)}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition ${timeframe === tf.value ? "bg-cyan-500/20 text-cyan-400" : "text-slate-600 hover:text-slate-400"}`}>
                    {tf.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {ticker && (
                <span className={`font-black text-sm ${ticker.last >= (ticker.bid + ticker.ask) / 2 ? "text-[#0ECB81]" : "text-[#F6465D]"}`}>
                  ${fmt(ticker.last, ticker.last >= 100 ? 2 : 4)}
                </span>
              )}
            </div>
          </div>
          {/* Drawing tools overlay */}
          <div className="absolute bottom-3 left-3 z-10 flex items-center gap-1 bg-[#0a0e14]/80 backdrop-blur-sm rounded border border-white/[0.08] px-1.5 py-1">
            <button className="p-1 text-slate-500 hover:text-slate-300 hover:bg-white/[0.06] rounded transition" title="Chart Tools">
              <BarChart3 size={13} />
            </button>
          </div>
          <div ref={chartContainerRef} className="flex-1 min-h-0" />
        </div>

        {/* Right panel: Order Book + Order Entry */}
        <div className="w-[520px] h-full flex-shrink-0 flex flex-col border-l border-white/[0.06] bg-[#0a0e14]">
          {/* Order Book */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <OrderBook data={orderBook} lastPrice={currentPrice} />
          </div>

          {/* Order Entry */}
          <div className="h-[340px] flex-shrink-0 border-t border-white/[0.06] flex flex-col overflow-hidden">
            {/* Long/Short tabs */}
            <div className="grid grid-cols-2 gap-0 border-b border-white/[0.06]">
              <button onClick={() => setPositionSide("long")}
                className={`py-2.5 font-black text-xs transition ${positionSide === "long" ? "bg-[#0ECB81] text-black" : "text-slate-600 hover:text-[#0ECB81] bg-transparent"}`}>
                Open Long
              </button>
              <button onClick={() => setPositionSide("short")}
                className={`py-2.5 font-black text-xs transition ${positionSide === "short" ? "bg-[#F6465D] text-white" : "text-slate-600 hover:text-[#F6465D] bg-transparent"}`}>
                Open Short
              </button>
            </div>

            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-2">
              {/* Margin mode + Leverage */}
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setMarginMode(m => m === "isolated" ? "cross" : "isolated")}
                  className="py-1.5 rounded text-[11px] font-black bg-white/[0.04] border border-white/[0.08] text-slate-300 capitalize hover:border-white/[0.15] transition">
                  {marginMode}
                </button>
                <select value={leverage} onChange={e => setLeverage(Number(e.target.value))}
                  className="py-1.5 rounded text-[11px] font-black bg-white/[0.04] border border-white/[0.08] text-slate-300 text-center appearance-none cursor-pointer">
                  {LEVERAGE_PRESETS.map(l => <option key={l} value={l}>{l}x</option>)}
                </select>
              </div>

              {/* Market/Limit toggle */}
              <div className="flex gap-0 bg-white/[0.04] rounded p-0.5">
                <button onClick={() => setOrderType("MARKET")}
                  className={`flex-1 py-1 rounded text-[11px] font-black transition ${orderType === "MARKET" ? "bg-white/10 text-white" : "text-slate-600 hover:text-slate-400"}`}>
                  Market
                </button>
                <button onClick={() => setOrderType("LIMIT")}
                  className={`flex-1 py-1 rounded text-[11px] font-black transition ${orderType === "LIMIT" ? "bg-white/10 text-white" : "text-slate-600 hover:text-slate-400"}`}>
                  Limit
                </button>
              </div>

              {/* Limit price */}
              {orderType === "LIMIT" && (
                <div>
                  <label className="block text-[10px] text-slate-600 mb-0.5 uppercase tracking-wider">Limit Price</label>
                  <input type="number" value={limitPrice > 0 ? limitPrice : ""} placeholder={currentPrice > 0 ? fmt(currentPrice) : "Price"}
                    onChange={e => setLimitPrice(Number(e.target.value) || 0)}
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-cyan-500/40" />
                </div>
              )}

              {/* Margin amount */}
              <div>
                <label className="block text-[10px] text-slate-600 mb-0.5 uppercase tracking-wider">Margin (USDT)</label>
                <input type="number" min={0} step={10} value={amountUsdt || ""}
                  onChange={e => setAmountUsdt(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-cyan-500/40" />
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-[10px] text-slate-700 font-mono">
                    {notionalQty > 0 ? `≈ ${notionalQty.toFixed(6)} ${base} (${leverage}x)` : "—"}
                  </span>
                  <span className="text-[10px] text-slate-700">Bal: ${fmt(balance)}</span>
                </div>
              </div>

              {/* Percentage buttons */}
              <div className="grid grid-cols-4 gap-1">
                {[25, 50, 75, 100].map(pct => (
                  <button key={pct} onClick={() => setPctOfBalance(pct)} disabled={balance === 0}
                    className="py-0.5 rounded text-[10px] font-black border border-white/[0.08] text-slate-600 hover:text-slate-400 hover:border-white/[0.15] disabled:opacity-30 transition">
                    {pct}%
                  </button>
                ))}
              </div>

              {/* Order summary */}
              <div className="grid grid-cols-2 gap-2 w-full">
                <div className="flex justify-between items-center text-xs py-1 px-2 rounded bg-slate-800/60">
                  <span className="text-slate-400">Margin</span>
                  <span className="font-mono text-white">${fmt(requiredMargin)}</span>
                </div>
                <div className="flex justify-between items-center text-xs py-1 px-2 rounded bg-slate-800/60">
                  <span className="text-slate-400">Order Value</span>
                  <span className="font-mono text-white">${fmt(notionalQty * currentPrice)}</span>
                </div>
                <div className="col-span-2 flex justify-between items-center text-xs py-1 px-2 rounded bg-slate-800/60">
                  <span className="text-slate-400">Est. Liq. Price</span>
                  <span className={`font-mono ${estLiquidation && estLiquidation > 0 ? "text-amber-500" : "text-slate-500"}`}>
                    {estLiquidation && estLiquidation > 0 ? `$${fmt(estLiquidation)}` : "—"}
                  </span>
                </div>
              </div>

              {/* TP/SL toggle */}
              <div>
                <button onClick={() => setShowTpSl(v => !v)} className="flex items-center gap-1.5 text-[10px] font-black text-slate-500 hover:text-slate-300 transition">
                  <span className={`w-3 h-3 rounded-sm border-2 flex items-center justify-center transition ${showTpSl ? "bg-cyan-500 border-cyan-500" : "border-slate-700"}`}>
                    {showTpSl && <span className="block w-1 h-1 bg-white rounded-sm" />}
                  </span>
                  TP/SL
                </button>
                {showTpSl && (
                  <div className="grid grid-cols-2 gap-2 mt-1.5">
                    <div>
                      <label className="block text-[9px] text-[#0ECB81] mb-0.5 uppercase tracking-wider">TP Trigger</label>
                      <input type="number" value={tpTrigger || ""} onChange={e => setTpTrigger(Number(e.target.value) || 0)}
                        className="w-full bg-white/[0.04] border border-[#0ECB81]/20 rounded px-2 py-1 text-[11px] text-white font-mono focus:outline-none focus:border-[#0ECB81]/40" />
                    </div>
                    <div>
                      <label className="block text-[9px] text-[#F6465D] mb-0.5 uppercase tracking-wider">SL Trigger</label>
                      <input type="number" value={slTrigger || ""} onChange={e => setSlTrigger(Number(e.target.value) || 0)}
                        className="w-full bg-white/[0.04] border border-[#F6465D]/20 rounded px-2 py-1 text-[11px] text-white font-mono focus:outline-none focus:border-[#F6465D]/40" />
                    </div>
                  </div>
                )}
              </div>

              {/* Flash message */}
              {flash && (
                <div className={`flex items-start gap-1.5 rounded text-[11px] px-2.5 py-1.5 ${flash.ok ? "bg-[#0ECB81]/10 border border-[#0ECB81]/20 text-[#0ECB81]" : "bg-[#F6465D]/10 border border-[#F6465D]/20 text-[#F6465D]"}`}>
                  {flash.ok ? <CheckCircle2 size={11} className="shrink-0 mt-0.5" /> : <AlertTriangle size={11} className="shrink-0 mt-0.5" />}
                  <span>{flash.text}</span>
                </div>
              )}
              </div>

              {/* Pinned submit area */}
              <div className="flex-shrink-0 px-3 pb-2 pt-1.5 border-t border-white/[0.04]">
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => void handlePlaceOrder("long")}
                  disabled={busy || amountUsdt <= 0 || currentPrice === 0 || (!isPaper && !canTrade)}
                  title={!isPaper && !canTrade ? (cap?.reason ?? "Futures trading unavailable") : undefined}
                  className="py-2.5 rounded font-black text-xs transition disabled:opacity-40 disabled:cursor-not-allowed bg-[#0ECB81] hover:bg-[#0ab36e] text-black">
                  {busy ? "…" : "Open Long"}
                </button>
                <button onClick={() => void handlePlaceOrder("short")}
                  disabled={busy || amountUsdt <= 0 || currentPrice === 0 || (!isPaper && !canTrade)}
                  title={!isPaper && !canTrade ? (cap?.reason ?? "Futures trading unavailable") : undefined}
                  className="py-2.5 rounded font-black text-xs transition disabled:opacity-40 disabled:cursor-not-allowed bg-[#F6465D] hover:bg-[#d93a4e] text-white">
                  {busy ? "…" : "Open Short"}
                </button>
              </div>

              <div className="text-[9px] text-slate-700 text-center mt-1">
                {isPaper ? "Paper" : "Gate.io"} Futures · {marginMode} · {leverage}x
              </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom panel: Positions / Orders / History */}
      <div className="h-[200px] flex-shrink-0 border-t border-white/[0.06] flex flex-col bg-[#0a0e14]">
        <div className="flex items-center border-b border-white/[0.06] flex-shrink-0">
          {([
            { key: "positions" as const, label: "Positions", count: positions.length, icon: <TrendingUp size={11} /> },
            { key: "orders" as const, label: "Open Orders", count: orders.filter(o => o.status === "open" || o.status === "pending").length, icon: <Clock3 size={11} /> },
            { key: "history" as const, label: "Order History", count: orders.filter(o => o.status === "filled" || o.status === "cancelled").length, icon: <History size={11} /> },
          ]).map(({ key, label, count, icon }) => (
            <button key={key} onClick={() => setBottomTab(key)}
              className={`flex items-center gap-1.5 px-4 py-2 text-[11px] font-black uppercase tracking-wider border-b-2 transition ${bottomTab === key ? "border-cyan-500 text-cyan-500" : "border-transparent text-slate-600 hover:text-slate-400"}`}>
              {icon}{label}
              {count > 0 && <span className="ml-0.5 px-1 rounded bg-white/10 text-[9px] font-black">{count}</span>}
            </button>
          ))}
          <div className="ml-auto pr-3">
            <span className="text-[10px] text-slate-700">
              uPnL: <span className={totalUnrealizedPnl >= 0 ? "text-[#0ECB81]" : "text-[#F6465D]"}>
                {totalUnrealizedPnl >= 0 ? "+" : ""}${fmt(totalUnrealizedPnl)}
              </span>
            </span>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {bottomTab === "positions" ? (
            positions.length === 0 ? (
              <div className="py-6 text-center text-slate-700 text-xs">
                {canTrade ? "No open futures positions." : "Connect futures-enabled keys to see positions."}
              </div>
            ) : (
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-slate-600 text-left border-b border-white/[0.06]">
                    <th className="px-3 py-1.5 font-normal">Symbol</th>
                    <th className="px-3 py-1.5 font-normal">Side</th>
                    <th className="px-3 py-1.5 font-normal">Size</th>
                    <th className="px-3 py-1.5 font-normal">Entry</th>
                    <th className="px-3 py-1.5 font-normal">Mark</th>
                    <th className="px-3 py-1.5 font-normal">Liq.</th>
                    <th className="px-3 py-1.5 font-normal">uPnL</th>
                    <th className="px-3 py-1.5 font-normal">Margin</th>
                    <th className="px-3 py-1.5 font-normal"></th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map(p => (
                    <tr key={`${p.symbol}-${p.side}`} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                      <td className="px-3 py-1.5 font-black text-white">{p.symbol}</td>
                      <td className={`px-3 py-1.5 font-black ${p.side === "long" ? "text-[#0ECB81]" : "text-[#F6465D]"}`}>
                        {p.side.toUpperCase()} {p.leverage}x
                      </td>
                      <td className="px-3 py-1.5 font-mono text-slate-300">{p.contracts.toFixed(6)}</td>
                      <td className="px-3 py-1.5 font-mono text-slate-300">${fmt(p.entryPrice)}</td>
                      <td className="px-3 py-1.5 font-mono text-slate-300">${fmt(p.markPrice)}</td>
                      <td className="px-3 py-1.5 font-mono text-amber-500">
                        {p.liquidationPrice ? `$${fmt(p.liquidationPrice)}` : "—"}
                      </td>
                      <td className={`px-3 py-1.5 font-mono ${p.unrealizedPnl >= 0 ? "text-[#0ECB81]" : "text-[#F6465D]"}`}>
                        {p.unrealizedPnl >= 0 ? "+" : ""}${fmt(p.unrealizedPnl)}
                        <span className="text-slate-600 ml-1">
                          ({fmtPct(p.entryPrice > 0 ? ((p.markPrice - p.entryPrice) / p.entryPrice * 100 * (p.side === "long" ? 1 : -1)) * p.leverage : 0)})
                        </span>
                      </td>
                      <td className="px-3 py-1.5 font-mono text-slate-400">${fmt(p.initialMargin)}</td>
                      <td className="px-3 py-1.5 text-right">
                        <button onClick={() => void closePosition(p)} disabled={closingSymbol === p.symbol}
                          className="text-[10px] font-black text-slate-500 hover:text-white border border-white/[0.1] rounded px-2 py-0.5 disabled:opacity-40 transition">
                          {closingSymbol === p.symbol ? "…" : "Close"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : bottomTab === "orders" ? (
            orders.filter(o => o.status === "open" || o.status === "pending").length === 0 ? (
              <div className="py-6 text-center text-slate-700 text-xs">No open orders.</div>
            ) : (
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-slate-600 text-left border-b border-white/[0.06]">
                    <th className="px-3 py-1.5 font-normal">Time</th>
                    <th className="px-3 py-1.5 font-normal">Symbol</th>
                    <th className="px-3 py-1.5 font-normal">Side</th>
                    <th className="px-3 py-1.5 font-normal">Type</th>
                    <th className="px-3 py-1.5 font-normal">Price</th>
                    <th className="px-3 py-1.5 font-normal">Qty</th>
                    <th className="px-3 py-1.5 font-normal">Status</th>
                    <th className="px-3 py-1.5 font-normal"></th>
                  </tr>
                </thead>
                <tbody>
                  {orders.filter(o => o.status === "open" || o.status === "pending").map(o => (
                    <tr key={o.orderId} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                      <td className="px-3 py-1.5 text-slate-500">{new Date(o.createdAt).toLocaleTimeString()}</td>
                      <td className="px-3 py-1.5 font-black text-white">{o.symbol}</td>
                      <td className={`px-3 py-1.5 font-black ${o.positionSide === "long" ? "text-[#0ECB81]" : "text-[#F6465D]"}`}>
                        {(o.positionSide ?? "—").toUpperCase()} {o.leverage ?? ""}x
                      </td>
                      <td className="px-3 py-1.5 text-slate-400">{o.orderType}</td>
                      <td className="px-3 py-1.5 font-mono text-slate-300">
                        {o.limitPrice ? `$${fmt(Number(o.limitPrice))}` : "Market"}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-slate-300">{o.quantity}</td>
                      <td className="px-3 py-1.5 text-amber-400">{o.status}</td>
                      <td className="px-3 py-1.5 text-right">
                        <button onClick={() => void cancelOrder(o.orderId, o.symbol)}
                          className="text-[10px] font-black text-slate-500 hover:text-[#F6465D] border border-white/[0.1] rounded px-2 py-0.5 transition">
                          Cancel
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : (
            orders.length === 0 ? (
              <div className="py-6 text-center text-slate-700 text-xs">No order history.</div>
            ) : (
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-slate-600 text-left border-b border-white/[0.06]">
                    <th className="px-3 py-1.5 font-normal">Time</th>
                    <th className="px-3 py-1.5 font-normal">Symbol</th>
                    <th className="px-3 py-1.5 font-normal">Side</th>
                    <th className="px-3 py-1.5 font-normal">Type</th>
                    <th className="px-3 py-1.5 font-normal">Price</th>
                    <th className="px-3 py-1.5 font-normal">Qty</th>
                    <th className="px-3 py-1.5 font-normal">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.slice(0, 50).map(o => (
                    <tr key={o.orderId} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                      <td className="px-3 py-1.5 text-slate-500">{new Date(o.createdAt).toLocaleString()}</td>
                      <td className="px-3 py-1.5 font-black text-white">{o.symbol}</td>
                      <td className={`px-3 py-1.5 font-black ${o.positionSide === "long" ? "text-[#0ECB81]" : o.positionSide === "short" ? "text-[#F6465D]" : "text-slate-400"}`}>
                        {(o.side ?? o.positionSide ?? "—").toUpperCase()}
                      </td>
                      <td className="px-3 py-1.5 text-slate-400">{o.orderType}</td>
                      <td className="px-3 py-1.5 font-mono text-slate-300">
                        {o.limitPrice ? `$${fmt(Number(o.limitPrice))}` : "Market"}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-slate-300">{o.quantity}</td>
                      <td className="px-3 py-1.5">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${
                          o.status === "filled" ? "bg-[#0ECB81]/10 text-[#0ECB81]" :
                          o.status === "cancelled" ? "bg-slate-500/10 text-slate-500" :
                          o.status === "open" || o.status === "pending" ? "bg-amber-500/10 text-amber-400" :
                          "bg-[#F6465D]/10 text-[#F6465D]"
                        }`}>
                          {o.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </div>
      </div>
    </div>
  );
}

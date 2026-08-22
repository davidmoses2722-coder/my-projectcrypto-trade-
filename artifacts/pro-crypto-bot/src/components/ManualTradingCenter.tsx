/**
 * ManualTradingCenter — BingX-Style Professional Trading Terminal
 *
 * Backend endpoints used:
 *   GET  /api/market/tickers          Real Gate.io tickers (MarketListPanel)
 *   GET  /api/market/candles          Real Gate.io OHLCV
 *   GET  /api/market/orderbook        Real Gate.io depth
 *   GET  /api/market/trades           Real Gate.io trade tape
 *   GET  /api/manual-trading/status   Bot capabilities
 *   POST /api/manual-trading/order    Open/close via BullMQ pipeline
 *   POST /api/positions/:sym/close|take-profit|breakeven|trailing|lock-profit
 *   GET  /api/positions/live          Lifecycle badges (trailing/breakeven/locked)
 *   GET  /api/orders                  Open (resting) orders
 *   GET  /api/orders/history          Filled/cancelled order history
 *   GET  /api/trade-journal           Closed trade history
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Activity, AlertTriangle, BookOpen, CheckCircle2,
  Clock3, History, Layers3, RefreshCw,
  ShieldCheck, TrendingUp, WalletCards, X,
  ChevronLeft, ChevronRight, Search, Star, ChevronDown,
} from "lucide-react";
import type { IChartApi, ISeriesApi, IPriceLine, UTCTimestamp } from "lightweight-charts";
import { createChart, ColorType, LineStyle, CrosshairMode } from "lightweight-charts";
import type { CoinPrice } from "../types/crypto";
import type {
  ServerStatus, ConnectionState, PortfolioPosition,
} from "../hooks/useBotServer";
import { SERVER_URL } from "../config/urls";
import { useSSE } from "../hooks/useSSE";
import { FuturesTerminal } from "./FuturesTerminal";
import { FloatingToolbar } from "./terminal/FloatingToolbar";
import { DrawingCanvas } from "./terminal/drawings/DrawingCanvas";
import { useDrawingEngine } from "./terminal/drawings/useDrawingEngine";

// ── Types ─────────────────────────────────────────────────────────────────────

type Candle    = { time: number; open: number; high: number; low: number; close: number; volume: number };
type OBLevel   = [string, string]; // [price, size]
type OrderSide = "BUY" | "SELL";
type BottomTab  = "positions" | "orders" | "orderHistory" | "history";
type OrderType  = "MARKET" | "LIMIT";

interface OpenOrder {
  orderId:           string;
  symbol:            string;
  side:              string;
  orderType:         string;
  limitPrice:        string | null;
  quantity:          string;
  filledQuantity:    string;
  remainingQuantity: string;
  status:            string;
  createdAt:         string;
  isPaper:           boolean;
  exchangeOrderId:   string | null;
}

interface JournalEntry {
  id?:          string;
  symbol?:      string;
  side?:        string;
  entryPrice?:  number;
  exitPrice?:   number;
  entry?:       number;
  exit?:        number;
  sizeUsdt?:    number;
  qty?:         number;
  pnlUsd?:      number;
  pnlPct?:      number;
  exitReason?:  string;
  reason?:      string;
  strategy?:    string;
  durationMs?:  number;
  holdMins?:    number;
  dryRun?:      boolean;
  openedAt?:    string | number;
  closedAt?:    string | number;
  time?:        string;
}

interface LifecycleInfo {
  positionId:      string;
  symbol:          string;
  source:          "BOT" | "MANUAL";
  isPaper:         boolean;
  trailingActive:  boolean;
  trailingEnabled: boolean;
  breakevenActive: boolean;
  lockedProfitPct: number;
}

interface ConfirmAction {
  label:  string;
  action: () => Promise<void>;
}

interface ReviewParams {
  symbol:    string;
  side:      OrderSide;
  price:     number;
  sizeUsdt:  number;
  qty:       number;
  tpPct:     number;
  slPct:     number;
  tpPrice:   number;
  slPrice:   number;
  rr:        number;
  estProfit: number;
  estLoss:   number;
  estFees:   number;
  strategy:  string;
  isPaper:   boolean;
}

interface Props {
  prices:     CoinPrice[];
  status:     ServerStatus;
  connection: ConnectionState;
  onRefreshStatus?: () => Promise<void>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MARKET_SYMBOLS = [
  { pair: "BTC_USDT", display: "BTC/USDT", base: "BTC" },
  { pair: "ETH_USDT", display: "ETH/USDT", base: "ETH" },
  { pair: "SOL_USDT", display: "SOL/USDT", base: "SOL" },
  { pair: "BNB_USDT", display: "BNB/USDT", base: "BNB" },
  { pair: "XRP_USDT", display: "XRP/USDT", base: "XRP" },
  { pair: "ADA_USDT", display: "ADA/USDT", base: "ADA" },
  { pair: "AVAX_USDT", display: "AVAX/USDT", base: "AVAX" },
  { pair: "DOGE_USDT", display: "DOGE/USDT", base: "DOGE" },
];

type TF = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d";
const TIMEFRAMES: TF[] = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"];

const EST_FEE_PCT  = 0.001;
const MIN_SIZE_USDT = 10;

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number, decimals?: number): string => {
  if (!Number.isFinite(n)) return "—";
  if (decimals !== undefined) return n.toFixed(decimals);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (n >= 1)        return n.toFixed(2);
  if (n >= 0.01)     return n.toFixed(4);
  return n.toFixed(6);
};

const fmtPct = (n: number): string =>
  `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

const elapsedStr = (ms: number): string => {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 60_000)    return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
};

const pair2symbol = (pair: string): string => pair.replace("_", "");

const authHeaders = (): Record<string, string> => {
  const token = localStorage.getItem("pcb_jwt");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

// ── Indicator math ─────────────────────────────────────────────────────────────

function computeEMA(candles: Candle[], period: number): { time: number; value: number }[] {
  if (candles.length < period) return [];
  const k = 2 / (period + 1);
  const out: { time: number; value: number }[] = [];
  let ema = candles.slice(0, period).reduce((s, c) => s + c.close, 0) / period;
  out.push({ time: candles[period - 1]!.time, value: ema });
  for (let i = period; i < candles.length; i++) {
    ema = candles[i]!.close * k + ema * (1 - k);
    out.push({ time: candles[i]!.time, value: ema });
  }
  return out;
}

function computeRSI(candles: Candle[], period = 14): { time: number; value: number }[] {
  if (candles.length < period + 1) return [];
  const out: { time: number; value: number }[] = [];
  let gainSum = 0, lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = candles[i]!.close - candles[i - 1]!.close;
    if (diff >= 0) gainSum += diff; else lossSum -= diff;
  }
  let avgGain = gainSum / period, avgLoss = lossSum / period;
  const rsiAt = (ag: number, al: number) => al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  out.push({ time: candles[period]!.time, value: rsiAt(avgGain, avgLoss) });
  for (let i = period + 1; i < candles.length; i++) {
    const diff = candles[i]!.close - candles[i - 1]!.close;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out.push({ time: candles[i]!.time, value: rsiAt(avgGain, avgLoss) });
  }
  return out;
}

function computeATR(candles: Candle[], period = 14): { time: number; value: number }[] {
  if (candles.length < period + 1) return [];
  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!, p = candles[i - 1]!;
    trueRanges.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const out: { time: number; value: number }[] = [];
  let atr = trueRanges.slice(0, period).reduce((s, v) => s + v, 0) / period;
  out.push({ time: candles[period]!.time, value: atr });
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]!) / period;
    out.push({ time: candles[i + 1]!.time, value: atr });
  }
  return out;
}

// ── MarketListPanel ────────────────────────────────────────────────────────────

interface GateTicker {
  currency_pair: string;
  last: string;
  change_percentage: string;
  base_volume: string;
  quote_volume: string;
  high_24h?: string;
  low_24h?: string;
}

interface MarketRow {
  pair: string; base: string; quote: string; last: number; changePct: number; quoteVolume: number;
  high24h: number; low24h: number;
}

function MarketListPanel({ currentPair, onSelect, collapsed, onToggleCollapsed, onRowsChange }: {
  currentPair: string;
  onSelect: (pair: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onRowsChange: (rows: MarketRow[]) => void;
}) {
  const [rows, setRows]       = useState<MarketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState(false);
  const [query, setQuery]     = useState("");
  const [quoteFilter, setQuoteFilter] = useState<"USDT" | "USDC" | "ALL">("USDT");
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("et_favorites") ?? "[]") as string[]); }
    catch { return new Set(); }
  });
  const [showFavOnly, setShowFavOnly] = useState(false);

  const toggleFav = (pair: string) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(pair)) next.delete(pair); else next.add(pair);
      try { localStorage.setItem("et_favorites", JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  };

  const fetchTickers = useCallback(async () => {
    try {
      const r = await fetch(`${SERVER_URL}/api/market/tickers`);
      const data = await r.json() as GateTicker[] | { error?: string };
      if (!Array.isArray(data)) { setErr(true); return; }
      const parsed: MarketRow[] = data
        .map(t => {
          const [base, quote] = t.currency_pair.split("_");
          return {
            pair: t.currency_pair, base: base ?? "", quote: quote ?? "",
            last: Number(t.last) || 0,
            changePct: Number(t.change_percentage) || 0,
            quoteVolume: Number(t.quote_volume) || 0,
            high24h: Number(t.high_24h) || 0,
            low24h: Number(t.low_24h) || 0,
          };
        })
        .filter(r => r.base && r.quote && r.last > 0);
      setRows(parsed);
      onRowsChange(parsed);
      setErr(false);
    } catch { setErr(true); }
    finally { setLoading(false); }
  }, [onRowsChange]);

  useEffect(() => {
    void fetchTickers();
    const id = setInterval(fetchTickers, 15_000);
    return () => clearInterval(id);
  }, [fetchTickers]);

  const filtered = useMemo(() => {
    let list = rows;
    if (quoteFilter !== "ALL") list = list.filter(r => r.quote === quoteFilter);
    if (showFavOnly) list = list.filter(r => favorites.has(r.pair));
    if (query.trim()) {
      const q = query.trim().toUpperCase();
      list = list.filter(r => r.base.includes(q) || r.pair.includes(q));
    }
    return [...list].sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, 150);
  }, [rows, quoteFilter, showFavOnly, query, favorites]);

  if (collapsed) {
    return (
      <button
        onClick={onToggleCollapsed}
        className="flex flex-col items-center justify-start gap-2 py-4 w-full h-full hover:bg-white/5 transition"
        title="Expand market list"
      >
        <ChevronRight size={14} className="text-slate-600" />
        <span className="text-[9px] text-slate-700 [writing-mode:vertical-rl] tracking-widest uppercase font-black">Markets</span>
      </button>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Markets</span>
        <button onClick={onToggleCollapsed} className="text-slate-700 hover:text-slate-400 transition">
          <ChevronLeft size={13} />
        </button>
      </div>

      {/* Search */}
      <div className="px-2 py-2 border-b border-white/[0.06]">
        <div className="relative">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-600" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search…"
            className="w-full bg-white/[0.04] border border-white/[0.06] rounded-md pl-6 pr-2 py-1.5 text-[11px] text-white placeholder:text-slate-700 focus:outline-none focus:border-cyan-500/30"
          />
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-white/[0.06]">
        <button
          onClick={() => setShowFavOnly(v => !v)}
          className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black transition ${
            showFavOnly ? "text-amber-400" : "text-slate-600 hover:text-slate-400"
          }`}
        >
          <Star size={10} fill={showFavOnly ? "currentColor" : "none"} />
        </button>
        {(["USDT", "USDC", "ALL"] as const).map(q => (
          <button key={q} onClick={() => setQuoteFilter(q)}
            className={`px-2 py-0.5 rounded text-[10px] font-black transition ${
              quoteFilter === q
                ? "bg-white/10 text-white"
                : "text-slate-600 hover:text-slate-400"
            }`}
          >
            {q}
          </button>
        ))}
      </div>

      {/* Column headers */}
      <div className="flex items-center px-2 py-1 text-[9px] uppercase tracking-wider text-slate-700 border-b border-white/[0.04]">
        <span className="flex-1">Pair</span>
        <span className="w-16 text-right">Price</span>
        <span className="w-12 text-right">24h</span>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="py-8 text-center text-slate-700 text-[11px]">Loading…</div>
        ) : err ? (
          <div className="py-8 text-center text-rose-500 text-[11px]">Unavailable</div>
        ) : filtered.length === 0 ? (
          <div className="py-8 text-center text-slate-700 text-[11px]">No results</div>
        ) : (
          filtered.map(r => (
            <button
              key={r.pair}
              onClick={() => onSelect(r.pair)}
              className={`w-full flex items-center px-2 py-1.5 text-left transition border-l-2 ${
                currentPair === r.pair
                  ? "bg-cyan-500/[0.08] border-cyan-500"
                  : "border-transparent hover:bg-white/[0.03]"
              }`}
            >
              <span className="flex-1 flex items-center gap-1 min-w-0">
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={e => { e.stopPropagation(); toggleFav(r.pair); }}
                  className="shrink-0"
                >
                  <Star
                    size={9}
                    className={favorites.has(r.pair) ? "text-amber-400" : "text-slate-800"}
                    fill={favorites.has(r.pair) ? "currentColor" : "none"}
                  />
                </span>
                <span className="text-[11px] font-bold text-white truncate">
                  {r.base}<span className="text-slate-600">/{r.quote}</span>
                </span>
              </span>
              <span className="w-16 text-right text-[11px] font-mono text-slate-300 tabular-nums">
                {r.last < 1 ? r.last.toFixed(5) : r.last.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
              <span className={`w-12 text-right text-[10px] font-black tabular-nums ${r.changePct >= 0 ? "text-[#0ECB81]" : "text-[#F6465D]"}`}>
                {r.changePct >= 0 ? "+" : ""}{r.changePct.toFixed(2)}%
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ── CandleChart ────────────────────────────────────────────────────────────────

interface IndicatorToggles {
  volume: boolean;
  ema9:   boolean;
  ema21:  boolean;
  ema50:  boolean;
  ema200: boolean;
}

interface CandleChartProps {
  candles:    Candle[];
  position:   PortfolioPosition | null;
  loading:    boolean;
  indicators: IndicatorToggles;
  height?:    number;
  engine?:    ReturnType<typeof useDrawingEngine>;
}

const EMA_COLORS: Record<"ema9" | "ema21" | "ema50" | "ema200", string> = {
  ema9:   "#22d3ee",
  ema21:  "#a78bfa",
  ema50:  "#fbbf24",
  ema200: "#f472b6",
};

function CandleChart({ candles, position, loading, indicators, height = 400, engine }: CandleChartProps) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const chartRef      = useRef<IChartApi | null>(null);
  const seriesRef     = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef     = useRef<ISeriesApi<"Histogram"> | null>(null);
  const emaRefs       = useRef<Partial<Record<"ema9" | "ema21" | "ema50" | "ema200", ISeriesApi<"Line">>>>({});
  const linesRef      = useRef<{ entry?: IPriceLine; tp?: IPriceLine; sl?: IPriceLine }>({});
  const [chartReady, setChartReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;

    const chart = createChart(el, {
      width:  el.clientWidth,
      height: height,
      layout: {
        background: { type: ColorType.Solid, color: "#080d15" },
        textColor:  "#64748b",
      },
      grid: {
        vertLines: { color: "#0f172a", style: LineStyle.Dotted },
        horzLines: { color: "#0f172a", style: LineStyle.Dotted },
      },
      crosshair:       { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#1e293b" },
      timeScale:       { borderColor: "#1e293b", timeVisible: true, secondsVisible: false },
      handleScroll:    true,
      handleScale:     true,
    });

    const series = chart.addCandlestickSeries({
      upColor:       "#0ECB81",
      downColor:     "#F6465D",
      borderVisible: false,
      wickUpColor:   "#0ECB81",
      wickDownColor: "#F6465D",
    });

    const volume = chart.addHistogramSeries({
      priceFormat:  { type: "volume" },
      priceScaleId: "vol",
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.83, bottom: 0 } });

    chartRef.current  = chart;
    seriesRef.current = series;
    volumeRef.current = volume;
    setChartReady(true);

    const ro = new ResizeObserver(() => {
      if (el) chart.applyOptions({ width: el.clientWidth });
    });
    ro.observe(el);

    return () => { chart.remove(); ro.disconnect(); setChartReady(false); };
  }, [height]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !candles.length) return;
    try {
      series.setData(
        candles.map(c => ({
          time:  Math.floor(c.time / 1000) as UTCTimestamp,
          open:  c.open,
          high:  c.high,
          low:   c.low,
          close: c.close,
        }))
      );
      volumeRef.current?.setData(
        candles.map(c => ({
          time:  Math.floor(c.time / 1000) as UTCTimestamp,
          value: c.volume,
          color: c.close >= c.open ? "rgba(14,203,129,0.3)" : "rgba(246,70,93,0.3)",
        }))
      );
      chartRef.current?.timeScale().fitContent();
    } catch { /* ignore stale updates */ }
  }, [candles]);

  useEffect(() => {
    volumeRef.current?.applyOptions({ visible: indicators.volume });
  }, [indicators.volume]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    (["ema9", "ema21", "ema50", "ema200"] as const).forEach(key => {
      const period = key === "ema9" ? 9 : key === "ema21" ? 21 : key === "ema50" ? 50 : 200;
      const on = indicators[key];
      if (!on) {
        if (emaRefs.current[key]) {
          try { chart.removeSeries(emaRefs.current[key]!); } catch { /* already gone */ }
          delete emaRefs.current[key];
        }
        return;
      }
      if (!emaRefs.current[key]) {
        emaRefs.current[key] = chart.addLineSeries({
          color: EMA_COLORS[key], lineWidth: 1, priceLineVisible: false,
          lastValueVisible: false, crosshairMarkerVisible: false, title: key.toUpperCase(),
        });
      }
      const points = computeEMA(candles, period);
      try {
        emaRefs.current[key]!.setData(
          points.map(p => ({ time: Math.floor(p.time / 1000) as UTCTimestamp, value: p.value }))
        );
      } catch { /* stale */ }
    });
  }, [candles, indicators.ema9, indicators.ema21, indicators.ema50, indicators.ema200]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    const prev = linesRef.current;
    try { if (prev.entry) series.removePriceLine(prev.entry); } catch {}
    try { if (prev.tp)    series.removePriceLine(prev.tp);    } catch {}
    try { if (prev.sl)    series.removePriceLine(prev.sl);    } catch {}
    linesRef.current = {};

    if (!position) return;

    try {
      linesRef.current.entry = series.createPriceLine({
        price: position.entryPrice, color: "#94a3b8",
        lineWidth: 1, lineStyle: LineStyle.Dashed,
        axisLabelVisible: true, title: "Entry",
      });
      if (position.tpPrice > 0) {
        linesRef.current.tp = series.createPriceLine({
          price: position.tpPrice, color: "#0ECB81",
          lineWidth: 1, lineStyle: LineStyle.Dashed,
          axisLabelVisible: true, title: "TP",
        });
      }
      if (position.slPrice > 0) {
        linesRef.current.sl = series.createPriceLine({
          price: position.slPrice, color: "#F6465D",
          lineWidth: 1, lineStyle: LineStyle.Dashed,
          axisLabelVisible: true, title: "SL",
        });
      }
    } catch { /* series may have been removed */ }
  }, [position]);

  const candlesSeconds = useMemo(
    () => candles.map(c => ({ ...c, time: Math.floor(c.time / 1000) })),
    [candles],
  );
  const barSeconds = candlesSeconds.length > 1 ? candlesSeconds[1].time - candlesSeconds[0].time : 0;

  return (
    <div className="relative w-full flex-shrink-0" style={{ height: `${height}px` }}>
      <div ref={containerRef} className="absolute inset-0 w-full h-full" />
      {chartReady && engine && chartRef.current && seriesRef.current && (
        <DrawingCanvas
          chart={chartRef.current}
          series={seriesRef.current}
          candles={candlesSeconds}
          engine={engine}
          barSeconds={barSeconds}
        />
      )}
      {loading && !candles.length && (
        <div className="absolute inset-0 z-20 flex items-center justify-center text-slate-600 bg-[#080d15]">
          <Activity className="animate-pulse mr-2 text-cyan-500" size={16} />
          <span className="text-xs">Loading chart…</span>
        </div>
      )}
      {!loading && !candles.length && (
        <div className="absolute inset-0 z-20 flex items-center justify-center text-slate-600 text-xs bg-[#080d15]">
          No candle data available
        </div>
      )}
      {loading && !!candles.length && (
        <div className="absolute top-2 right-2 opacity-40">
          <RefreshCw size={11} className="animate-spin text-cyan-500" />
        </div>
      )}
    </div>
  );
}

// ── IndicatorMiniChart ─────────────────────────────────────────────────────────

function IndicatorMiniChart({ points, color, label, bands }: {
  points: { time: number; value: number }[];
  color:  string;
  label:  string;
  bands?: { value: number; color: string }[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef      = useRef<IChartApi | null>(null);
  const seriesRef     = useRef<ISeriesApi<"Line"> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const chart = createChart(el, {
      width: el.clientWidth, height: 90,
      layout: { background: { type: ColorType.Solid, color: "#080d15" }, textColor: "#475569" },
      grid: { vertLines: { visible: false }, horzLines: { color: "#0f172a", style: LineStyle.Dotted } },
      rightPriceScale: { borderColor: "#1e293b" },
      timeScale:       { borderColor: "#1e293b", timeVisible: true, secondsVisible: false },
      crosshair:       { mode: CrosshairMode.Normal },
      handleScroll: true, handleScale: true,
    });
    const series = chart.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: true });
    chartRef.current = chart; seriesRef.current = series;
    for (const b of bands ?? []) {
      series.createPriceLine({ price: b.value, color: b.color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false });
    }
    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }));
    ro.observe(el);
    return () => { chart.remove(); ro.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!seriesRef.current || !points.length) return;
    try {
      seriesRef.current.setData(points.map(p => ({ time: Math.floor(p.time / 1000) as UTCTimestamp, value: p.value })));
      chartRef.current?.timeScale().fitContent();
    } catch { /* stale */ }
  }, [points]);

  return (
    <div className="border-t border-white/[0.04]">
      <div className="px-3 pt-1.5 text-[9px] uppercase tracking-widest text-slate-700 font-black">{label}</div>
      <div ref={containerRef} className="w-full" />
    </div>
  );
}

// ── RecentTrades ───────────────────────────────────────────────────────────────

interface RecentTrade { id: string; time: number; side: string; price: number; qty: number; }

function RecentTrades({ pair }: { pair: string }) {
  const [trades, setTrades] = useState<RecentTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const load = async () => {
      try {
        const r = await fetch(`${SERVER_URL}/api/market/trades?symbol=${pair}&limit=30`);
        const d = await r.json() as { ok?: boolean; trades?: RecentTrade[] };
        if (!cancelled) {
          if (d.ok && d.trades) { setTrades(d.trades); setErr(false); }
          else setErr(true);
        }
      } catch { if (!cancelled) setErr(true); }
      finally { if (!cancelled) setLoading(false); }
    };
    void load();
    const id = setInterval(load, 8000);
    return () => { cancelled = true; clearInterval(id); };
  }, [pair]);

  if (loading) return <div className="py-6 text-center text-slate-700 text-xs">Loading…</div>;
  if (err || trades.length === 0) return <div className="py-6 text-center text-slate-700 text-xs">{err ? "Unavailable" : "No trades"}</div>;

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex items-center px-3 py-1 text-[9px] uppercase tracking-wider text-slate-700 border-b border-white/[0.04] sticky top-0 bg-[#0d1117]">
        <span className="flex-1">Price</span>
        <span className="w-20 text-right">Amount</span>
        <span className="w-16 text-right">Time</span>
      </div>
      {trades.map(t => (
        <div key={t.id} className="flex items-center px-3 py-[3px] text-[11px] tabular-nums hover:bg-white/[0.02]">
          <span className={`flex-1 font-mono font-bold ${t.side === "buy" ? "text-[#0ECB81]" : "text-[#F6465D]"}`}>
            {t.price < 1 ? t.price.toFixed(5) : t.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </span>
          <span className="w-20 text-right font-mono text-slate-500">{t.qty.toFixed(4)}</span>
          <span className="w-16 text-right text-slate-700">{new Date(t.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
        </div>
      ))}
    </div>
  );
}

// ── OrderBook — BingX compact style ───────────────────────────────────────────

function OrderBook({ asks, bids, midPrice }: { asks: OBLevel[]; bids: OBLevel[]; midPrice: number }) {
  const topAsks = asks.slice(0, 8).reverse();
  const topBids = bids.slice(0, 8);

  const spread    = asks[0] && bids[0] ? Number(asks[0][0]) - Number(bids[0][0]) : 0;
  const spreadPct = midPrice > 0 ? (spread / midPrice) * 100 : 0;

  const fmtPrice = (p: number) => p < 10 ? p.toFixed(5) : p < 1000 ? p.toFixed(2) : p.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const fmtQty   = (q: number) => q >= 1000 ? `${(q / 1000).toFixed(2)}K` : q.toFixed(4);

  return (
    <div className="h-full flex flex-col">
      {/* Column headers */}
      <div className="flex justify-between px-3 py-1 text-[9px] uppercase tracking-wider text-slate-700 border-b border-white/[0.04]">
        <span>Price (USDT)</span><span>Amount</span>
      </div>

      {/* Asks */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {topAsks.map((r, i) => {
          const price = Number(r[0]);
          const size  = Number(r[1]);
          return (
            <div key={i} className="flex justify-between items-center px-3 py-[3px] hover:bg-white/[0.02] cursor-default select-none">
              <span className="font-mono text-[12px] font-semibold text-[#F6465D]">{fmtPrice(price)}</span>
              <span className="font-mono text-[11px] text-slate-500">{fmtQty(size)}</span>
            </div>
          );
        })}
      </div>

      {/* Mid price / spread */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#0d1117] border-y border-white/[0.06]">
        <span className="font-mono font-black text-[#0ECB81] text-[14px]">{fmtPrice(midPrice)}</span>
        <span className="text-[10px] text-slate-600">Spread {spreadPct.toFixed(3)}%</span>
      </div>

      {/* Bids */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {topBids.map((r, i) => {
          const price = Number(r[0]);
          const size  = Number(r[1]);
          return (
            <div key={i} className="flex justify-between items-center px-3 py-[3px] hover:bg-white/[0.02] cursor-default select-none">
              <span className="font-mono text-[12px] font-semibold text-[#0ECB81]">{fmtPrice(price)}</span>
              <span className="font-mono text-[11px] text-slate-500">{fmtQty(size)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── ReviewModal ────────────────────────────────────────────────────────────────

function ReviewModal({ params, onConfirm, onCancel, busy }: {
  params:    ReviewParams;
  onConfirm: () => void;
  onCancel:  () => void;
  busy:      boolean;
}) {
  const isBuy = params.side === "BUY";

  const rows: [string, React.ReactNode][] = [
    ["Symbol",        params.symbol],
    ["Direction",     <span className={isBuy ? "text-[#0ECB81] font-black" : "text-[#F6465D] font-black"}>{isBuy ? "LONG / BUY" : "SELL / CLOSE"}</span>],
    ["Order type",    "Market (immediate)"],
    ["Entry price",   `$${fmt(params.price)}`],
    ["Position size", `$${fmt(params.sizeUsdt)}`],
    ["Quantity",      `${params.qty.toFixed(6)}`],
    ["Take profit",   <span className="text-[#0ECB81]">${fmt(params.tpPrice)} (+{params.tpPct.toFixed(2)}%)</span>],
    ["Stop loss",     <span className="text-[#F6465D]">${fmt(params.slPrice)} (-{params.slPct.toFixed(2)}%)</span>],
    ["Risk / Reward", <span className="text-cyan-400">1 : {params.rr.toFixed(2)}</span>],
    ["Est. profit",   <span className="text-[#0ECB81]">+${fmt(params.estProfit)}</span>],
    ["Est. risk",     <span className="text-[#F6465D]">-${fmt(params.estLoss)}</span>],
    ["Est. fees",     `$${fmt(params.estFees)}`],
    ["Strategy",      params.strategy],
    ["Mode",          params.isPaper
      ? <span className="text-blue-400">PAPER (simulated)</span>
      : <span className="text-[#F6465D] animate-pulse">LIVE (real funds)</span>],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-[#131722] border border-white/[0.08] rounded-xl w-full max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black text-white uppercase tracking-wider">Review Order</h3>
          <button onClick={onCancel} className="text-slate-600 hover:text-white transition"><X size={16} /></button>
        </div>

        <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] divide-y divide-white/[0.04]">
          {rows.map(([k, v]) => (
            <div key={String(k)} className="flex justify-between items-center text-xs px-3 py-2">
              <span className="text-slate-600 shrink-0 mr-4">{k}</span>
              <span className="text-white text-right">{v}</span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button onClick={onCancel} disabled={busy}
            className="rounded-lg border border-white/[0.1] text-slate-500 py-3 text-sm font-black hover:bg-white/5 transition">
            Cancel
          </button>
          <button
            onClick={onConfirm} disabled={busy}
            className={`rounded-lg py-3 font-black text-sm text-white transition disabled:opacity-50 ${
              isBuy ? "bg-[#0ECB81] hover:bg-[#0ab36e]" : "bg-[#F6465D] hover:bg-[#d93a4e]"
            }`}
          >
            {busy ? "Placing…" : isBuy ? "Confirm BUY" : "Confirm SELL"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ConfirmModal ───────────────────────────────────────────────────────────────

function ConfirmModal({ message, confirmLabel, onConfirm, onCancel, busy }: {
  message:      string;
  confirmLabel: string;
  onConfirm:    () => void;
  onCancel:     () => void;
  busy:         boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-[#131722] border border-white/[0.08] rounded-xl w-full max-w-sm p-5 space-y-4">
        <p className="text-white text-sm text-center leading-relaxed">{message}</p>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onCancel} disabled={busy}
            className="rounded-lg border border-white/[0.1] text-slate-500 py-2.5 text-sm font-black hover:bg-white/5 transition">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={busy}
            className="rounded-lg py-2.5 font-black text-sm text-white bg-[#F6465D] hover:bg-[#d93a4e] transition disabled:opacity-50">
            {busy ? "…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── PositionsPanel ─────────────────────────────────────────────────────────────

function PositionsPanel({ positions, prices, onAction, lifecycle }: {
  positions: PortfolioPosition[];
  prices:    CoinPrice[];
  onAction:  (a: ConfirmAction) => void;
  lifecycle: Record<string, LifecycleInfo>;
}) {
  if (!positions.length) {
    return (
      <div className="py-10 text-center text-slate-600">
        <Layers3 className="mx-auto mb-2 text-slate-800" size={28} />
        <p className="text-xs font-black text-slate-600">No Open Positions</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs min-w-[700px]">
        <thead>
          <tr className="border-b border-white/[0.06] text-[9px] uppercase tracking-wider text-slate-700">
            {["Symbol","Direction","Entry","Current","Size","P&L","TP","SL","Age","Actions"].map(h => (
              <th key={h} className={`px-3 py-2 ${h === "Actions" ? "text-right" : h === "Symbol" || h === "Direction" ? "text-left" : "text-right"}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.03]">
          {positions.map(pos => {
            const base      = pos.symbol.replace("USDT", "");
            const livePrice = prices.find(p => p.symbol === base)?.price ?? pos.lastPrice;
            const unrealPnl = (livePrice - pos.entryPrice) * pos.qty;
            const unrealPct = pos.entryPrice > 0 ? ((livePrice - pos.entryPrice) / pos.entryPrice) * 100 : 0;
            const dur       = elapsedStr(Date.now() - pos.openedAt);
            const lc = lifecycle[pos.symbol];

            return (
              <tr key={pos.id} className="hover:bg-white/[0.02] transition">
                <td className="px-3 py-2">
                  <div className="font-bold text-white">{pos.symbol}</div>
                  <div className="flex gap-1 mt-0.5">
                    {pos.dryRun && <span className="text-[8px] px-1 rounded bg-blue-500/20 text-blue-400 font-black">PAPER</span>}
                    {lc?.breakevenActive && <span className="text-[8px] px-1 rounded bg-cyan-500/20 text-cyan-400 font-black">BE</span>}
                    {lc?.trailingActive && <span className="text-[8px] px-1 rounded bg-violet-500/20 text-violet-400 font-black">TRAIL</span>}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#0ECB81]/15 text-[#0ECB81] font-black">LONG</span>
                </td>
                <td className="px-3 py-2 text-right font-mono text-slate-300">${fmt(pos.entryPrice)}</td>
                <td className="px-3 py-2 text-right font-mono text-white">${fmt(livePrice)}</td>
                <td className="px-3 py-2 text-right font-mono text-slate-300">${fmt(pos.sizeUsdt)}</td>
                <td className={`px-3 py-2 text-right font-black font-mono ${unrealPnl >= 0 ? "text-[#0ECB81]" : "text-[#F6465D]"}`}>
                  {unrealPnl >= 0 ? "+" : "-"}${fmt(Math.abs(unrealPnl))}
                  <div className="text-[9px] font-normal">{fmtPct(unrealPct)}</div>
                </td>
                <td className="px-3 py-2 text-right font-mono text-[11px] text-[#0ECB81]">{pos.tpPrice > 0 ? `$${fmt(pos.tpPrice)}` : "—"}</td>
                <td className="px-3 py-2 text-right font-mono text-[11px] text-[#F6465D]">{pos.slPrice > 0 ? `$${fmt(pos.slPrice)}` : "—"}</td>
                <td className="px-3 py-2 text-right text-slate-600"><Clock3 size={10} className="inline mr-0.5" />{dur}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => onAction({ label: `Take profit on ${pos.symbol}?`, action: async () => { const r = await fetch(`${SERVER_URL}/api/positions/${pos.symbol}/take-profit`, { method: "POST", headers: authHeaders() as HeadersInit }); const d = await r.json() as { ok?: boolean; error?: string }; if (!d.ok) throw new Error(d.error ?? "Failed"); } })}
                      className="px-2 py-1 rounded text-[10px] font-black bg-[#0ECB81]/10 border border-[#0ECB81]/20 text-[#0ECB81] hover:bg-[#0ECB81]/20 transition"
                    >TP</button>
                    <button
                      onClick={() => onAction({ label: `Close ${pos.symbol} at market?`, action: async () => { const r = await fetch(`${SERVER_URL}/api/positions/${pos.symbol}/close`, { method: "POST", headers: authHeaders() as HeadersInit }); const d = await r.json() as { ok?: boolean; error?: string }; if (!d.ok) throw new Error(d.error ?? "Failed"); } })}
                      className="px-2 py-1 rounded text-[10px] font-black bg-[#F6465D]/10 border border-[#F6465D]/20 text-[#F6465D] hover:bg-[#F6465D]/20 transition"
                    >Close</button>
                    <button
                      onClick={() => onAction({ label: `Move SL to breakeven for ${pos.symbol}?`, action: async () => { const r = await fetch(`${SERVER_URL}/api/positions/${pos.symbol}/breakeven`, { method: "POST", headers: authHeaders() as HeadersInit }); const d = await r.json() as { ok?: boolean; error?: string }; if (!r.ok || !d.ok) throw new Error(d.error ?? "Failed"); } })}
                      disabled={!!lc?.breakevenActive}
                      className="px-2 py-1 rounded text-[10px] font-black bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/20 transition disabled:opacity-30 disabled:cursor-not-allowed"
                    >BE</button>
                    <button
                      onClick={() => onAction({ label: lc?.trailingEnabled ? `Disable trailing for ${pos.symbol}?` : `Enable trailing for ${pos.symbol}?`, action: async () => { const r = await fetch(`${SERVER_URL}/api/positions/${pos.symbol}/trailing`, { method: "POST", headers: authHeaders() as HeadersInit, body: JSON.stringify({ enable: !(lc?.trailingEnabled ?? false) }) }); const d = await r.json() as { ok?: boolean; error?: string }; if (!r.ok || !d.ok) throw new Error(d.error ?? "Failed"); } })}
                      className={`px-2 py-1 rounded text-[10px] font-black border transition ${lc?.trailingEnabled ? "bg-violet-500/20 border-violet-500/40 text-violet-300" : "bg-violet-500/10 border-violet-500/20 text-violet-400 hover:bg-violet-500/20"}`}
                    >{lc?.trailingEnabled ? "TSL ON" : "TSL"}</button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── OpenOrdersPanel ────────────────────────────────────────────────────────────

function OpenOrdersPanel({ orders, loading, onCancel }: {
  orders: OpenOrder[]; loading: boolean; prices: CoinPrice[]; onCancel: (orderId: string) => void;
}) {
  if (loading) return <div className="py-10 text-center text-slate-600 text-xs"><Activity className="animate-pulse inline mr-1 text-cyan-500" size={14} />Loading…</div>;
  if (!orders.length) return <div className="py-10 text-center text-slate-700 text-xs">No open orders</div>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs min-w-[760px]">
        <thead>
          <tr className="border-b border-white/[0.06] text-[9px] uppercase tracking-wider text-slate-700">
            {["Symbol","Side","Type","Limit Price","Qty","Filled","Status","Created",""].map(h => (
              <th key={h} className={`px-3 py-2 ${h === "Symbol" || h === "Side" || h === "Type" || h === "Status" || h === "" ? "text-left" : "text-right"}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.03]">
          {orders.map(o => (
            <tr key={o.orderId} className="hover:bg-white/[0.02] transition">
              <td className="px-3 py-2 font-bold text-white">{o.symbol}</td>
              <td className="px-3 py-2">
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-black ${o.side.toUpperCase() === "BUY" ? "bg-[#0ECB81]/15 text-[#0ECB81]" : "bg-[#F6465D]/10 text-[#F6465D]"}`}>{o.side.toUpperCase()}</span>
              </td>
              <td className="px-3 py-2 text-slate-500">{o.orderType}</td>
              <td className="px-3 py-2 text-right font-mono text-slate-300">{o.limitPrice ? `$${fmt(Number(o.limitPrice))}` : "—"}</td>
              <td className="px-3 py-2 text-right font-mono text-slate-300">{fmt(Number(o.quantity))}</td>
              <td className="px-3 py-2 text-right font-mono text-slate-600">{fmt(Number(o.filledQuantity))}</td>
              <td className="px-3 py-2">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-black uppercase">{o.status}</span>
                {o.isPaper && <span className="ml-1 text-[9px] px-1 rounded bg-blue-500/15 text-blue-400 font-black">PAPER</span>}
              </td>
              <td className="px-3 py-2 text-slate-600">{new Date(o.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
              <td className="px-3 py-2">
                <button onClick={() => onCancel(o.orderId)}
                  className="px-2 py-0.5 rounded text-[10px] font-black bg-[#F6465D]/10 border border-[#F6465D]/20 text-[#F6465D] hover:bg-[#F6465D]/20 transition">
                  Cancel
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── OrderHistoryPanel ──────────────────────────────────────────────────────────

function OrderHistoryPanel({ orders, loading }: { orders: OpenOrder[]; loading: boolean }) {
  if (loading) return <div className="py-10 text-center text-slate-600 text-xs"><Activity className="animate-pulse inline mr-1 text-cyan-500" size={14} />Loading…</div>;
  if (!orders.length) return <div className="py-10 text-center text-slate-700 text-xs">No order history</div>;

  const statusColor = (s: string) => {
    const u = s.toUpperCase();
    if (u === "FILLED")    return "bg-[#0ECB81]/15 text-[#0ECB81]";
    if (u === "CANCELLED") return "bg-slate-700/20 text-slate-500";
    return "bg-[#F6465D]/10 text-[#F6465D]";
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs min-w-[700px]">
        <thead>
          <tr className="border-b border-white/[0.06] text-[9px] uppercase tracking-wider text-slate-700">
            {["Symbol","Side","Type","Price","Qty","Filled","Status","Time","Mode"].map(h => (
              <th key={h} className={`px-3 py-2 ${h === "Symbol" || h === "Side" || h === "Type" || h === "Status" || h === "Mode" ? "text-left" : "text-right"}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.03]">
          {orders.map(o => (
            <tr key={o.orderId} className="hover:bg-white/[0.02] transition">
              <td className="px-3 py-2 font-bold text-white">{o.symbol}</td>
              <td className="px-3 py-2">
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-black ${o.side.toUpperCase() === "BUY" ? "bg-[#0ECB81]/15 text-[#0ECB81]" : "bg-[#F6465D]/10 text-[#F6465D]"}`}>{o.side.toUpperCase()}</span>
              </td>
              <td className="px-3 py-2 text-slate-500">{o.orderType}</td>
              <td className="px-3 py-2 text-right font-mono text-slate-300">{o.limitPrice ? `$${fmt(Number(o.limitPrice))}` : "Market"}</td>
              <td className="px-3 py-2 text-right font-mono text-slate-300">{fmt(Number(o.quantity))}</td>
              <td className="px-3 py-2 text-right font-mono text-slate-600">{fmt(Number(o.filledQuantity))}</td>
              <td className="px-3 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded font-black uppercase ${statusColor(o.status)}`}>{o.status}</span></td>
              <td className="px-3 py-2 text-slate-600">{new Date(o.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
              <td className="px-3 py-2">
                {o.isPaper
                  ? <span className="text-[9px] px-1 rounded bg-blue-500/15 text-blue-400 font-black">PAPER</span>
                  : <span className="text-[9px] px-1 rounded bg-[#F6465D]/15 text-[#F6465D] font-black">LIVE</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── TradeHistoryPanel ──────────────────────────────────────────────────────────

function TradeHistoryPanel({ history, loading }: { history: JournalEntry[]; loading: boolean }) {
  if (loading) return <div className="py-10 text-center text-slate-600 text-xs"><Activity className="animate-pulse inline mr-1 text-cyan-500" size={14} />Loading…</div>;
  if (!history.length) return <div className="py-10 text-center text-slate-700 text-xs">No trade history</div>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs min-w-[680px]">
        <thead>
          <tr className="border-b border-white/[0.06] text-[9px] uppercase tracking-wider text-slate-700">
            {["Symbol","Side","Entry","Exit","P&L","P&L%","Duration","Reason","Mode"].map(h => (
              <th key={h} className={`px-3 py-2 ${h === "Symbol" || h === "Side" || h === "Reason" || h === "Mode" ? "text-left" : "text-right"}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.03]">
          {history.map((h, i) => {
            const pnl    = h.pnlUsd ?? 0;
            const pnlPct = h.pnlPct ?? 0;
            const entry  = h.entryPrice ?? h.entry ?? 0;
            const exit   = h.exitPrice  ?? h.exit  ?? 0;
            const dur    = h.durationMs ? elapsedStr(h.durationMs) : h.holdMins ? `${Math.round(h.holdMins)}m` : "—";
            const reason = h.exitReason ?? h.reason ?? "—";
            return (
              <tr key={h.id ?? i} className="hover:bg-white/[0.02] transition">
                <td className="px-3 py-2 font-bold text-white">{h.symbol ?? "—"}</td>
                <td className="px-3 py-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-black ${
                    (h.side ?? "").toLowerCase().includes("buy") || (h.side ?? "").toLowerCase() === "long"
                      ? "bg-[#0ECB81]/15 text-[#0ECB81]" : "bg-[#F6465D]/10 text-[#F6465D]"
                  }`}>{(h.side ?? "—").toUpperCase()}</span>
                </td>
                <td className="px-3 py-2 text-right font-mono text-slate-400">{entry ? `$${fmt(entry)}` : "—"}</td>
                <td className="px-3 py-2 text-right font-mono text-slate-400">{exit ? `$${fmt(exit)}` : "—"}</td>
                <td className={`px-3 py-2 text-right font-black font-mono ${pnl >= 0 ? "text-[#0ECB81]" : "text-[#F6465D]"}`}>
                  {pnl >= 0 ? "+" : "-"}${fmt(Math.abs(pnl))}
                </td>
                <td className={`px-3 py-2 text-right font-black ${pnlPct >= 0 ? "text-[#0ECB81]" : "text-[#F6465D]"}`}>{fmtPct(pnlPct)}</td>
                <td className="px-3 py-2 text-right text-slate-600">{dur}</td>
                <td className="px-3 py-2 text-slate-600 max-w-[90px] truncate">{reason}</td>
                <td className="px-3 py-2">
                  {h.dryRun
                    ? <span className="text-[9px] px-1 rounded bg-blue-500/15 text-blue-400 font-black">PAPER</span>
                    : <span className="text-[9px] px-1 rounded bg-[#F6465D]/15 text-[#F6465D] font-black">LIVE</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function ManualTradingCenter({ prices, status, connection, onRefreshStatus }: Props) {

  // ── Market state ─────────────────────────────────────────────────────────────
  const [terminalMode, setTerminalMode] = useState<"spot" | "futures">("spot");
  const [pair,               setPair]             = useState<string>("BTC_USDT");
  const [marketRows,         setMarketRows]       = useState<MarketRow[]>([]);
  const drawingEngine = useDrawingEngine(pair);
  const [marketPanelCollapsed, setMarketPanelCollapsed] = useState(false);
  const [tf,                 setTf]               = useState<TF>("1h");
  const [candles,            setCandles]           = useState<Candle[]>([]);
  const [candleLoad,         setCandleLoad]        = useState(false);
  const [obData,             setObData]            = useState<{ asks: OBLevel[]; bids: OBLevel[] }>({ asks: [], bids: [] });
  const [obLoad,             setObLoad]            = useState(false);
  const [obErr,              setObErr]             = useState(false);
  const [obTab,              setObTab]             = useState<"book" | "trades">("book");

  // ── Indicator toggles ────────────────────────────────────────────────────────
  const [indicators, setIndicators] = useState<IndicatorToggles & { rsi: boolean; atr: boolean }>({
    volume: true, ema9: true, ema21: true, ema50: false, ema200: false, rsi: false, atr: false,
  });
  const toggleIndicator = (key: keyof typeof indicators) =>
    setIndicators(prev => ({ ...prev, [key]: !prev[key] }));

  // ── Order state ───────────────────────────────────────────────────────────────
  const [side,       setSide]       = useState<OrderSide>("BUY");
  const [orderType,  setOrderType]  = useState<OrderType>("MARKET");
  const [limitPrice, setLimitPrice] = useState(0);
  const [sizeUsdt,   setSizeUsdt]   = useState(100);
  const [tpPct,      setTpPct]      = useState(2.0);
  const [slPct,      setSlPct]      = useState(1.2);
  const [strategy,   setStrategy]   = useState("manual");
  const [showTpSl,   setShowTpSl]   = useState(true);
  const [showReview, setShowReview] = useState(false);
  const [busy,       setBusy]       = useState(false);
  const [flash,      setFlash]      = useState<{ ok: boolean; text: string } | null>(null);

  // ── Position action confirm ───────────────────────────────────────────────────
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [confirmBusy,   setConfirmBusy]   = useState(false);

  // ── Bottom tabs ───────────────────────────────────────────────────────────────
  const [tab,          setTab]          = useState<BottomTab>("positions");
  const [history,      setHistory]      = useState<JournalEntry[]>([]);
  const [histLoad,     setHistLoad]     = useState(false);
  const [openOrders,   setOpenOrders]   = useState<OpenOrder[]>([]);
  const [ordersLoad,   setOrdersLoad]   = useState(false);
  const [orderHistory, setOrderHistory] = useState<OpenOrder[]>([]);
  const [ohLoad,       setOhLoad]       = useState(false);

  // ── Lifecycle badges ──────────────────────────────────────────────────────────
  const [lifecycle, setLifecycle] = useState<Record<string, LifecycleInfo>>({});
  const fetchLifecycle = useCallback(async () => {
    try {
      const r = await fetch(`${SERVER_URL}/api/positions/live`, { headers: authHeaders() as HeadersInit });
      const d = await r.json() as { ok?: boolean; positions?: LifecycleInfo[] };
      if (d.ok && d.positions) {
        const map: Record<string, LifecycleInfo> = {};
        for (const p of d.positions) map[p.symbol] = p;
        setLifecycle(map);
      }
    } catch { /* silently ignore */ }
  }, []);
  useEffect(() => {
    void fetchLifecycle();
    const id = setInterval(fetchLifecycle, 5000);
    return () => clearInterval(id);
  }, [fetchLifecycle]);

  // ── Derived values ────────────────────────────────────────────────────────────
  const sym       = useMemo(() => MARKET_SYMBOLS.find(s => s.pair === pair) ?? MARKET_SYMBOLS[0]!, [pair]);
  const coinPrice = useMemo(() => prices.find(p => p.symbol === sym.base), [prices, sym]);
  const selectedMarket = useMemo(() => marketRows.find(row => row.pair === pair), [marketRows, pair]);
  const livePrice = selectedMarket?.last ?? coinPrice?.price ?? candles.at(-1)?.close ?? 0;
  const tpPrice   = livePrice > 0 ? livePrice * (1 + tpPct / 100) : 0;
  const slPrice   = livePrice > 0 ? livePrice * (1 - slPct / 100) : 0;
  const rr        = slPct > 0 ? tpPct / slPct : 0;
  const qty       = livePrice > 0 ? sizeUsdt / livePrice : 0;
  const estFees   = sizeUsdt * EST_FEE_PCT;
  const estProfit = sizeUsdt * (tpPct / 100);
  const estLoss   = sizeUsdt * (slPct / 100);

  const openPositions: PortfolioPosition[] = status.portfolio?.positions ?? [];
  const rsiPoints = useMemo(() => indicators.rsi ? computeRSI(candles, 14) : [], [candles, indicators.rsi]);
  const atrPoints = useMemo(() => indicators.atr ? computeATR(candles, 14) : [], [candles, indicators.atr]);
  const posForSymbol = openPositions.find(p => p.symbol === pair2symbol(pair)) ?? null;

  const isPaper  = status.testMode || status.mode === "PAPER" || !status.hasApiKey;
  const isHalted = status.risk?.isHalted ?? false;
  const balance  = status.balanceUSDT ?? 0;

  const bestAsk     = obData.asks[0] ? Number(obData.asks[0][0]) : 0;
  const bestBid     = obData.bids[0] ? Number(obData.bids[0][0]) : 0;
  const midPrice    = bestAsk && bestBid ? (bestAsk + bestBid) / 2 : livePrice;
  const obSpread    = bestAsk && bestBid ? bestAsk - bestBid : 0;
  const obSpreadPct = midPrice > 0 ? (obSpread / midPrice) * 100 : 0;

  const connDot = connection === "connected" ? "bg-[#0ECB81]"
    : connection === "connecting"             ? "bg-amber-400 animate-pulse"
    :                                           "bg-[#F6465D]";

  // Warnings
  const warnings: string[] = [];
  if (sizeUsdt < MIN_SIZE_USDT)                 warnings.push(`Min order: $${MIN_SIZE_USDT}`);
  if (balance > 0 && sizeUsdt > balance * 0.9)  warnings.push("Exceeds 90% of balance");
  if (rr < 1 && tpPct > 0 && slPct > 0)         warnings.push("R/R below 1:1");
  if (openPositions.length > 0 && side === "BUY") warnings.push("Position already open");
  if (isHalted)                                   warnings.push(`Halted: ${status.risk?.haltReason ?? "risk limit"}`);

  // ── Fetch candles ─────────────────────────────────────────────────────────────
  const fetchCandles = useCallback(async () => {
    setCandleLoad(true);
    try {
      const r = await fetch(`${SERVER_URL}/api/market/candles?symbol=${pair}&interval=${tf}&limit=200`);
      if (!r.ok) return;
      const d = await r.json() as { ok?: boolean; candles?: Candle[] };
      if (d.ok && d.candles?.length) {
        const valid = d.candles
          .filter(c => isFinite(c.time) && isFinite(c.open) && isFinite(c.high) && isFinite(c.low) && isFinite(c.close))
          .sort((a, b) => a.time - b.time);
        setCandles(valid);
      }
    } catch { /* network error */ }
    finally { setCandleLoad(false); }
  }, [pair, tf]);
  useEffect(() => { void fetchCandles(); }, [fetchCandles]);

  // ── Fetch order book ──────────────────────────────────────────────────────────
  const fetchOB = useCallback(async () => {
    setObLoad(true); setObErr(false);
    try {
      const r = await fetch(`${SERVER_URL}/api/market/orderbook?symbol=${pair}&limit=12`);
      const d = await r.json() as { ok?: boolean; asks?: OBLevel[]; bids?: OBLevel[] };
      if (d.ok) setObData({ asks: d.asks ?? [], bids: d.bids ?? [] });
      else setObErr(true);
    } catch { setObErr(true); }
    finally { setObLoad(false); }
  }, [pair]);
  useEffect(() => { void fetchOB(); const id = setInterval(fetchOB, 5000); return () => clearInterval(id); }, [fetchOB]);

  // ── Fetch history / orders (tab-triggered) ────────────────────────────────────
  const fetchHistory = useCallback(async () => {
    setHistLoad(true);
    try {
      const r = await fetch(`${SERVER_URL}/api/trade-journal?limit=50`, { headers: authHeaders() as HeadersInit });
      const d = await r.json() as { ok?: boolean; data?: JournalEntry[] };
      if (d.ok && d.data) setHistory(d.data);
    } catch { /* ignore */ }
    finally { setHistLoad(false); }
  }, []);
  useEffect(() => { if (tab === "history") void fetchHistory(); }, [tab, fetchHistory]);

  const fetchOpenOrders = useCallback(async () => {
    setOrdersLoad(true);
    try {
      const r = await fetch(`${SERVER_URL}/api/orders`, { headers: authHeaders() as HeadersInit });
      const d = await r.json() as { ok?: boolean; orders?: OpenOrder[] };
      if (d.ok && d.orders) setOpenOrders(d.orders);
    } catch { /* ignore */ }
    finally { setOrdersLoad(false); }
  }, []);
  useEffect(() => {
    if (tab === "orders") { void fetchOpenOrders(); }
  }, [tab, fetchOpenOrders]);
  useEffect(() => {
    if (tab !== "orders") return;
    const id = setInterval(() => { void fetchOpenOrders(); }, 10_000);
    return () => clearInterval(id);
  }, [tab, fetchOpenOrders]);

  const fetchOrderHistory = useCallback(async () => {
    setOhLoad(true);
    try {
      const r = await fetch(`${SERVER_URL}/api/orders/history?limit=100`, { headers: authHeaders() as HeadersInit });
      const d = await r.json() as { ok?: boolean; orders?: OpenOrder[] };
      if (d.ok && d.orders) setOrderHistory(d.orders);
    } catch { /* ignore */ }
    finally { setOhLoad(false); }
  }, []);
  useEffect(() => { if (tab === "orderHistory") void fetchOrderHistory(); }, [tab, fetchOrderHistory]);

  // Refresh user-scoped execution state as soon as the existing server event
  // bus reports a mutation. Polling below remains the recovery path for a
  // missed event or a temporarily disconnected stream.
  useSSE((event) => {
    if (
      event.type === "position:open" ||
      event.type === "position:close" ||
      event.type === "position:update" ||
      event.type === "order:created" ||
      event.type === "order:update"
    ) {
      void fetchLifecycle();
      void fetchOpenOrders();
      void fetchOrderHistory();
      void fetchHistory();
      void onRefreshStatus?.();
    }
  });

  // ── Flash helper ──────────────────────────────────────────────────────────────
  const showFlash = (ok: boolean, text: string, ms = 8000) => {
    setFlash({ ok, text });
    setTimeout(() => setFlash(null), ms);
  };

  // ── Place order ───────────────────────────────────────────────────────────────
  const placeOrder = async () => {
    setBusy(true);
    setShowReview(false);
    try {
      const effectiveLimitPrice = orderType === "LIMIT" ? (limitPrice > 0 ? limitPrice : livePrice) : undefined;
      const body: Record<string, unknown> = { symbol: pair2symbol(pair), side, sizeUsdt, tpPct, slPct, strategy, orderType };
      if (orderType === "LIMIT" && effectiveLimitPrice) body["limitPrice"] = effectiveLimitPrice;

      const r = await fetch(`${SERVER_URL}/api/manual-trading/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      const d = await r.json() as { ok?: boolean; error?: string; orderId?: string };
      if (!r.ok || !d.ok) throw new Error(d.error ?? "Order rejected by server");

      if (orderType === "LIMIT") {
        showFlash(true, `Limit order placed — ${sym.display} $${sizeUsdt} @ $${fmt(effectiveLimitPrice ?? 0)}`);
        setTab("orders"); void fetchOpenOrders();
      } else {
        showFlash(true, side === "BUY"
          ? `BUY queued — ${sym.display} $${sizeUsdt}. Processing through pipeline.`
          : `Close queued — ${sym.display}. Closing at market.`);
      }
      void onRefreshStatus?.();
    } catch (e) {
      showFlash(false, e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // ── Run position action ───────────────────────────────────────────────────────
  const runConfirm = async () => {
    if (!confirmAction) return;
    setConfirmBusy(true);
    try {
      await confirmAction.action();
      showFlash(true, "Action queued through execution pipeline.");
      setConfirmAction(null);
      void fetchLifecycle();
      void onRefreshStatus?.();
    } catch (e) {
      showFlash(false, e instanceof Error ? e.message : String(e));
      setConfirmAction(null);
    } finally {
      setConfirmBusy(false);
    }
  };

  const reviewParams: ReviewParams = {
    symbol: sym.display, side, price: livePrice, sizeUsdt, qty,
    tpPct, slPct, tpPrice, slPrice, rr, estProfit, estLoss, estFees,
    strategy, isPaper,
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col bg-[#0B0E11] border border-white/[0.06] rounded-xl overflow-hidden"
      style={{ height: "calc(100vh - 120px)", minHeight: "720px" }}
    >
      {/* ── Modals ───────────────────────────────────────────────────────────── */}
      {showReview && (
        <ReviewModal params={reviewParams} onConfirm={placeOrder} onCancel={() => setShowReview(false)} busy={busy} />
      )}
      {confirmAction && (
        <ConfirmModal message={confirmAction.label} confirmLabel="Confirm"
          onConfirm={runConfirm} onCancel={() => setConfirmAction(null)} busy={confirmBusy} />
      )}

      {/* ── Spot / Perp Futures top tabs (BingX reference) ──────────────────── */}
      <div className="flex items-center gap-5 px-4 pt-2.5 pb-0 border-b border-white/[0.06] bg-[#0d1117] flex-shrink-0">
        <button
          onClick={() => setTerminalMode("futures")}
          className={`pb-2.5 -mb-px text-[13px] font-black border-b-2 transition ${
            terminalMode === "futures" ? "text-white border-[#F0B90B]" : "text-slate-600 border-transparent hover:text-slate-400"
          }`}
        >
          Perp Futures
        </button>
        <button
          onClick={() => setTerminalMode("spot")}
          className={`pb-2.5 -mb-px text-[13px] font-black border-b-2 transition ${
            terminalMode === "spot" ? "text-white border-[#F0B90B]" : "text-slate-600 border-transparent hover:text-slate-400"
          }`}
        >
          Spot
        </button>
      </div>

      {/* ── Terminal header bar ───────────────────────────────────────────── */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-white/[0.06] bg-[#0d1117] flex-shrink-0 flex-wrap">
        {/* Symbol + price */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-base font-black text-white">{sym.display}</span>
            <ChevronDown size={13} className="text-slate-600" />
          </div>
          <span className="text-xl font-black text-white tabular-nums">
            {livePrice ? `$${livePrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—"}
          </span>
          {selectedMarket && (
            <span className={`text-xs font-black ${selectedMarket.changePct >= 0 ? "text-[#0ECB81]" : "text-[#F6465D]"}`}>
              {fmtPct(selectedMarket.changePct)}
            </span>
          )}
        </div>

        {/* Stats strip */}
        <div className="flex items-center gap-4 text-[11px] flex-1 min-w-0">
          {[
            { label: "Bid",    val: bestBid ? `$${fmt(bestBid)}`   : "—", cls: "text-[#0ECB81]" },
            { label: "Ask",    val: bestAsk ? `$${fmt(bestAsk)}`   : "—", cls: "text-[#F6465D]" },
            { label: "Spread", val: obSpread ? `${obSpreadPct.toFixed(3)}%` : "—", cls: "text-slate-400" },
            { label: "24h High", val: selectedMarket?.high24h ? `$${fmt(selectedMarket.high24h)}` : "—", cls: "text-slate-300" },
            { label: "24h Low",  val: selectedMarket?.low24h ? `$${fmt(selectedMarket.low24h)}`  : "—", cls: "text-slate-300" },
          ].map(({ label, val, cls }) => (
            <div key={label} className="flex flex-col">
              <span className="text-[9px] text-slate-700 uppercase tracking-wider">{label}</span>
              <span className={`font-mono font-bold ${cls}`}>{val}</span>
            </div>
          ))}
        </div>

        {/* Right badges */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-[10px] px-2 py-0.5 rounded font-black border ${
            isPaper
              ? "bg-blue-500/10 border-blue-500/30 text-blue-400"
              : "bg-[#F6465D]/10 border-[#F6465D]/30 text-[#F6465D] animate-pulse"
          }`}>
            {isPaper ? "PAPER" : "LIVE"}
          </span>
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${connDot}`} />
            <span className="text-[10px] text-slate-600 uppercase">
              {connection === "connected" ? "Live" : connection === "connecting" ? "Connecting" : "Offline"}
            </span>
          </div>
        </div>
      </div>

      {/* ── Main body (3 columns) ─────────────────────────────────────────── */}
      {terminalMode === "spot" ? (
      <>
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* LEFT — Market list */}
        <div className={`hidden xl:flex flex-col flex-shrink-0 border-r border-white/[0.06] overflow-hidden transition-all duration-200 ${
          marketPanelCollapsed ? "w-10" : "w-[200px]"
        }`}>
          <MarketListPanel
            currentPair={pair}
            onSelect={setPair}
            onRowsChange={setMarketRows}
            collapsed={marketPanelCollapsed}
            onToggleCollapsed={() => setMarketPanelCollapsed(v => !v)}
          />
        </div>

        {/* CENTER — Chart + OB/Trades */}
        <div className="flex-1 flex flex-col min-h-0 border-r border-white/[0.06] overflow-hidden">

          {/* Chart toolbar: timeframes + indicators */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06] flex-shrink-0 flex-wrap bg-[#0d1117]">
            {/* Timeframes */}
            <div className="flex items-center gap-0.5">
              {TIMEFRAMES.map(t => (
                <button key={t} onClick={() => setTf(t)}
                  className={`px-2 py-1 rounded text-[11px] font-black transition ${
                    tf === t
                      ? "bg-white/10 text-white"
                      : "text-slate-600 hover:text-slate-300"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="w-px h-4 bg-white/[0.08] mx-1" />

            {/* Indicator toggles */}
            <div className="flex items-center gap-1 flex-wrap">
              {([
                ["volume", "Vol",    "#94a3b8"],
                ["ema9",   "EMA9",   EMA_COLORS.ema9],
                ["ema21",  "EMA21",  EMA_COLORS.ema21],
                ["ema50",  "EMA50",  EMA_COLORS.ema50],
                ["ema200", "EMA200", EMA_COLORS.ema200],
                ["rsi",    "RSI",    "#38bdf8"],
                ["atr",    "ATR",    "#fb923c"],
              ] as const).map(([key, label, dot]) => (
                <button
                  key={key}
                  onClick={() => toggleIndicator(key)}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-black transition ${
                    indicators[key]
                      ? "bg-white/[0.08] text-white"
                      : "text-slate-700 hover:text-slate-400"
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: indicators[key] ? dot : "#1e293b" }} />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Chart */}
          <div className="flex-1 min-h-0 bg-[#080d15] flex">
            <FloatingToolbar engine={drawingEngine} />
            <div className="flex-1 min-w-0">
              <CandleChart
                candles={candles}
                position={posForSymbol}
                loading={candleLoad}
                indicators={indicators}
                height={400}
                engine={drawingEngine}
              />
            </div>
          </div>

          {/* RSI / ATR sub-panels */}
          {indicators.rsi && (
            <IndicatorMiniChart
              points={rsiPoints} color="#38bdf8" label="RSI (14)"
              bands={[{ value: 70, color: "#F6465D" }, { value: 30, color: "#0ECB81" }]}
            />
          )}
          {indicators.atr && (
            <IndicatorMiniChart points={atrPoints} color="#fb923c" label="ATR (14)" />
          )}

          {/* Order book / Recent trades */}
          <div className="h-[240px] flex-shrink-0 border-t border-white/[0.06] flex flex-col">
            {/* Tab bar */}
            <div className="flex items-center border-b border-white/[0.06] bg-[#0d1117] flex-shrink-0">
              {[
                { key: "book" as const, label: "Order Book", icon: <BookOpen size={11} /> },
                { key: "trades" as const, label: "Recent Trades", icon: <History size={11} /> },
              ].map(({ key, label, icon }) => (
                <button
                  key={key}
                  onClick={() => setObTab(key)}
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-[11px] font-black uppercase tracking-wider border-b-2 transition ${
                    obTab === key
                      ? "border-[#0ea5e9] text-[#0ea5e9]"
                      : "border-transparent text-slate-600 hover:text-slate-400"
                  }`}
                >
                  {icon}{label}
                </button>
              ))}
              <div className="flex-1" />
              {obTab === "book" && obLoad && <RefreshCw size={10} className="animate-spin text-slate-700 mr-3" />}
              {obTab === "book" && obErr   && <span className="text-[10px] text-[#F6465D] mr-3">depth unavailable</span>}
            </div>

            {/* Content */}
            <div className="flex-1 min-h-0 overflow-hidden">
              {obTab === "book" ? (
                obData.asks.length > 0 || obData.bids.length > 0
                  ? <OrderBook asks={obData.asks} bids={obData.bids} midPrice={midPrice} />
                  : <div className="py-6 text-center text-slate-700 text-xs">{obLoad ? "Loading…" : "No depth data"}</div>
              ) : (
                <RecentTrades pair={pair} />
              )}
            </div>
          </div>
        </div>

        {/* RIGHT — BingX-style order entry panel */}
        <div className="w-[300px] flex-shrink-0 flex flex-col overflow-y-auto bg-[#0d1117]">

          {/* Available balance row */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
            <span className="text-[10px] text-slate-600 flex items-center gap-1">
              <ShieldCheck size={10} className="text-[#0ECB81]" /> Available
            </span>
            <span className="text-sm font-black text-white">${fmt(balance)}</span>
          </div>

          {/* Buy / Sell tabs */}
          <div className="grid grid-cols-2 gap-0 border-b border-white/[0.06]">
            <button onClick={() => setSide("BUY")}
              className={`py-3 font-black text-sm transition ${
                side === "BUY"
                  ? "bg-[#0ECB81] text-black"
                  : "text-slate-600 hover:text-[#0ECB81] bg-transparent"
              }`}
            >
              Buy
            </button>
            <button onClick={() => setSide("SELL")}
              className={`py-3 font-black text-sm transition ${
                side === "SELL"
                  ? "bg-[#F6465D] text-white"
                  : "text-slate-600 hover:text-[#F6465D] bg-transparent"
              }`}
            >
              Sell
            </button>
          </div>

          {side === "SELL" && (
            <div className="px-4 py-2 text-[10px] text-slate-600 border-b border-white/[0.06]">
              Long-only: SELL closes an existing {sym.display} position at market.
            </div>
          )}

          <div className="flex flex-col gap-3 px-4 py-3">

            {/* Order type tabs */}
            <div className="flex gap-0 bg-white/[0.04] rounded-lg p-0.5">
              <button
                onClick={() => setOrderType("MARKET")}
                className={`flex-1 py-1.5 rounded-md text-xs font-black transition ${
                  orderType === "MARKET" ? "bg-white/10 text-white" : "text-slate-600 hover:text-slate-400"
                }`}
              >
                Market
              </button>
              <button
                onClick={() => { if (side === "BUY") setOrderType("LIMIT"); }}
                disabled={side === "SELL"}
                className={`flex-1 py-1.5 rounded-md text-xs font-black transition ${
                  orderType === "LIMIT"
                    ? "bg-white/10 text-white"
                    : side === "SELL"
                    ? "text-slate-800 cursor-not-allowed"
                    : "text-slate-600 hover:text-slate-400"
                }`}
              >
                Limit
              </button>
              <button disabled className="flex-1 py-1.5 rounded-md text-xs font-black text-slate-800 cursor-not-allowed">Stop</button>
            </div>

            {/* Limit price */}
            {orderType === "LIMIT" && side === "BUY" && (
              <div>
                <label className="block text-[10px] text-slate-600 mb-1 uppercase tracking-wider">Limit Price (USDT)</label>
                <input
                  type="number"
                  min={0.000001}
                  step={livePrice > 1000 ? 1 : 0.01}
                  value={limitPrice > 0 ? limitPrice : ""}
                  placeholder={livePrice > 0 ? `${fmt(livePrice)}` : "Enter price"}
                  onChange={e => setLimitPrice(Number(e.target.value) || 0)}
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white font-mono placeholder:text-slate-700 focus:outline-none focus:border-[#0ea5e9]/40"
                />
                {livePrice > 0 && (
                  <button
                    onClick={() => setLimitPrice(Math.round(livePrice * 0.99 * 100) / 100)}
                    className="mt-1 text-[10px] text-cyan-700 hover:text-cyan-500 transition"
                  >
                    -1% from market
                  </button>
                )}
              </div>
            )}

            {/* Position size */}
            <div>
              <label className="block text-[10px] text-slate-600 mb-1 uppercase tracking-wider">Amount (USDT)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 text-sm font-mono">$</span>
                <input
                  type="number"
                  min={MIN_SIZE_USDT}
                  step={10}
                  value={sizeUsdt}
                  onChange={e => setSizeUsdt(Math.max(MIN_SIZE_USDT, Number(e.target.value) || MIN_SIZE_USDT))}
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg pl-7 pr-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-[#0ea5e9]/40"
                />
              </div>
              <div className="text-[10px] text-slate-700 mt-0.5 font-mono">
                {qty > 0 ? `≈ ${qty.toFixed(6)} ${sym.base}` : "—"}
              </div>
            </div>

            {/* Slider */}
            {balance > 0 && (
              <div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={balance > 0 ? Math.min(100, Math.round((sizeUsdt / balance) * 100)) : 0}
                  onChange={e => setSizeUsdt(Math.max(MIN_SIZE_USDT, Math.round(balance * Number(e.target.value) / 100)))}
                  className="w-full h-1 rounded-full appearance-none cursor-pointer"
                  style={{ accentColor: side === "BUY" ? "#0ECB81" : "#F6465D" }}
                />
                <div className="flex justify-between text-[9px] text-slate-700 mt-0.5">
                  <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
                </div>
              </div>
            )}

            {/* Quick % buttons */}
            <div className="grid grid-cols-4 gap-1">
              {[25, 50, 75, 100].map(pct => {
                const target = balance > 0 ? Math.max(MIN_SIZE_USDT, Math.round(balance * pct / 100)) : 0;
                const isActive = balance > 0 && Math.abs(sizeUsdt - target) < 1;
                return (
                  <button
                    key={pct}
                    onClick={() => balance > 0 && setSizeUsdt(target)}
                    disabled={balance === 0}
                    className={`py-1 rounded text-[11px] font-black border transition ${
                      isActive
                        ? side === "BUY"
                          ? "bg-[#0ECB81]/20 border-[#0ECB81]/40 text-[#0ECB81]"
                          : "bg-[#F6465D]/20 border-[#F6465D]/40 text-[#F6465D]"
                        : "border-white/[0.08] text-slate-600 hover:text-slate-400 hover:border-white/[0.15]"
                    }`}
                  >
                    {pct}%
                  </button>
                );
              })}
            </div>

            {/* TP/SL toggle */}
            <div>
              <button
                onClick={() => setShowTpSl(v => !v)}
                className="flex items-center gap-2 text-[11px] font-black text-slate-500 hover:text-slate-300 transition"
              >
                <span className={`w-3.5 h-3.5 rounded-sm border-2 flex items-center justify-center transition ${
                  showTpSl ? "bg-[#0ea5e9] border-[#0ea5e9]" : "border-slate-700"
                }`}>
                  {showTpSl && <span className="block w-1.5 h-1 bg-white rounded-sm" />}
                </span>
                TP/SL
              </button>

              {showTpSl && (
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <div>
                    <label className="block text-[9px] text-[#0ECB81] mb-1 uppercase tracking-wider">Take Profit %</label>
                    <input
                      type="number" min={0.1} step={0.1} value={tpPct}
                      onChange={e => setTpPct(Math.max(0.1, Number(e.target.value) || 0.1))}
                      className="w-full bg-white/[0.04] border border-[#0ECB81]/20 rounded-lg px-2 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-[#0ECB81]/40"
                    />
                    <div className="text-[10px] text-[#0ECB81]/60 mt-0.5 font-mono">{tpPrice > 0 ? `$${fmt(tpPrice)}` : "—"}</div>
                  </div>
                  <div>
                    <label className="block text-[9px] text-[#F6465D] mb-1 uppercase tracking-wider">Stop Loss %</label>
                    <input
                      type="number" min={0.1} step={0.1} value={slPct}
                      onChange={e => setSlPct(Math.max(0.1, Number(e.target.value) || 0.1))}
                      className="w-full bg-white/[0.04] border border-[#F6465D]/20 rounded-lg px-2 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-[#F6465D]/40"
                    />
                    <div className="text-[10px] text-[#F6465D]/60 mt-0.5 font-mono">{slPrice > 0 ? `$${fmt(slPrice)}` : "—"}</div>
                  </div>
                </div>
              )}
            </div>

            {/* Strategy tag */}
            <div>
              <label className="block text-[10px] text-slate-600 mb-1 uppercase tracking-wider">Strategy</label>
              <select
                value={strategy}
                onChange={e => setStrategy(e.target.value)}
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-[#0ea5e9]/40"
              >
                <option value="manual">Manual Trade</option>
                <option value="active-swing">Active Swing</option>
                <option value="conservative-scalping">Conservative Scalping</option>
                <option value="swing">Swing</option>
                <option value="day-trading">Day Trading</option>
              </select>
            </div>

            {/* Risk preview */}
            <div className="bg-white/[0.02] border border-white/[0.05] rounded-lg p-3 space-y-1.5">
              <div className="text-[9px] uppercase tracking-wider text-slate-700 mb-2">Risk Preview</div>
              {[
                ["Entry",      `$${fmt(livePrice)}`,                                         "text-white"],
                ["TP",         tpPrice > 0 ? `$${fmt(tpPrice)} (+${tpPct.toFixed(2)}%)` : "—", "text-[#0ECB81]"],
                ["SL",         slPrice > 0 ? `$${fmt(slPrice)} (-${slPct.toFixed(2)}%)` : "—", "text-[#F6465D]"],
                ["R/R",        `1 : ${rr.toFixed(2)}`,                                      "text-cyan-400"],
                ["Est. profit",`+$${fmt(estProfit)}`,                                        "text-[#0ECB81]"],
                ["Est. loss",  `-$${fmt(estLoss)}`,                                         "text-[#F6465D]"],
                ["Fees",       `≈$${fmt(estFees)}`,                                         "text-slate-500"],
              ].map(([k, v, cls]) => (
                <div key={String(k)} className="flex justify-between text-[11px]">
                  <span className="text-slate-600">{k}</span>
                  <span className={String(cls) + " font-mono"}>{String(v)}</span>
                </div>
              ))}
            </div>

            {/* Warnings */}
            {warnings.map((w, i) => (
              <div key={i} className="flex items-center gap-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px] px-3 py-2">
                <AlertTriangle size={11} className="shrink-0" />{w}
              </div>
            ))}

            {/* Flash message */}
            {flash && (
              <div className={`flex items-start gap-1.5 rounded-lg text-[11px] px-3 py-2 ${
                flash.ok
                  ? "bg-[#0ECB81]/10 border border-[#0ECB81]/20 text-[#0ECB81]"
                  : "bg-[#F6465D]/10 border border-[#F6465D]/20 text-[#F6465D]"
              }`}>
                {flash.ok ? <CheckCircle2 size={12} className="shrink-0 mt-0.5" /> : <AlertTriangle size={12} className="shrink-0 mt-0.5" />}
                <span>{flash.text}</span>
              </div>
            )}

            {/* Submit button */}
            <button
              onClick={() => setShowReview(true)}
              disabled={busy || sizeUsdt < MIN_SIZE_USDT || livePrice === 0 || isHalted}
              className={`w-full py-4 rounded-xl font-black text-sm transition disabled:opacity-40 disabled:cursor-not-allowed ${
                side === "BUY"
                  ? "bg-[#0ECB81] hover:bg-[#0ab36e] text-black"
                  : "bg-[#F6465D] hover:bg-[#d93a4e] text-white"
              }`}
            >
              {busy
                ? "Processing…"
                : side === "BUY"
                ? `Open Long — ${sym.display}`
                : `Close / Sell — ${sym.display}`
              }
            </button>

            {/* Pipeline note */}
            <div className="text-[9px] text-slate-700 text-center leading-relaxed">
              <Layers3 className="inline mr-1 text-slate-700" size={9} />
              Auth → Risk → Queue → Worker → {isPaper ? "Paper" : "Gate.io"} → Portfolio → Journal
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom — Positions/Orders tabs ───────────────────────────────── */}
      <div className="h-[240px] flex-shrink-0 border-t border-white/[0.06] flex flex-col">
        {/* Tab bar */}
        <div className="flex items-center border-b border-white/[0.06] bg-[#0d1117] flex-shrink-0">
          {[
            { key: "positions"    as BottomTab, label: "Positions",     count: openPositions.length, icon: <TrendingUp size={11} /> },
            { key: "orders"       as BottomTab, label: "Open Orders",   count: openOrders.length,    icon: <Clock3 size={11} /> },
            { key: "orderHistory" as BottomTab, label: "Order History", count: null,                 icon: <History size={11} /> },
            { key: "history"      as BottomTab, label: "Trade History", count: null,                 icon: <BookOpen size={11} /> },
          ].map(({ key, label, count, icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-[11px] font-black uppercase tracking-wider border-b-2 transition ${
                tab === key
                  ? "border-[#0ea5e9] text-[#0ea5e9]"
                  : "border-transparent text-slate-600 hover:text-slate-400"
              }`}
            >
              {icon}
              {label}
              {count !== null && count > 0 && (
                <span className="ml-0.5 px-1 rounded bg-white/10 text-[9px] font-black">{count}</span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {tab === "positions" && (
            <PositionsPanel
              positions={openPositions}
              prices={prices}
              onAction={setConfirmAction}
              lifecycle={lifecycle}
            />
          )}
          {tab === "orders" && (
            <OpenOrdersPanel
              orders={openOrders}
              loading={ordersLoad}
              prices={prices}
              onCancel={async (orderId) => {
                try {
                  const r = await fetch(`${SERVER_URL}/api/orders/${orderId}`, {
                    method: "DELETE",
                    headers: authHeaders() as HeadersInit,
                  });
                  const d = await r.json() as { ok?: boolean; error?: string };
                  if (!d.ok) throw new Error(d.error ?? "Cancel failed");
                  showFlash(true, "Order cancelled.");
                  void fetchOpenOrders();
                } catch (e) {
                  showFlash(false, e instanceof Error ? e.message : "Cancel failed");
                }
              }}
            />
          )}
          {tab === "orderHistory" && (
            <OrderHistoryPanel orders={orderHistory} loading={ohLoad} />
          )}
          {tab === "history" && (
            <TradeHistoryPanel history={history} loading={histLoad} />
          )}
        </div>
      </div>
      </>
      ) : (
        <FuturesTerminal
          symbol={pair}
          prices={prices}
          isPaper={isPaper}
          onRefreshStatus={onRefreshStatus}
        />
      )}
    </div>
  );
}

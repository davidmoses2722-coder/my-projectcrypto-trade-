/**
 * TradingChart — dominant center panel. Self-contained: computes its own
 * EMA/RSI series from the Candle[] it's given so this folder has no
 * dependency on ManualTradingCenter.tsx's internals.
 */
import { useEffect, useRef, useState } from "react";
import type { IChartApi, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import { createChart, ColorType, CrosshairMode } from "lightweight-charts";
import type { Candle } from "./types";
import type { IndicatorState } from "./IndicatorSelector";
import { DrawingCanvas } from "./drawings/DrawingCanvas";
import type { DrawingEngine } from "./drawings/useDrawingEngine";

function computeEMA(candles: Candle[], period: number) {
  const k = 2 / (period + 1);
  const out: { time: number; value: number }[] = [];
  let prev: number | null = null;
  for (const c of candles) {
    prev = prev === null ? c.close : c.close * k + prev * (1 - k);
    out.push({ time: c.time, value: prev });
  }
  return out;
}

function computeRSI(candles: Candle[], period = 14) {
  const out: { time: number; value: number }[] = [];
  let gain = 0, loss = 0;
  for (let i = 1; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    gain = (gain * (period - 1) + Math.max(diff, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-diff, 0)) / period;
    const rs = loss === 0 ? 100 : gain / loss;
    out.push({ time: candles[i].time, value: 100 - 100 / (1 + rs) });
  }
  return out;
}

const EMA_COLORS: Record<string, string> = { ema9: "#38bdf8", ema21: "#a78bfa", ema50: "#f472b6", ema200: "#facc15" };

export function TradingChart({ candles, indicators, height = 420, engine }: { candles: Candle[]; indicators: IndicatorState; height?: number; engine?: DrawingEngine }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const emaRefs = useRef<Record<string, ISeriesApi<"Line">>>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
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
    seriesRef.current = candleSeries;
    volRef.current = volSeries;
    setReady(true);
    return () => { chart.remove(); chartRef.current = null; setReady(false); };
  }, []);

  useEffect(() => {
    if (!seriesRef.current || !volRef.current) return;
    seriesRef.current.setData(candles.map(c => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })));
    if (indicators.volume) {
      volRef.current.setData(candles.map(c => ({
        time: c.time as UTCTimestamp, value: c.volume,
        color: c.close >= c.open ? "rgba(14,203,129,0.35)" : "rgba(246,70,93,0.35)",
      })));
    } else {
      volRef.current.setData([]);
    }
  }, [candles, indicators.volume]);

  useEffect(() => {
    if (!chartRef.current) return;
    (["ema9", "ema21", "ema50", "ema200"] as const).forEach(key => {
      const period = Number(key.replace("ema", ""));
      const wantOn = indicators[key];
      const existing = emaRefs.current[key];
      if (wantOn && !existing) {
        const line = chartRef.current!.addLineSeries({ color: EMA_COLORS[key], lineWidth: 1, priceLineVisible: false });
        line.setData(computeEMA(candles, period).map(p => ({ time: p.time as UTCTimestamp, value: p.value })));
        emaRefs.current[key] = line;
      } else if (!wantOn && existing) {
        chartRef.current!.removeSeries(existing);
        delete emaRefs.current[key];
      } else if (wantOn && existing) {
        existing.setData(computeEMA(candles, period).map(p => ({ time: p.time as UTCTimestamp, value: p.value })));
      }
    });
  }, [candles, indicators]);

  const rsiData = indicators.rsi ? computeRSI(candles) : [];
  const barSeconds = candles.length > 1 ? candles[1].time - candles[0].time : 0;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div ref={containerRef} style={{ height, position: "relative" }} className="w-full">
        {ready && engine && chartRef.current && seriesRef.current && (
          <DrawingCanvas chart={chartRef.current} series={seriesRef.current} candles={candles} engine={engine} barSeconds={barSeconds} />
        )}
      </div>
      {indicators.rsi && rsiData.length > 0 && (
        <div className="h-[80px] border-t border-white/[0.06] px-3 py-1.5 flex-shrink-0">
          <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-0.5">RSI (14)</div>
          <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="w-full h-[56px]">
            <polyline
              fill="none" stroke="#38bdf8" strokeWidth="0.6"
              points={rsiData.map((p, i) => `${(i / (rsiData.length - 1)) * 100},${40 - (p.value / 100) * 40}`).join(" ")}
            />
            <line x1="0" x2="100" y1={40 - 0.7 * 40} y2={40 - 0.7 * 40} stroke="#F6465D" strokeWidth="0.3" strokeDasharray="2,2" />
            <line x1="0" x2="100" y1={40 - 0.3 * 40} y2={40 - 0.3 * 40} stroke="#0ECB81" strokeWidth="0.3" strokeDasharray="2,2" />
          </svg>
        </div>
      )}
    </div>
  );
}

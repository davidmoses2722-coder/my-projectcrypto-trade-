import type { Candle } from "../types";
import { FIB_LEVELS, type ChartPoint } from "./types";

export function fibLevelPrices(p1: ChartPoint, p2: ChartPoint, extension = false): { level: number; price: number }[] {
  const levels = extension ? FIB_LEVELS.filter(l => l > 1 || l === 0) : FIB_LEVELS.filter(l => l <= 1);
  const diff = p2.price - p1.price;
  return levels.map(level => ({ level, price: p1.price + diff * level }));
}

/** Andrews' Pitchfork: median line from p1 through the midpoint of p2-p3, with two parallel arms through p2 and p3. */
export function pitchforkLines(p1: ChartPoint, p2: ChartPoint, p3: ChartPoint) {
  const mid: ChartPoint = { time: (p2.time + p3.time) / 2, price: (p2.price + p3.price) / 2 };
  // Extend the median line well past mid so it reaches the right edge of the visible range.
  const dt = mid.time - p1.time;
  const dp = mid.price - p1.price;
  const extended: ChartPoint = { time: mid.time + dt * 3, price: mid.price + dp * 3 };
  const armOffsetP2: ChartPoint = { time: p2.time + dt * 3, price: p2.price + dp * 3 };
  const armOffsetP3: ChartPoint = { time: p3.time + dt * 3, price: p3.price + dp * 3 };
  return {
    median: [p1, extended] as const,
    armA: [p2, armOffsetP2] as const,
    armB: [p3, armOffsetP3] as const,
  };
}

/** Snap a chart-space point to the nearest candle's O/H/L/C at the nearest bar. */
export function magnetSnap(point: ChartPoint, candles: Candle[]): ChartPoint {
  if (candles.length === 0) return point;
  let nearest = candles[0];
  let bestDt = Infinity;
  for (const c of candles) {
    const dt = Math.abs(c.time - point.time);
    if (dt < bestDt) { bestDt = dt; nearest = c; }
  }
  const candidates = [nearest.open, nearest.high, nearest.low, nearest.close];
  let bestPrice = candidates[0];
  let bestDp = Infinity;
  for (const p of candidates) {
    const dp = Math.abs(p - point.price);
    if (dp < bestDp) { bestDp = dp; bestPrice = p; }
  }
  return { time: nearest.time, price: bestPrice };
}

export function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx, projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

export function fmtMeasure(p1: ChartPoint, p2: ChartPoint, barSeconds: number) {
  const dPrice = p2.price - p1.price;
  const dPct = p1.price !== 0 ? (dPrice / p1.price) * 100 : 0;
  const bars = barSeconds > 0 ? Math.round(Math.abs(p2.time - p1.time) / barSeconds) : 0;
  return { dPrice, dPct, bars };
}

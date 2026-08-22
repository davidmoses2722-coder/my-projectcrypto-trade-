/**
 * drawings/DrawingCanvas.tsx
 * Transparent canvas positioned over the lightweight-charts container.
 * Converts every DrawingObject's (time, price) points to pixels via the
 * chart/series's own coordinate functions on every render, so drawings
 * track pan/zoom correctly. Owns all pointer interaction: drafting new
 * objects, dragging existing ones (cursor tool), and click-sequencing for
 * 3-point tools (Fib extension, Pitchfork).
 */
import { useEffect, useRef, useState, useCallback } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { Candle } from "../types";
import type { ChartPoint, DrawingObject, DrawingTool } from "./types";
import { TOOL_POINT_COUNT } from "./types";
import { distanceToSegment, fibLevelPrices, pitchforkLines, magnetSnap, fmtMeasure } from "./geometry";
import type { DrawingEngine } from "./useDrawingEngine";

const HIT_PX = 7;
const COLOR = "#38bdf8";
const SELECTED_COLOR = "#F0B90B";

interface Props {
  chart: IChartApi;
  series: ISeriesApi<"Candlestick">;
  candles: Candle[];
  engine: DrawingEngine;
  barSeconds: number;
}

function makeId() { return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`; }

export function DrawingCanvas({ chart, series, candles, engine, barSeconds }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const draftRef = useRef<DrawingObject | null>(null);
  const pendingPointsRef = useRef<ChartPoint[]>([]);
  const draggingRef = useRef<{ id: string; lastPoint: ChartPoint } | null>(null);
  const [redrawTick, bump] = useState(0);
  const forceRedraw = useCallback(() => bump(v => v + 1), []);

  const toX = useCallback((time: number): number | null => {
    return chart.timeScale().timeToCoordinate(time as never);
  }, [chart]);

  const toY = useCallback((price: number): number | null => {
    return series.priceToCoordinate(price);
  }, [series]);

  const toPixel = useCallback((p: ChartPoint): { x: number; y: number } | null => {
    const x = toX(p.time);
    const y = toY(p.price);
    if (x === null || y === null) return null;
    return { x, y };
  }, [toX, toY]);

  const fromPixel = useCallback((x: number, y: number): ChartPoint | null => {
    const time = chart.timeScale().coordinateToTime(x);
    const price = series.coordinateToPrice(y);
    if (time === null || price === null) return null;
    return { time: Number(time), price };
  }, [chart, series]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el?.parentElement) return;
    const updateSize = () => {
      const rect = el.parentElement!.getBoundingClientRect();
      setSize({ w: Math.max(0, Math.round(rect.width)), h: Math.max(0, Math.round(rect.height)) });
    };
    const ro = new ResizeObserver(() => {
      updateSize();
    });
    ro.observe(el.parentElement);
    updateSize();
    chart.timeScale().subscribeVisibleLogicalRangeChange(forceRedraw);
    return () => {
      ro.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(forceRedraw);
    };
  }, [chart, forceRedraw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = size.w; canvas.height = size.h;
    ctx.clearRect(0, 0, size.w, size.h);
    if (engine.allHidden) return;

    const all = [...engine.objects, ...(draftRef.current ? [draftRef.current] : [])];
    for (const obj of all) {
      if (obj.hidden) continue;
      const isSelected = obj.id === engine.selectedId;
      drawObject(ctx, obj, toPixel, toX, toY, size, isSelected, barSeconds);
    }
  }, [engine.objects, engine.selectedId, engine.allHidden, size, toPixel, toX, toY, barSeconds, redrawTick]);

  const commitDraft = useCallback(() => {
    if (draftRef.current) {
      engine.addObject(draftRef.current);
      draftRef.current = null;
    }
    pendingPointsRef.current = [];
    engine.setActiveTool("cursor");
    forceRedraw();
  }, [engine, forceRedraw]);

  const applyMagnet = useCallback((p: ChartPoint) => (engine.magnet ? magnetSnap(p, candles) : p), [engine.magnet, candles]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const chartPoint = fromPixel(x, y);
    if (!chartPoint) return;
    const p = applyMagnet(chartPoint);

    if (engine.activeTool === "cursor") {
      if (engine.locked) return;
      const hit = hitTestAll(engine.objects, x, y, toPixel, toX, toY);
      engine.setSelectedId(hit?.id ?? null);
      if (hit) draggingRef.current = { id: hit.id, lastPoint: p };
      return;
    }

    const tool = engine.activeTool as Exclude<DrawingTool, "cursor">;
    const count = TOOL_POINT_COUNT[tool];
    const base = { id: makeId(), color: COLOR, lineWidth: 1.4, hidden: false, createdAt: Date.now() };

    if (tool === "hline") { engine.addObject({ ...base, tool, price: p.price }); engine.setActiveTool("cursor"); return; }
    if (tool === "vline") { engine.addObject({ ...base, tool, time: p.time }); engine.setActiveTool("cursor"); return; }
    if (tool === "text") {
      const text = window.prompt("Annotation text:", "");
      if (text) engine.addObject({ ...base, tool, p1: p, text });
      engine.setActiveTool("cursor");
      return;
    }

    if (tool === "brush") {
      draftRef.current = { ...base, tool, points: [p] } as DrawingObject;
      forceRedraw();
      return;
    }

    if (count === 3) {
      pendingPointsRef.current = [...pendingPointsRef.current, p];
      if (pendingPointsRef.current.length < 3) { forceRedraw(); return; }
      const [p1, p2, p3] = pendingPointsRef.current;
      engine.addObject({ ...base, tool, p1, p2, p3 } as DrawingObject);
      pendingPointsRef.current = [];
      engine.setActiveTool("cursor");
      return;
    }

    draftRef.current = { ...base, tool, p1: p, p2: p } as DrawingObject;
    forceRedraw();
  }, [engine, fromPixel, toPixel, toX, toY, applyMagnet, forceRedraw]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const chartPoint = fromPixel(x, y);
    if (!chartPoint) return;
    const p = applyMagnet(chartPoint);

    if (draggingRef.current) {
      const { id, lastPoint } = draggingRef.current;
      const dt = p.time - lastPoint.time;
      const dp = p.price - lastPoint.price;
      const obj = engine.objects.find(o => o.id === id);
      if (obj) engine.updateObject(id, translateObject(obj, dt, dp));
      draggingRef.current = { id, lastPoint: p };
      return;
    }

    if (draftRef.current) {
      const d = draftRef.current;
      if (d.tool === "brush") {
        (d as DrawingObject & { points: ChartPoint[] }).points.push(p);
      } else if ("p2" in d) {
        (d as DrawingObject & { p2: ChartPoint }).p2 = p;
      }
      forceRedraw();
    }
  }, [engine, fromPixel, applyMagnet, forceRedraw]);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (draggingRef.current) draggingRef.current = null;
    if (draftRef.current) commitDraft();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }, [commitDraft]);

  const onPointerCancel = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    draggingRef.current = null;
    draftRef.current = null;
    pendingPointsRef.current = [];
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    forceRedraw();
  }, [forceRedraw]);

  const cursorStyle = engine.activeTool === "cursor" ? "default" : "crosshair";

  return (
    <canvas
      ref={canvasRef}
      width={size.w}
      height={size.h}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 10,
        display: "block",
        cursor: cursorStyle,
        touchAction: "none",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    />
  );
}

function translateObject(obj: DrawingObject, dt: number, dp: number): Partial<DrawingObject> {
  switch (obj.tool) {
    case "hline": return { price: obj.price + dp };
    case "vline": return { time: obj.time + dt };
    case "text": return { p1: { time: obj.p1.time + dt, price: obj.p1.price + dp } };
    case "brush": return { points: obj.points.map(pt => ({ time: pt.time + dt, price: pt.price + dp })) };
    case "fibExtension":
    case "pitchfork":
      return {
        p1: { time: obj.p1.time + dt, price: obj.p1.price + dp },
        p2: { time: obj.p2.time + dt, price: obj.p2.price + dp },
        p3: { time: obj.p3.time + dt, price: obj.p3.price + dp },
      };
    default:
      if ("p1" in obj && "p2" in obj) {
        return {
          p1: { time: obj.p1.time + dt, price: obj.p1.price + dp },
          p2: { time: obj.p2.time + dt, price: obj.p2.price + dp },
        };
      }
      return {};
  }
}

function hitTestAll(
  objects: DrawingObject[],
  x: number,
  y: number,
  toPixel: (p: ChartPoint) => { x: number; y: number } | null,
  toX: (time: number) => number | null,
  toY: (price: number) => number | null,
): DrawingObject | null {
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (obj.hidden) continue;
    if (objectHit(obj, x, y, toPixel, toX, toY)) return obj;
  }
  return null;
}

function objectHit(
  obj: DrawingObject,
  x: number,
  y: number,
  toPixel: (p: ChartPoint) => { x: number; y: number } | null,
  toX: (time: number) => number | null,
  toY: (price: number) => number | null,
): boolean {
  const px = (p: ChartPoint) => toPixel(p);
  switch (obj.tool) {
    case "hline": {
      const y0 = toY(obj.price);
      return y0 != null && Math.abs(y - y0) <= HIT_PX;
    }
    case "vline": {
      const x0 = toX(obj.time);
      return x0 != null && Math.abs(x - x0) <= HIT_PX;
    }
    case "text": {
      const pt = px(obj.p1);
      return !!pt && Math.hypot(x - pt.x, y - pt.y) <= 14;
    }
    case "brush": {
      for (let i = 1; i < obj.points.length; i++) {
        const a = px(obj.points[i - 1]), b = px(obj.points[i]);
        if (a && b && distanceToSegment(x, y, a.x, a.y, b.x, b.y) <= HIT_PX) return true;
      }
      return false;
    }
    case "rect":
    case "circle": {
      const a = px(obj.p1), b = px(obj.p2);
      if (!a || !b) return false;
      const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
      const minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
      const nearBorder = x >= minX - HIT_PX && x <= maxX + HIT_PX && y >= minY - HIT_PX && y <= maxY + HIT_PX
        && (Math.abs(x - minX) <= HIT_PX || Math.abs(x - maxX) <= HIT_PX || Math.abs(y - minY) <= HIT_PX || Math.abs(y - maxY) <= HIT_PX);
      return nearBorder;
    }
    default: {
      if ("p1" in obj && "p2" in obj) {
        const a = px(obj.p1), b = px(obj.p2);
        return !!a && !!b && distanceToSegment(x, y, a.x, a.y, b.x, b.y) <= HIT_PX;
      }
      return false;
    }
  }
}

function drawObject(
  ctx: CanvasRenderingContext2D, obj: DrawingObject,
  toPixel: (p: ChartPoint) => { x: number; y: number } | null,
  toX: (time: number) => number | null,
  toY: (price: number) => number | null,
  size: { w: number; h: number }, selected: boolean, barSeconds: number,
) {
  const color = selected ? SELECTED_COLOR : obj.color;
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = obj.lineWidth;
  ctx.font = "11px Inter, sans-serif";

  switch (obj.tool) {
    case "trendline": case "arrow": {
      const a = toPixel(obj.p1), b = toPixel(obj.p2);
      if (!a || !b) return;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      if (obj.tool === "arrow") drawArrowHead(ctx, a, b, color);
      break;
    }
    case "ray": {
      const a = toPixel(obj.p1), b = toPixel(obj.p2);
      if (!a || !b) return;
      const dx = b.x - a.x, dy = b.y - a.y;
      const scale = dx !== 0 ? (size.w - a.x) / dx : 1;
      const ext = { x: a.x + dx * Math.max(scale, 1) * 2, y: a.y + dy * Math.max(scale, 1) * 2 };
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(ext.x, ext.y); ctx.stroke();
      break;
    }
    case "hline": {
      const y = toY(obj.price);
      if (y === null) return;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size.w, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillText(obj.price.toFixed(2), size.w - 60, y - 4);
      break;
    }
    case "vline": {
      const x = toX(obj.time);
      if (x === null) return;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size.h); ctx.stroke();
      ctx.setLineDash([]);
      break;
    }
    case "rect": {
      const a = toPixel(obj.p1), b = toPixel(obj.p2);
      if (!a || !b) return;
      ctx.globalAlpha = 0.12;
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.globalAlpha = 1;
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      break;
    }
    case "circle": {
      const a = toPixel(obj.p1), b = toPixel(obj.p2);
      if (!a || !b) return;
      const rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.globalAlpha = 0.1; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke();
      break;
    }
    case "fibRetracement": {
      const levels = fibLevelPrices(obj.p1, obj.p2, false);
      renderFibLevels(ctx, obj.p1, obj.p2, levels, toX, toY, size);
      break;
    }
    case "fibExtension": {
      const levels = fibLevelPrices(obj.p2, obj.p3, true);
      renderFibLevels(ctx, obj.p1, obj.p3, levels, toX, toY, size);
      break;
    }
    case "pitchfork": {
      const { median, armA, armB } = pitchforkLines(obj.p1, obj.p2, obj.p3);
      for (const [p1, p2] of [median, armA, armB]) {
        const a = toPixel(p1), b = toPixel(p2);
        if (!a || !b) continue;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      break;
    }
    case "brush": {
      if (obj.points.length < 2) return;
      ctx.beginPath();
      obj.points.forEach((p, i) => {
        const pt = toPixel(p);
        if (!pt) return;
        if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
      });
      ctx.stroke();
      break;
    }
    case "text": {
      const pt = toPixel(obj.p1);
      if (!pt) return;
      ctx.fillText(obj.text, pt.x + 4, pt.y - 4);
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 2, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case "measure": {
      const a = toPixel(obj.p1), b = toPixel(obj.p2);
      if (!a || !b) return;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
      const { dPrice, dPct, bars } = fmtMeasure(obj.p1, obj.p2, barSeconds);
      const label = `${dPrice >= 0 ? "+" : ""}${dPrice.toFixed(2)} (${dPct >= 0 ? "+" : ""}${dPct.toFixed(2)}%), ${bars} bars`;
      ctx.fillText(label, (a.x + b.x) / 2, (a.y + b.y) / 2 - 6);
      break;
    }
  }
}

function renderFibLevels(
  ctx: CanvasRenderingContext2D, tFrom: ChartPoint, tTo: ChartPoint,
  levels: { level: number; price: number }[],
  toX: (time: number) => number | null,
  toY: (price: number) => number | null,
  size: { w: number; h: number },
) {
  const left = toX(Math.min(tFrom.time, tTo.time)) ?? 0;
  const right = toX(Math.max(tFrom.time, tTo.time)) ?? size.w;
  for (const { level, price } of levels) {
    const y = toY(price);
    if (y === null) continue;
    ctx.globalAlpha = 0.6;
    ctx.beginPath(); ctx.moveTo(Math.min(left, right), y); ctx.lineTo(Math.max(left, right), y); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillText(`${(level * 100).toFixed(1)}% (${price.toFixed(2)})`, Math.max(left, right) + 4, y + 3);
  }
}

function drawArrowHead(ctx: CanvasRenderingContext2D, a: { x: number; y: number }, b: { x: number; y: number }, color: string) {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const len = 8;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - len * Math.cos(angle - Math.PI / 6), b.y - len * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(b.x - len * Math.cos(angle + Math.PI / 6), b.y - len * Math.sin(angle + Math.PI / 6));
  ctx.closePath(); ctx.fill();
}

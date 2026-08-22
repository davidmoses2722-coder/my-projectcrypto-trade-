/**
 * drawings/types.ts
 * ─────────────────────────────────────────────────────────────────────────
 * Data model for the chart drawing-tools engine. lightweight-charts (the
 * library TradingChart.tsx already uses) has no native drawing API, so this
 * is a from-scratch canvas overlay: chart-space points (time, price) are
 * converted to pixel space every render via the chart's own coordinate
 * functions, so drawings stay correctly anchored through pan/zoom.
 */

export type DrawingTool =
  | "cursor"
  | "trendline" | "ray" | "hline" | "vline"
  | "rect" | "circle"
  | "fibRetracement" | "fibExtension" | "pitchfork"
  | "brush" | "arrow" | "text" | "measure";

export interface ChartPoint {
  time: number;   // unix seconds
  price: number;
}

interface BaseObject {
  id: string;
  color: string;
  lineWidth: number;
  hidden: boolean;
  createdAt: number;
}

export interface TrendLineObj  extends BaseObject { tool: "trendline"; p1: ChartPoint; p2: ChartPoint }
export interface RayObj        extends BaseObject { tool: "ray";        p1: ChartPoint; p2: ChartPoint }
export interface HLineObj      extends BaseObject { tool: "hline";      price: number }
export interface VLineObj      extends BaseObject { tool: "vline";      time: number }
export interface RectObj       extends BaseObject { tool: "rect";       p1: ChartPoint; p2: ChartPoint }
export interface CircleObj     extends BaseObject { tool: "circle";     p1: ChartPoint; p2: ChartPoint }
export interface FibRetObj     extends BaseObject { tool: "fibRetracement"; p1: ChartPoint; p2: ChartPoint }
export interface FibExtObj     extends BaseObject { tool: "fibExtension";   p1: ChartPoint; p2: ChartPoint; p3: ChartPoint }
export interface PitchforkObj  extends BaseObject { tool: "pitchfork";  p1: ChartPoint; p2: ChartPoint; p3: ChartPoint }
export interface BrushObj      extends BaseObject { tool: "brush";      points: ChartPoint[] }
export interface ArrowObj      extends BaseObject { tool: "arrow";      p1: ChartPoint; p2: ChartPoint }
export interface TextObj       extends BaseObject { tool: "text";       p1: ChartPoint; text: string }
export interface MeasureObj    extends BaseObject { tool: "measure";    p1: ChartPoint; p2: ChartPoint }

export type DrawingObject =
  | TrendLineObj | RayObj | HLineObj | VLineObj | RectObj | CircleObj
  | FibRetObj | FibExtObj | PitchforkObj | BrushObj | ArrowObj | TextObj | MeasureObj;

/** How many chart-points each tool needs before it commits (multi-click tools). */
export const TOOL_POINT_COUNT: Record<Exclude<DrawingTool, "cursor">, number> = {
  trendline: 2, ray: 2, hline: 1, vline: 1, rect: 2, circle: 2,
  fibRetracement: 2, fibExtension: 3, pitchfork: 3,
  brush: -1, // continuous drag, not fixed-count
  arrow: 2, text: 1, measure: 2,
};

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618];

export interface DrawingEngineState {
  objects: DrawingObject[];
  activeTool: DrawingTool;
  selectedId: string | null;
  magnet: boolean;
  locked: boolean;
  allHidden: boolean;
}

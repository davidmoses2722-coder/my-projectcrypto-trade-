/**
 * ChartToolbar — top strip above the chart. Crosshair/Compare/Screenshot/
 * Fullscreen/Replay are UI-only toggle/callback placeholders in this phase
 * (no drawing/replay engine wired) — each is a real button with a real
 * onClick, just not yet connected to chart-library behavior.
 */
import { Crosshair, GitCompareArrows, Camera, Maximize2, RotateCcw } from "lucide-react";
import { TimeframeSelector } from "./TimeframeSelector";
import { IndicatorSelector, type IndicatorState } from "./IndicatorSelector";
import type { Timeframe } from "./types";

interface Props {
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
  indicators: IndicatorState;
  onToggleIndicator: (key: keyof IndicatorState) => void;
  onFullscreen?: () => void;
  onScreenshot?: () => void;
}

export function ChartToolbar({ timeframe, onTimeframeChange, indicators, onToggleIndicator, onFullscreen, onScreenshot }: Props) {
  return (
    <div className="relative flex items-center gap-2 px-3 py-2 border-b border-white/[0.06] flex-shrink-0 flex-wrap bg-[#0d1117]">
      <TimeframeSelector value={timeframe} onChange={onTimeframeChange} />
      <div className="w-px h-4 bg-white/[0.08] mx-1" />
      <IndicatorSelector value={indicators} onToggle={onToggleIndicator} />
      <div className="flex-1" />
      <div className="flex items-center gap-1">
        <button title="Crosshair" className="w-7 h-7 flex items-center justify-center rounded text-slate-600 hover:text-slate-300 hover:bg-white/[0.05] transition">
          <Crosshair size={13} />
        </button>
        <button title="Compare" className="w-7 h-7 flex items-center justify-center rounded text-slate-600 hover:text-slate-300 hover:bg-white/[0.05] transition">
          <GitCompareArrows size={13} />
        </button>
        <button title="Bar replay (coming soon)" disabled className="w-7 h-7 flex items-center justify-center rounded text-slate-800 cursor-not-allowed">
          <RotateCcw size={13} />
        </button>
        <button title="Screenshot" onClick={onScreenshot} className="w-7 h-7 flex items-center justify-center rounded text-slate-600 hover:text-slate-300 hover:bg-white/[0.05] transition">
          <Camera size={13} />
        </button>
        <button title="Fullscreen" onClick={onFullscreen} className="w-7 h-7 flex items-center justify-center rounded text-slate-600 hover:text-slate-300 hover:bg-white/[0.05] transition">
          <Maximize2 size={13} />
        </button>
      </div>
    </div>
  );
}

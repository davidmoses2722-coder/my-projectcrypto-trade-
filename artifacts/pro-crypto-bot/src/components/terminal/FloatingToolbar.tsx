/**
 * FloatingToolbar — real drawing-tools rail, driving drawings/useDrawingEngine.
 * Supersedes the earlier placeholder version of this file (that one only set
 * local visual state; this one calls the actual engine passed down from the
 * composition root, so every button here does what it says).
 */
import {
  MousePointer2, TrendingUp, ArrowUpRight, ArrowRight, Minus, Square, Circle,
  Percent, GitFork, PenTool, Type, Ruler, Magnet, Lock, EyeOff, Trash2,
  Undo2, Redo2, Save, FolderOpen, ChevronLeft,
} from "lucide-react";
import { useState } from "react";
import type { DrawingTool } from "./drawings/types";
import type { DrawingEngine } from "./drawings/useDrawingEngine";

const TOOLS: { key: DrawingTool; icon: typeof MousePointer2; label: string; rotate?: boolean }[] = [
  { key: "cursor", icon: MousePointer2, label: "Cursor" },
  { key: "trendline", icon: TrendingUp, label: "Trend line" },
  { key: "ray", icon: ArrowUpRight, label: "Ray" },
  { key: "hline", icon: Minus, label: "Horizontal line" },
  { key: "vline", icon: Minus, label: "Vertical line", rotate: true },
  { key: "rect", icon: Square, label: "Rectangle" },
  { key: "circle", icon: Circle, label: "Circle" },
  { key: "fibRetracement", icon: Percent, label: "Fibonacci Retracement" },
  { key: "fibExtension", icon: Percent, label: "Fibonacci Extension" },
  { key: "pitchfork", icon: GitFork, label: "Pitchfork" },
  { key: "brush", icon: PenTool, label: "Brush" },
  { key: "arrow", icon: ArrowRight, label: "Arrow" },
  { key: "text", icon: Type, label: "Text" },
  { key: "measure", icon: Ruler, label: "Measure" },
];

export function FloatingToolbar({ engine }: { engine: DrawingEngine }) {
  const [open, setOpen] = useState(false);

  const handleClear = () => {
    if (engine.objects.length === 0) return;
    if (window.confirm(`Remove all ${engine.objects.length} drawing(s) on this chart?`)) engine.clearAll();
  };

  const handleSave = () => {
    const ok = engine.save();
    if (!ok) window.alert("Could not save drawings (browser storage unavailable).");
  };

  const handleLoad = () => {
    if (engine.objects.length > 0 && !window.confirm("Load saved drawings? This replaces the current unsaved state.")) return;
    const ok = engine.load();
    if (!ok) window.alert("No saved drawings found for this symbol.");
  };

  const controls = (
    <>
      <button
        type="button"
        title="Close drawing tools"
        aria-label="Close drawing tools"
        aria-expanded={true}
        onClick={() => setOpen(false)}
        className="mb-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded text-[#38bdf8] transition hover:bg-white/[0.06]"
      >
        <ChevronLeft size={14} />
      </button>

      {TOOLS.map(({ key, icon: Icon, label, rotate }) => (
        <button
          type="button"
          key={key}
          title={label}
          aria-label={label}
          aria-pressed={engine.activeTool === key}
          onClick={() => engine.setActiveTool(key)}
          className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded transition ${
            engine.activeTool === key ? "bg-[#0ea5e9]/15 text-[#0ea5e9]" : "text-slate-600 hover:bg-white/[0.05] hover:text-slate-300"
          }`}
        >
          <Icon size={14} className={rotate ? "rotate-90" : undefined} />
        </button>
      ))}

      <div className="my-1 h-px w-5 flex-shrink-0 bg-white/[0.08]" />

      <button type="button" title="Magnet — snap to candle O/H/L/C" aria-label="Toggle magnet snap" aria-pressed={engine.magnet} onClick={engine.toggleMagnet}
        className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded transition ${engine.magnet ? "text-[#0ea5e9]" : "text-slate-600 hover:text-slate-300"}`}>
        <Magnet size={13} />
      </button>
      <button type="button" title="Lock drawings" aria-label="Lock drawings" aria-pressed={engine.locked} onClick={engine.toggleLocked}
        className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded transition ${engine.locked ? "text-[#0ea5e9]" : "text-slate-600 hover:text-slate-300"}`}>
        <Lock size={13} />
      </button>
      <button type="button" title="Hide all drawings" aria-label="Hide all drawings" aria-pressed={engine.allHidden} onClick={engine.toggleAllHidden}
        className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded transition ${engine.allHidden ? "text-[#0ea5e9]" : "text-slate-600 hover:text-slate-300"}`}>
        <EyeOff size={13} />
      </button>

      <div className="my-1 h-px w-5 flex-shrink-0 bg-white/[0.08]" />

      <button type="button" title="Undo" aria-label="Undo" onClick={engine.undo} disabled={!engine.canUndo}
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded text-slate-600 transition hover:text-slate-300 disabled:opacity-30 disabled:hover:text-slate-600">
        <Undo2 size={13} />
      </button>
      <button type="button" title="Redo" aria-label="Redo" onClick={engine.redo} disabled={!engine.canRedo}
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded text-slate-600 transition hover:text-slate-300 disabled:opacity-30 disabled:hover:text-slate-600">
        <Redo2 size={13} />
      </button>

      <div className="my-1 h-px w-5 flex-shrink-0 bg-white/[0.08]" />

      <button type="button" title="Save drawings (this browser)" aria-label="Save drawings" onClick={handleSave}
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded text-slate-600 transition hover:text-slate-300">
        <Save size={13} />
      </button>
      <button type="button" title="Load saved drawings" aria-label="Load saved drawings" onClick={handleLoad}
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded text-slate-600 transition hover:text-slate-300">
        <FolderOpen size={13} />
      </button>

      <div className="my-1 h-px w-5 flex-shrink-0 bg-white/[0.08]" />

      <button type="button" title={engine.selectedId ? "Delete selected" : "Select a drawing to delete it"} aria-label="Delete selected drawing" onClick={engine.deleteSelected} disabled={!engine.selectedId}
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded text-slate-600 transition hover:text-[#F6465D] disabled:opacity-30 disabled:hover:text-slate-600">
        <Trash2 size={13} />
      </button>
      <button type="button" title="Remove all drawings" aria-label="Remove all drawings" onClick={handleClear}
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded text-[8px] font-black text-slate-700 transition hover:text-[#F6465D]">
        ALL
      </button>
    </>
  );

  if (!open) {
    return (
      <div className="pointer-events-none absolute bottom-[12px] right-[60px] z-[60] flex items-center justify-center">
        <button
          type="button"
          title="Open drawing tools"
          aria-label="Open drawing tools"
          aria-expanded={false}
          onClick={() => setOpen(true)}
          className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-md border border-white/[0.1] bg-[#0d1117]/95 text-slate-500 shadow-[0_8px_20px_rgba(0,0,0,0.35)] transition hover:border-[#0ea5e9]/50 hover:bg-[#0ea5e9]/10 hover:text-[#38bdf8]"
        >
          <PenTool size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="relative z-30 flex h-full w-9 flex-shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r border-white/[0.06] bg-[#0d1117] px-1 py-2">
      {controls}
    </div>
  );
}

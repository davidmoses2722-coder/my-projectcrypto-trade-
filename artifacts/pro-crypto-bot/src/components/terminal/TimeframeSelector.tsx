import type { Timeframe } from "./types";

const TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

export function TimeframeSelector({ value, onChange }: { value: Timeframe; onChange: (tf: Timeframe) => void }) {
  return (
    <div className="flex items-center gap-0.5">
      {TIMEFRAMES.map(tf => (
        <button
          key={tf}
          onClick={() => onChange(tf)}
          className={`px-2 py-1 rounded text-[11px] font-black transition ${
            value === tf ? "bg-white/10 text-white" : "text-slate-600 hover:text-slate-300"
          }`}
        >
          {tf}
        </button>
      ))}
    </div>
  );
}

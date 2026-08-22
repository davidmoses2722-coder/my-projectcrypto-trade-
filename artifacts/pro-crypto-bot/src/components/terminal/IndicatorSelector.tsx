export interface IndicatorState {
  volume: boolean;
  ema9: boolean;
  ema21: boolean;
  ema50: boolean;
  ema200: boolean;
  rsi: boolean;
  atr: boolean;
}

export const DEFAULT_INDICATORS: IndicatorState = {
  volume: true, ema9: true, ema21: true, ema50: false, ema200: false, rsi: false, atr: false,
};

const INDICATOR_META: Record<keyof IndicatorState, { label: string; dot: string }> = {
  volume: { label: "Vol", dot: "#94a3b8" },
  ema9: { label: "EMA9", dot: "#38bdf8" },
  ema21: { label: "EMA21", dot: "#a78bfa" },
  ema50: { label: "EMA50", dot: "#f472b6" },
  ema200: { label: "EMA200", dot: "#facc15" },
  rsi: { label: "RSI", dot: "#38bdf8" },
  atr: { label: "ATR", dot: "#fb923c" },
};

export function IndicatorSelector({ value, onToggle }: { value: IndicatorState; onToggle: (key: keyof IndicatorState) => void }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {(Object.keys(INDICATOR_META) as (keyof IndicatorState)[]).map(key => {
        const { label, dot } = INDICATOR_META[key];
        const active = value[key];
        return (
          <button
            key={key}
            onClick={() => onToggle(key)}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-black transition ${
              active ? "bg-white/[0.08] text-white" : "text-slate-700 hover:text-slate-400"
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: active ? dot : "#1e293b" }} />
            {label}
          </button>
        );
      })}
    </div>
  );
}

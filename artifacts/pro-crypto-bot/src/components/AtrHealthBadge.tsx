/**
 * AtrHealthBadge — Phase 12.1
 *
 * Inline badge that shows ATR validation health.
 * Polls /api/atr/health every 15 s while mounted.
 *
 * Sizes: "sm" (default — fits in header pill row), "xs" (compact inline)
 */

import { useEffect, useState } from "react";

type AtrHealth = "valid" | "warning" | "invalid";

interface AtrSnapshot {
  health:    AtrHealth;
  atr:       number;
  atrPct:    number;   // decimal, e.g. 0.03 = 3%
  price:     number;
  timeframe: string;
  ts:        string;
}

interface HealthPayload {
  ok:        boolean;
  health:    AtrHealth;
  snapshots: Record<string, AtrSnapshot>;
  recentLogs: unknown[];
  ts:        string;
}

interface Props {
  /** Base URL prefix for the API (default: "/api-server") */
  apiBase?: string;
  size?: "xs" | "sm";
  /** Only show when health is warning or invalid */
  warnOnly?: boolean;
}

const POLL_MS = 15_000;

const COLORS: Record<AtrHealth, string> = {
  valid:   "bg-emerald-500/15 border-emerald-500/40 text-emerald-400",
  warning: "bg-yellow-500/15 border-yellow-500/40 text-yellow-400",
  invalid: "bg-red-500/15  border-red-500/40  text-red-400",
};

const DOTS: Record<AtrHealth, string> = {
  valid:   "bg-emerald-400",
  warning: "bg-yellow-400 animate-pulse",
  invalid: "bg-red-400 animate-pulse",
};

const LABELS: Record<AtrHealth, string> = {
  valid:   "ATR OK",
  warning: "ATR HIGH",
  invalid: "ATR ERR",
};

export default function AtrHealthBadge({ apiBase = "/api-server", size = "sm", warnOnly = false }: Props) {
  const [health,  setHealth]  = useState<AtrHealth | null>(null);
  const [tooltip, setTooltip] = useState<string>("");

  useEffect(() => {
    let alive = true;

    async function poll() {
      try {
        const res  = await fetch(`${apiBase}/api/atr/health`);
        if (!res.ok) return;
        const data = (await res.json()) as HealthPayload;
        if (!alive) return;

        setHealth(data.health);

        // Build tooltip from snapshots
        const snaps = Object.entries(data.snapshots);
        if (snaps.length === 0) {
          setTooltip("No ATR data yet");
        } else {
          const lines = snaps.slice(0, 6).map(([sym, s]) =>
            `${sym}: ${(s.atrPct * 100).toFixed(2)}% [${s.health.toUpperCase()}]`
          );
          setTooltip(lines.join("\n"));
        }
      } catch {
        // Network error — don't crash the badge
      }
    }

    poll();
    const tid = setInterval(poll, POLL_MS);
    return () => { alive = false; clearInterval(tid); };
  }, [apiBase]);

  if (health === null) return null;
  if (warnOnly && health === "valid") return null;

  const px = size === "xs" ? "px-1.5 py-0" : "px-2 py-0.5";
  const text = size === "xs" ? "text-[10px]" : "text-xs";

  return (
    <span
      title={tooltip}
      className={`inline-flex items-center gap-1 rounded-full border font-bold ${px} ${text} ${COLORS[health]} cursor-default select-none`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${DOTS[health]}`} />
      {LABELS[health]}
    </span>
  );
}

import * as React from "react";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";

type StatusVariant = "live" | "connected" | "safe" | "buy" | "sell" | "long" | "short" | "running" | "offline" | "caution" | "warning" | "danger" | "halted" | "simulated" | "connecting" | "unknown";

interface StatusBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant: StatusVariant;
  label?: string;
  pulse?: boolean;
  glow?: boolean;
}

const variantStyles: Record<StatusVariant, { bg: string, text: string, dot: string, border: string }> = {
  live: { bg: "bg-emerald-500/10", text: "text-emerald-400", dot: "bg-emerald-400", border: "border-emerald-500/20" },
  connected: { bg: "bg-emerald-500/10", text: "text-emerald-400", dot: "bg-emerald-400", border: "border-emerald-500/20" },
  safe: { bg: "bg-emerald-500/10", text: "text-emerald-400", dot: "bg-emerald-400", border: "border-emerald-500/20" },
  buy: { bg: "bg-emerald-500/15", text: "text-emerald-400", dot: "bg-emerald-400", border: "border-emerald-500/30" },
  long: { bg: "bg-emerald-500/15", text: "text-emerald-400", dot: "bg-emerald-400", border: "border-emerald-500/30" },
  running: { bg: "bg-emerald-500/10", text: "text-emerald-400", dot: "bg-emerald-400", border: "border-emerald-500/20" },
  
  sell: { bg: "bg-rose-500/15", text: "text-rose-400", dot: "bg-rose-400", border: "border-rose-500/30" },
  short: { bg: "bg-rose-500/15", text: "text-rose-400", dot: "bg-rose-400", border: "border-rose-500/30" },
  danger: { bg: "bg-rose-500/15", text: "text-rose-400", dot: "bg-rose-400", border: "border-rose-500/30" },
  halted: { bg: "bg-rose-900/30", text: "text-rose-400", dot: "bg-rose-400", border: "border-rose-500/50" },
  offline: { bg: "bg-rose-500/10", text: "text-rose-400", dot: "bg-rose-400", border: "border-rose-500/20" },
  
  caution: { bg: "bg-amber-500/10", text: "text-amber-400", dot: "bg-amber-400", border: "border-amber-500/20" },
  warning: { bg: "bg-orange-500/10", text: "text-orange-400", dot: "bg-orange-400", border: "border-orange-500/20" },
  simulated: { bg: "bg-amber-500/10", text: "text-amber-400", dot: "bg-amber-400", border: "border-amber-500/20" },
  
  connecting: { bg: "bg-slate-500/10", text: "text-slate-400", dot: "bg-slate-400", border: "border-slate-500/20" },
  unknown: { bg: "bg-slate-500/10", text: "text-slate-400", dot: "bg-slate-400", border: "border-slate-500/20" },
};

export function StatusBadge({ variant, label, pulse = false, glow = false, className, ...props }: StatusBadgeProps) {
  const style = variantStyles[variant] || variantStyles.unknown;
  
  return (
    <div 
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border backdrop-blur-sm",
        style.bg, style.text, style.border,
        glow && "shadow-[0_0_10px_currentColor]",
        className
      )}
      {...props}
    >
      <span className={cn(
        "w-1.5 h-1.5 rounded-full shrink-0", 
        style.dot,
        pulse && "animate-pulse"
      )} />
      {label || variant.toUpperCase()}
    </div>
  );
}

import * as React from "react";
import { cn } from "../../lib/utils";
import { PremiumCard, PremiumCardContent } from "./PremiumCard";
import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface PremiumStatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  trend?: number; // percentage
  trendLabel?: string;
  valuePrefix?: string;
  valueSuffix?: string;
  valueColor?: string;
  loading?: boolean;
  className?: string;
  valueClassName?: string;
}

export function PremiumStatCard({
  title,
  value,
  subtitle,
  icon,
  trend,
  trendLabel,
  valuePrefix,
  valueSuffix,
  valueColor = "text-white",
  loading = false,
  className,
  valueClassName,
}: PremiumStatCardProps) {
  // Simple value change flash effect
  const [flash, setFlash] = React.useState(false);
  const prevValue = React.useRef(value);

  React.useEffect(() => {
    if (value !== prevValue.current) {
      setFlash(true);
      const timer = setTimeout(() => setFlash(false), 1000);
      prevValue.current = value;
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [value]);

  const isUp = trend !== undefined && trend > 0;
  const isDown = trend !== undefined && trend < 0;
  
  return (
    <PremiumCard className={cn("overflow-hidden group", className)} hoverGlow>
      <PremiumCardContent className="p-5 flex flex-col justify-between h-full relative">
        {/* Animated background flash for value updates */}
        {flash && (
          <motion.div 
            initial={{ opacity: 0.15 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 1 }}
            className="absolute inset-0 bg-cyan-500 pointer-events-none"
          />
        )}
        
        <div className="flex items-center justify-between mb-3 z-10">
          <p className="text-[13px] font-bold tracking-wider uppercase text-slate-400 uppercase">{title}</p>
          {icon && <div className="text-slate-500 opacity-70 group-hover:opacity-100 transition-opacity">{icon}</div>}
        </div>
        
        <div className="z-10">
          {loading ? (
            <div className="h-8 w-24 bg-slate-800 rounded animate-pulse mb-1" />
          ) : (
            <div className="flex items-baseline gap-1">
              {valuePrefix && <span className="text-lg text-slate-500 font-medium">{valuePrefix}</span>}
              <span className={cn("text-3xl font-extrabold font-sans tracking-tight", valueColor, valueClassName)}>
                {typeof value === 'number' ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : value}
              </span>
              {valueSuffix && <span className="text-lg text-slate-500 font-medium ml-1">{valueSuffix}</span>}
            </div>
          )}
          
          {(trend !== undefined || subtitle) && (
            <div className="flex items-center gap-2 mt-2">
              {trend !== undefined && (
                <div className={cn(
                  "flex items-center gap-0.5 text-xs font-bold",
                  isUp ? "text-emerald-400" : isDown ? "text-rose-400" : "text-slate-400"
                )}>
                  {isUp ? <TrendingUp size={12} /> : isDown ? <TrendingDown size={12} /> : <Minus size={12} />}
                  <span>{Math.abs(trend).toFixed(2)}%</span>
                </div>
              )}
              {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
            </div>
          )}
        </div>
      </PremiumCardContent>
    </PremiumCard>
  );
}

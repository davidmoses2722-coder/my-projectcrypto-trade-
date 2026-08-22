import * as React from "react";
import { cn } from "../../lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

interface PremiumCardProps extends React.ComponentProps<typeof Card> {
  hoverGlow?: boolean;
  animatedBorder?: boolean;
}

export function PremiumCard({ className, hoverGlow = false, animatedBorder = false, children, ...props }: PremiumCardProps) {
  return (
    <Card 
      className={cn(
        "premium-glass border-white/5 bg-slate-900/40 rounded-xl overflow-hidden text-slate-50",
        hoverGlow && "premium-glass-hover",
        animatedBorder && "relative before:absolute before:inset-0 before:-z-10 before:rounded-xl before:p-[1px] before:bg-gradient-to-r before:from-cyan-500/30 before:to-blue-600/30",
        className
      )}
      {...props}
    >
      {children}
    </Card>
  );
}

export function PremiumCardHeader({ className, ...props }: React.ComponentProps<typeof CardHeader>) {
  return <CardHeader className={cn("p-4 md:p-5 border-b border-white/5", className)} {...props} />;
}

export function PremiumCardTitle({ className, ...props }: React.ComponentProps<typeof CardTitle>) {
  return <CardTitle className={cn("text-sm font-semibold tracking-wide text-slate-300", className)} {...props} />;
}

export function PremiumCardContent({ className, ...props }: React.ComponentProps<typeof CardContent>) {
  return <CardContent className={cn("p-4 md:p-5", className)} {...props} />;
}

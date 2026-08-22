import { cn } from "../../lib/utils";
import { type ReactNode } from "react";

interface TypoProps { children: ReactNode; className?: string; }

// Page-level titles (36–42px, weight 800)
export const HeadingXL = ({ children, className }: TypoProps) => (
  <h1 className={cn("font-sans text-4xl font-extrabold tracking-tight text-white leading-tight", className)}>{children}</h1>
);

// Section headings (28–32px, weight 700)
export const HeadingLarge = ({ children, className }: TypoProps) => (
  <h2 className={cn("font-sans text-3xl font-bold tracking-tight text-white leading-tight", className)}>{children}</h2>
);

// Sub-section headings (22–26px, weight 700)
export const HeadingMedium = ({ children, className }: TypoProps) => (
  <h3 className={cn("font-sans text-2xl font-bold tracking-tight text-white", className)}>{children}</h3>
);

// Section titles in panels (18–20px, weight 600)
export const SectionTitle = ({ children, className }: TypoProps) => (
  <h4 className={cn("font-sans text-lg font-semibold tracking-tight text-white", className)}>{children}</h4>
);

// Card/panel titles (16–18px, weight 700)
export const CardTitle = ({ children, className }: TypoProps) => (
  <h5 className={cn("font-sans text-base font-bold tracking-tight text-white", className)}>{children}</h5>
);

// Metric label above a number (14–15px, weight 600, uppercase)
export const MetricLabel = ({ children, className }: TypoProps) => (
  <span className={cn("font-sans text-[13px] font-semibold uppercase tracking-widest text-slate-400", className)}>{children}</span>
);

// Large metric value (28–40px, weight 800)
export const MetricValue = ({ children, className }: TypoProps) => (
  <span className={cn("font-sans text-3xl font-extrabold tracking-tight text-white", className)}>{children}</span>
);

// Descriptive subtitle (14–15px, weight 500)
export const Subtitle = ({ children, className }: TypoProps) => (
  <p className={cn("font-sans text-sm font-medium text-slate-400 leading-relaxed", className)}>{children}</p>
);

// Body text (16px, weight 400)
export const Body = ({ children, className }: TypoProps) => (
  <p className={cn("font-sans text-base font-normal text-slate-300 leading-relaxed", className)}>{children}</p>
);

// Small text (13–14px, weight 500) — never below 13px
export const Small = ({ children, className }: TypoProps) => (
  <span className={cn("font-sans text-[13px] font-medium text-slate-400", className)}>{children}</span>
);

// Caption / helper text (12px minimum, weight 500)
export const Caption = ({ children, className }: TypoProps) => (
  <span className={cn("font-sans text-xs font-medium text-slate-500 tracking-wide", className)}>{children}</span>
);

// Badge / status label (11–12px, weight 700, uppercase)
export const BadgeText = ({ children, className }: TypoProps) => (
  <span className={cn("font-sans text-[11px] font-bold uppercase tracking-widest", className)}>{children}</span>
);

// Button text (15–16px, weight 600)
export const ButtonText = ({ children, className }: TypoProps) => (
  <span className={cn("font-sans text-sm font-semibold tracking-wide", className)}>{children}</span>
);

// Table header (13–14px, weight 700, uppercase)
export const TableHeader = ({ children, className }: TypoProps) => (
  <span className={cn("font-sans text-[13px] font-bold uppercase tracking-wider text-slate-400", className)}>{children}</span>
);

// Table cell (14–15px, weight 500)
export const TableCell = ({ children, className }: TypoProps) => (
  <span className={cn("font-sans text-sm font-medium text-slate-200", className)}>{children}</span>
);

// Navigation label (15–16px, weight 600)
export const NavLabel = ({ children, className }: TypoProps) => (
  <span className={cn("font-sans text-sm font-semibold tracking-wide", className)}>{children}</span>
);

// Form label (14–15px, weight 600)
export const FormLabel = ({ children, className }: TypoProps) => (
  <span className={cn("font-sans text-sm font-semibold text-slate-200 tracking-wide", className)}>{children}</span>
);

/**
 * terminal/ThemeProvider.tsx
 * Centralizes the exchange-grade dark palette already established in
 * index.css (#0B0E11 background, #0ECB81 success, #F6465D destructive) so
 * every terminal component pulls from one source instead of repeating hex
 * codes. Pure presentation — no data, no backend.
 */
import { createContext, useContext, type ReactNode } from "react";

export interface TerminalTheme {
  bg: string;
  bgPanel: string;
  bgElevated: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  success: string;
  successBg: string;
  destructive: string;
  destructiveBg: string;
  accentGold: string;
  accentBlue: string;
}

export const TERMINAL_THEME: TerminalTheme = {
  bg: "#0B0E11",
  bgPanel: "#0d1117",
  bgElevated: "#161b22",
  border: "rgba(255,255,255,0.06)",
  textPrimary: "#f8fafc",
  textSecondary: "#94a3b8",
  textMuted: "#475569",
  success: "#0ECB81",
  successBg: "rgba(14,203,129,0.12)",
  destructive: "#F6465D",
  destructiveBg: "rgba(246,70,93,0.12)",
  accentGold: "#F0B90B",
  accentBlue: "#0ea5e9",
};

const ThemeContext = createContext<TerminalTheme>(TERMINAL_THEME);

export function ThemeProvider({ children }: { children: ReactNode }) {
  return <ThemeContext.Provider value={TERMINAL_THEME}>{children}</ThemeContext.Provider>;
}

export function useTerminalTheme(): TerminalTheme {
  return useContext(ThemeContext);
}

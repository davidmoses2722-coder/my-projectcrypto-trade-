import { db } from "@workspace/db";
import { riskDailyPnlTable } from "@workspace/db/schema";
import { desc } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Fetch the last N days of P&L from risk_daily_pnl and build a
 * QuickChart.io image URL (bar chart, green = profit, red = loss).
 */
export async function getDailyPnlChartUrl(days = 14): Promise<string | null> {
  try {
    const rows = await db
      .select({
        bucketDate: riskDailyPnlTable.bucketDate,
        pnlUsd:     riskDailyPnlTable.pnlUsd,
        tradeCount: riskDailyPnlTable.tradeCount,
      })
      .from(riskDailyPnlTable)
      .orderBy(desc(riskDailyPnlTable.bucketDate))
      .limit(days);

    if (rows.length === 0) return null;

    // Oldest → newest for left-to-right chart ordering
    const sorted = [...rows].reverse();

    const labels = sorted.map(r => {
      const d = new Date(r.bucketDate + "T00:00:00Z");
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    });

    const values  = sorted.map(r => Number(r.pnlUsd));
    const colors  = values.map(v => v >= 0 ? "rgba(34,197,94,0.85)" : "rgba(239,68,68,0.85)");
    const borders = values.map(v => v >= 0 ? "rgb(22,163,74)"       : "rgb(220,38,38)");

    const totalPnl = values.reduce((a, b) => a + b, 0);
    const sign     = totalPnl >= 0 ? "+" : "";

    const chartConfig = {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Daily P&L (USD)",
            data: values,
            backgroundColor: colors,
            borderColor: borders,
            borderWidth: 1,
          },
        ],
      },
      options: {
        plugins: {
          title: {
            display: true,
            text: `${days}-Day P&L  |  Total: ${sign}$${totalPnl.toFixed(2)}`,
            font: { size: 14, weight: "bold" },
            color: "#1f2937",
          },
          legend: { display: false },
        },
        scales: {
          y: {
            grid:  { color: "rgba(0,0,0,0.08)" },
            ticks: {
              callback: (v: number) => `$${v.toFixed(0)}`,
              color: "#374151",
            },
          },
          x: {
            grid:  { display: false },
            ticks: { color: "#374151", maxRotation: 45 },
          },
        },
      },
    };

    const encoded = encodeURIComponent(JSON.stringify(chartConfig));
    return `https://quickchart.io/chart?c=${encoded}&w=640&h=320&bkg=white&f=png`;
  } catch (err) {
    logger.warn({ err }, "chartGenerator: failed to build P&L chart URL");
    return null;
  }
}

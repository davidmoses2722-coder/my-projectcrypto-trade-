/**
 * systemHealth.ts — Additive read-only route exposing real OS-level metrics.
 * Uses Node's built-in "os" module only. No external dependencies.
 */
import { Router, type Request, type Response } from "express";
import os from "os";
import fs from "fs";

const router = Router();

router.get("/system-health", async (_req: Request, res: Response) => {
  try {
    const loadAvg = os.loadavg(); // [1m, 5m, 15m]
    const totalMem = os.totalmem();
    const freeMem  = os.freemem();
    const usedMem  = totalMem - freeMem;
    const memUsedPct = (usedMem / totalMem) * 100;
    const serverUptime = os.uptime(); // seconds

    // CPU usage approximation: 1-min load avg / cpu-count * 100
    const cpuCount = os.cpus().length;
    const cpuUsedPct = Math.min(100, (loadAvg[0]! / cpuCount) * 100);

    // Disk usage via fs.statfs (Node ≥ 18.15; gracefully omitted if unavailable)
    let disk: { totalBytes: number; freeBytes: number; usedPct: number } | null = null;
    try {
      if (typeof (fs as Record<string, unknown>)["statfs"] === "function") {
        const stat = await new Promise<{ bavail: number; blocks: number; bsize: number; bfree: number }>(
          (resolve, reject) =>
            (fs as unknown as { statfs(path: string, cb: (err: Error | null, stats: { bavail: number; blocks: number; bsize: number; bfree: number }) => void): void })
              .statfs("/", (err, stats) => err ? reject(err) : resolve(stats))
        );
        const total = stat.blocks * stat.bsize;
        const free  = stat.bavail * stat.bsize;
        disk = {
          totalBytes: total,
          freeBytes:  free,
          usedPct:    total > 0 ? ((total - free) / total) * 100 : 0,
        };
      }
    } catch {
      // disk info unavailable — omit gracefully
    }

    res.json({
      ok: true,
      data: {
        cpu: {
          usedPct:   Math.round(cpuUsedPct * 10) / 10,
          loadAvg1m: Math.round(loadAvg[0]! * 100) / 100,
          loadAvg5m: Math.round(loadAvg[1]! * 100) / 100,
          loadAvg15m:Math.round(loadAvg[2]! * 100) / 100,
          cores:     cpuCount,
        },
        memory: {
          totalBytes:  totalMem,
          freeBytes:   freeMem,
          usedBytes:   usedMem,
          usedPct:     Math.round(memUsedPct * 10) / 10,
        },
        disk,
        serverUptime,            // seconds since OS boot
        checkedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Failed to read system health" });
  }
});

export default router;

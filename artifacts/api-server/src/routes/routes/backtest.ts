import { Router } from "express";
import { runBacktestHandler, getBacktestResult, getBacktestHistory } from "../../controllers/backtestController";

const router = Router();
router.post("/backtest/run",        (req, res) => { void runBacktestHandler(req, res); });
router.get("/backtest/results/:id", (req, res) => { void getBacktestResult(req, res); });
router.get("/backtest/history",     (req, res) => { void getBacktestHistory(req, res); });
export default router;

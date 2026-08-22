import { Router, type IRouter } from "express";
import allRoutes from "./routes/index";

const router: IRouter = Router();

router.use(allRoutes);

export default router;

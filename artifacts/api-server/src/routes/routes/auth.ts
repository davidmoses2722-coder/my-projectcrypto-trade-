import { Router, type IRouter } from "express";
import { register, login, me } from "../../controllers/authController";
import { requireAuth } from "../../middleware/authMiddleware";

const router: IRouter = Router();

// Public auth endpoints
router.post("/auth/register", register);
router.post("/auth/login", login);

// Protected: who am I?
router.get("/auth/me", requireAuth, me);

// Stateless logout — the client just discards the token. Provided for symmetry.
router.post("/auth/logout", (_req, res) => {
  res.json({ ok: true, data: { message: "Logged out (discard token client-side)" } });
});

export default router;

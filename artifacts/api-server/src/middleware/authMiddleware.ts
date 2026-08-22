import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const SECRET = process.env["SESSION_SECRET"] ?? "";
if (!SECRET) {
  throw new Error("SESSION_SECRET is required for JWT auth");
}

export interface AuthPayload {
  uid: number;
  username: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export function signToken(payload: AuthPayload, expiresIn: string = "7d"): string {
  return jwt.sign(payload, SECRET, { expiresIn } as jwt.SignOptions);
}

export function verifyToken(token: string): AuthPayload | null {
  try {
    const decoded = jwt.verify(token, SECRET) as AuthPayload;
    if (typeof decoded?.uid === "number" && typeof decoded?.username === "string") {
      return { uid: decoded.uid, username: decoded.username };
    }
    return null;
  } catch {
    return null;
  }
}

function extractToken(req: Request): string | null {
  const header = req.headers["authorization"];
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim();
  }
  const cookieToken = (req as Request & { cookies?: Record<string, string> }).cookies?.["auth_token"];
  if (typeof cookieToken === "string" && cookieToken.length > 0) {
    return cookieToken;
  }
  return null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ ok: false, error: "Missing auth token", code: "AUTH_REQUIRED" });
    return;
  }
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ ok: false, error: "Invalid or expired token", code: "AUTH_INVALID" });
    return;
  }
  req.user = payload;
  next();
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (token) {
    const payload = verifyToken(token);
    if (payload) req.user = payload;
  }
  next();
}

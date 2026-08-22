import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { eq, or } from "drizzle-orm";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { signToken } from "../middleware/authMiddleware";
import { logger } from "../lib/logger";

const BCRYPT_ROUNDS = 10;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface PublicUser {
  id: number;
  username: string;
  email: string | null;
  isActive: boolean;
  createdAt: string;
}

function toPublicUser(row: typeof usersTable.$inferSelect): PublicUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email ?? null,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}

/** True if the error is a Postgres unique-constraint violation (code 23505). */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "23505"
  );
}

export async function register(req: Request, res: Response): Promise<void> {
  try {
    const { username, email, password } = (req.body ?? {}) as {
      username?: unknown;
      email?: unknown;
      password?: unknown;
    };

    if (typeof username !== "string" || !USERNAME_RE.test(username)) {
      res.status(400).json({
        ok: false,
        error: "Username must be 3–32 chars (letters, numbers, underscore)",
        code: "BAD_USERNAME",
      });
      return;
    }
    if (typeof password !== "string" || password.length < 8) {
      res.status(400).json({
        ok: false,
        error: "Password must be at least 8 characters",
        code: "BAD_PASSWORD",
      });
      return;
    }
    if (email !== undefined && email !== null && email !== "") {
      if (typeof email !== "string" || !EMAIL_RE.test(email)) {
        res.status(400).json({ ok: false, error: "Invalid email", code: "BAD_EMAIL" });
        return;
      }
    }

    const normalizedEmail =
      typeof email === "string" && email.length > 0 ? email.toLowerCase() : null;

    const existing = await db
      .select({ id: usersTable.id, username: usersTable.username, email: usersTable.email })
      .from(usersTable)
      .where(
        normalizedEmail
          ? or(eq(usersTable.username, username), eq(usersTable.email, normalizedEmail))
          : eq(usersTable.username, username),
      )
      .limit(1);

    if (existing.length > 0) {
      res
        .status(409)
        .json({ ok: false, error: "Username already exists", code: "USER_EXISTS" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    let inserted: (typeof usersTable.$inferSelect)[];
    try {
      inserted = await db
        .insert(usersTable)
        .values({ username, email: normalizedEmail, passwordHash })
        .returning();
    } catch (insertErr) {
      // Catch a race-condition duplicate that slipped past the pre-check
      if (isUniqueViolation(insertErr)) {
        res.status(409).json({ ok: false, error: "Username already exists", code: "USER_EXISTS" });
        return;
      }
      logger.error({ err: insertErr }, "auth.register: insert failed");
      res.status(500).json({ ok: false, error: "Unable to create account", code: "INSERT_FAILED" });
      return;
    }

    const row = inserted[0];
    if (!row) {
      logger.error("auth.register: insert returned no rows");
      res.status(500).json({ ok: false, error: "Unable to create account", code: "INSERT_FAILED" });
      return;
    }

    const token = signToken({ uid: row.id, username: row.username });

    res.status(201).json({
      ok: true,
      data: { user: toPublicUser(row), token, tokenType: "Bearer", expiresIn: "7d" },
    });
  } catch (err) {
    logger.error({ err }, "auth.register: unexpected error");
    res.status(500).json({
      ok: false,
      error: "Unable to create account",
      code: "INTERNAL",
    });
  }
}

export async function login(req: Request, res: Response): Promise<void> {
  try {
    const { usernameOrEmail, username, email, password } = (req.body ?? {}) as {
      usernameOrEmail?: unknown;
      username?: unknown;
      email?: unknown;
      password?: unknown;
    };

    const identifierRaw =
      (typeof usernameOrEmail === "string" && usernameOrEmail) ||
      (typeof username === "string" && username) ||
      (typeof email === "string" && email) ||
      "";

    if (!identifierRaw || typeof password !== "string" || password.length === 0) {
      res.status(400).json({
        ok: false,
        error: "Username and password are required",
        code: "BAD_CREDENTIALS",
      });
      return;
    }

    const identifier = identifierRaw.trim();
    const isEmail = identifier.includes("@");
    const lookupValue = isEmail ? identifier.toLowerCase() : identifier;

    let rows: (typeof usersTable.$inferSelect)[];
    try {
      rows = await db
        .select()
        .from(usersTable)
        .where(isEmail ? eq(usersTable.email, lookupValue) : eq(usersTable.username, lookupValue))
        .limit(1);
    } catch (dbErr) {
      logger.error({ err: dbErr }, "auth.login: db lookup failed");
      res.status(500).json({ ok: false, error: "Login failed", code: "INTERNAL" });
      return;
    }

    const row = rows[0];
    // Always run bcrypt to prevent timing-based username enumeration.
    const dummyHash = "$2a$10$CwTycUXWue0Thq9StjUM0uJ8pJvrcFFC6X0uFXl2L1xZTbMYOGYS6";
    const hash = row?.passwordHash ?? dummyHash;
    const passwordOk = await bcrypt.compare(password, hash);

    if (!row || !row.passwordHash || !passwordOk || !row.isActive) {
      res
        .status(401)
        .json({ ok: false, error: "Invalid username or password", code: "INVALID_CREDENTIALS" });
      return;
    }

    const token = signToken({ uid: row.id, username: row.username });

    res.json({
      ok: true,
      data: { user: toPublicUser(row), token, tokenType: "Bearer", expiresIn: "7d" },
    });
  } catch (err) {
    logger.error({ err }, "auth.login: unexpected error");
    res.status(500).json({
      ok: false,
      error: "Login failed",
      code: "INTERNAL",
    });
  }
}

export async function me(req: Request, res: Response): Promise<void> {
  try {
    const uid = req.user?.uid;
    if (!uid) {
      res.status(401).json({ ok: false, error: "Not authenticated", code: "AUTH_REQUIRED" });
      return;
    }

    let rows: (typeof usersTable.$inferSelect)[];
    try {
      rows = await db.select().from(usersTable).where(eq(usersTable.id, uid)).limit(1);
    } catch (dbErr) {
      logger.error({ err: dbErr, uid }, "auth.me: db lookup failed");
      res.status(500).json({ ok: false, error: "Unable to retrieve account", code: "INTERNAL" });
      return;
    }

    const row = rows[0];
    if (!row || !row.isActive) {
      res.status(401).json({ ok: false, error: "User not found or disabled", code: "USER_GONE" });
      return;
    }

    res.json({ ok: true, data: { user: toPublicUser(row) } });
  } catch (err) {
    logger.error({ err }, "auth.me: unexpected error");
    res.status(500).json({
      ok: false,
      error: "Unable to retrieve account",
      code: "INTERNAL",
    });
  }
}

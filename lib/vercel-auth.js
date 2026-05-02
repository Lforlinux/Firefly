// lib/vercel-auth.ts
import * as crypto from "crypto";
import * as jwt from "jsonwebtoken";
var JWT_SECRET = process.env.JWT_SECRET || "dev-only-secret-change-in-production";
var JWT_EXPIRY = "7d";
var COOKIE_NAME = "firefly_token";
var COOKIE_MAX_AGE = 7 * 24 * 60 * 60;
var IS_PROD = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
async function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(salt.toString("hex") + ":" + derivedKey.toString("hex"));
    });
  });
}
async function verifyPassword(password, storedHash) {
  return new Promise((resolve, reject) => {
    const [saltHex, hashHex] = storedHash.split(":");
    if (!saltHex || !hashHex) {
      resolve(false);
      return;
    }
    const salt = Buffer.from(saltHex, "hex");
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(derivedKey.toString("hex") === hashHex);
    });
  });
}
function createToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}
function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}
function setCookieHeader(token) {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${COOKIE_MAX_AGE}`
  ];
  if (IS_PROD) parts.push("Secure");
  return parts.join("; ");
}
function clearCookieHeader() {
  const parts = [
    `${COOKIE_NAME}=`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    "Max-Age=0"
  ];
  if (IS_PROD) parts.push("Secure");
  return parts.join("; ");
}
function extractCookieToken(cookieHeader) {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(";").map((c) => c.trim());
  for (const cookie of cookies) {
    if (cookie.startsWith(`${COOKIE_NAME}=`)) {
      return cookie.slice(`${COOKIE_NAME}=`.length);
    }
  }
  return null;
}
function requireAuth(req) {
  const cookieToken = extractCookieToken(req.headers.cookie);
  const authHeader = req.headers.authorization;
  const headerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const token = cookieToken || headerToken;
  if (!token) return null;
  try {
    return verifyToken(token);
  } catch {
    return null;
  }
}
async function getDbClient() {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
    const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    if (!url) {
      throw new Error("Database not configured: set POSTGRES_URL (Vercel Postgres) on the project.");
    }
    const pg = await import("pg");
    const client = new pg.Client({
      connectionString: url,
      ssl: { rejectUnauthorized: false }
    });
    await client.connect();
    return {
      query: async (sqlText, values) => {
        return client.query(sqlText, values);
      }
    };
  } else {
    const pg = await import("pg");
    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL || "postgresql://localhost:5432/firefly"
    });
    await client.connect();
    return {
      query: async (sqlText, values) => {
        return client.query(sqlText, values);
      }
    };
  }
}
export {
  clearCookieHeader,
  createToken,
  extractCookieToken,
  getDbClient,
  hashPassword,
  requireAuth,
  setCookieHeader,
  verifyPassword,
  verifyToken
};

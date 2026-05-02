/**
 * Authentication utilities for HTTP-only cookie-based JWT flow
 * Used by auth endpoints (signup, login, logout) and middleware (requireAuth)
 *
 * Lives outside `api/` so Vercel does not count this file as a Serverless Function.
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-in-production';
const JWT_EXPIRY = '7d'; // 7 days
const COOKIE_NAME = 'firefly_token';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds
const IS_PROD = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';

// ============ Password Hashing (Bcrypt-compatible via crypto.scrypt) ============

/**
 * Hash a password using Node.js native crypto.scrypt
 * Returns "salt:hash" format for storage in database
 */
export async function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(salt.toString('hex') + ':' + (derivedKey as Buffer).toString('hex'));
    });
  });
}

/**
 * Verify a password against a stored hash
 * Stored hash format: "salt:hash"
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [saltHex, hashHex] = storedHash.split(':');
    if (!saltHex || !hashHex) {
      resolve(false);
      return;
    }
    const salt = Buffer.from(saltHex, 'hex');
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve((derivedKey as Buffer).toString('hex') === hashHex);
    });
  });
}

// ============ JWT Token Generation ============

export interface JwtPayload {
  userId: string;
  email: string;
}

/**
 * Create a signed JWT token
 */
export function createToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

/**
 * Verify and decode a JWT token
 * Throws if invalid or expired
 */
export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

// ============ HTTP-only Cookie Headers ============

/**
 * Generate a Set-Cookie header value for storing JWT in HTTP-only cookie
 * Browser automatically includes this cookie in all requests (with credentials: 'include')
 * JavaScript cannot access this cookie (HttpOnly flag)
 */
export function setCookieHeader(token: string): string {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${COOKIE_MAX_AGE}`,
  ];
  // Local dev runs over http://localhost. Secure cookies are ignored there.
  if (IS_PROD) parts.push('Secure');
  return parts.join('; ');
}

/**
 * Generate a Set-Cookie header to delete the cookie (Max-Age=0)
 */
export function clearCookieHeader(): string {
  const parts = [
    `${COOKIE_NAME}=`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    'Max-Age=0',
  ];
  if (IS_PROD) parts.push('Secure');
  return parts.join('; ');
}

// ============ Cookie Extraction ============

/**
 * Extract JWT token from request cookies
 * Parses Cookie header: "firefly_token=<jwt>; other=value"
 */
export function extractCookieToken(cookieHeader?: string): string | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map(c => c.trim());
  for (const cookie of cookies) {
    if (cookie.startsWith(`${COOKIE_NAME}=`)) {
      return cookie.slice(`${COOKIE_NAME}=`.length);
    }
  }
  return null;
}

// ============ Middleware: requireAuth ============

export interface AuthRequest {
  userId: string;
  email: string;
}

/**
 * Middleware to extract and verify auth token from cookie or Authorization header
 * Sets req.auth if valid; returns 401 if missing or invalid
 *
 * Usage:
 *   const auth = requireAuth(req);
 *   if (!auth) return res.status(401).json({ error: 'Unauthorized' });
 *   const userId = auth.userId;
 */
export function requireAuth(req: any): AuthRequest | null {
  // Try cookie first
  const cookieToken = extractCookieToken(req.headers.cookie);
  // Fall back to Authorization header (Bearer <token>)
  const authHeader = req.headers.authorization;
  const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = cookieToken || headerToken;

  if (!token) return null;

  try {
    return verifyToken(token);
  } catch (err) {
    return null;
  }
}

// ============ Vercel Postgres Client Helpers ============

/**
 * Simple wrapper for executing Vercel Postgres queries
 * In development, use local postgres; in production, use Vercel Postgres
 */
export interface DbClient {
  query(sql: string, values?: any[]): Promise<{ rows: any[] }>;
}

/**
 * Get a database client based on environment
 * Development: native pg.Client to localhost:5432
 * Production: Vercel Postgres via @vercel/postgres
 */
export async function getDbClient(): Promise<DbClient> {
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
    // Production: use Vercel Postgres
    const pg = await import('pg');
    const client = new pg.Client({
      connectionString: process.env.POSTGRES_URL,
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();
    return {
      query: async (sqlText: string, values?: any[]) => {
        return client.query(sqlText, values);
      },
    };
  } else {
    // Development: use local postgres
    const pg = await import('pg');
    const client = new pg.Client({
      connectionString:
        process.env.DATABASE_URL ||
        process.env.POSTGRES_URL ||
        'postgresql://localhost:5432/firefly',
    });
    await client.connect();
    return {
      query: async (sqlText: string, values?: any[]) => {
        return client.query(sqlText, values);
      },
    };
  }
}

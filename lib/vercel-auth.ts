/**
 * Authentication + DB helpers shared by Vercel serverless routes.
 * Runtime loads `lib/vercel-auth.js` (ESM). Regenerate: `npm run build:lib`.
 * `vercel.json` includes `lib/vercel-auth.js` in each API function bundle.
 */

import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-in-production';
const JWT_EXPIRY = '7d'; // 7 days
const COOKIE_NAME = 'firefly_token';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds
const IS_PROD = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';

export async function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(salt.toString('hex') + ':' + (derivedKey as Buffer).toString('hex'));
    });
  });
}

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

export interface JwtPayload {
  userId: string;
  email: string;
}

export function createToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

export function setCookieHeader(token: string): string {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${COOKIE_MAX_AGE}`,
  ];
  if (IS_PROD) parts.push('Secure');
  return parts.join('; ');
}

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

export interface AuthRequest {
  userId: string;
  email: string;
}

export function requireAuth(req: any): AuthRequest | null {
  const cookieToken = extractCookieToken(req.headers.cookie);
  const authHeader = req.headers.authorization;
  const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = cookieToken || headerToken;

  if (!token) return null;

  try {
    return verifyToken(token);
  } catch {
    return null;
  }
}

export interface DbClient {
  query(sql: string, values?: any[]): Promise<{ rows: any[] }>;
}

export async function getDbClient(): Promise<DbClient> {
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
    const url = process.env.POSTGRES_URL || process.env.DATABASE_URL
    if (!url) {
      throw new Error('Database not configured: set POSTGRES_URL (Vercel Postgres) on the project.')
    }
    const pg = await import('pg');
    const client = new pg.Client({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();
    return {
      query: async (sqlText: string, values?: any[]) => {
        return client.query(sqlText, values);
      },
    };
  } else {
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

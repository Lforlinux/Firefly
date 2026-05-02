/**
 * POST /api/auth/login
 *
 * Authenticate user with email + password.
 * Returns Set-Cookie header (HTTP-only JWT) + response body { ok, userId, email }.
 *
 * Request body:
 *   { email: string, password: string }
 *
 * Response:
 *   200 { ok: true, userId: string, email: string }
 *   (with Set-Cookie: firefly_token=<jwt>; HttpOnly; Secure; SameSite=Strict; ...)
 *
 * Errors:
 *   400 - missing email or password
 *   401 - email not found or password incorrect
 *   500 - database error
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyPassword, createToken, setCookieHeader, getDbClient } from '../_lib/vercel-auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, password } = req.body || {};

  // Validate input
  if (!email || typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ error: 'Email is required' });
  }
  if (!password || typeof password !== 'string' || !password.length) {
    return res.status(400).json({ error: 'Password is required' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const db = await getDbClient();

    // Look up user
    const userRes = await db.query(
      'SELECT id, email, password_hash FROM users WHERE email = $1',
      [normalizedEmail]
    );
    
    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = userRes.rows[0];
    const userId = user.id;

    // Verify password
    const passwordValid = await verifyPassword(password, user.password_hash);
    if (!passwordValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate JWT token
    const token = createToken({ userId, email: normalizedEmail });

    // Set response headers and body
    res.setHeader('Set-Cookie', setCookieHeader(token));
    return res.status(200).json({
      ok: true,
      userId,
      email: normalizedEmail,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[login]', message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

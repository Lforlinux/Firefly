/**
 * POST /api/auth/signup
 *
 * Create a new user account with email + password.
 * Returns Set-Cookie header (HTTP-only JWT) + response body { ok, userId, email }.
 *
 * Request body:
 *   { email: string, password: string }
 *
 * Response:
 *   201 { ok: true, userId: string, email: string }
 *   (with Set-Cookie: firefly_token=<jwt>; HttpOnly; Secure; SameSite=Strict; ...)
 *
 * Errors:
 *   400 - missing email or password
 *   409 - email already exists
 *   500 - database error
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import { hashPassword, createToken, setCookieHeader, getDbClient } from '../_lib/vercel-auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, password } = req.body || {};

  // Validate input
  if (!email || typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ error: 'Email is required' });
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const db = await getDbClient();

    // Check if email already exists
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already exists' });
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Insert user
    const userRes = await db.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
      [normalizedEmail, hashedPassword]
    );
    const user = userRes.rows[0];
    const userId = user.id;

    // Create settings row for user
    await db.query(
      'INSERT INTO settings (user_id, base_currency) VALUES ($1, $2)',
      [userId, 'GBP']
    );

    // Generate JWT token
    const token = createToken({ userId, email: normalizedEmail });

    // Set response headers and body
    res.setHeader('Set-Cookie', setCookieHeader(token));
    return res.status(201).json({
      ok: true,
      userId,
      email: normalizedEmail,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[signup]', message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

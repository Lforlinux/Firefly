/**
 * POST /api/auth/logout
 *
 * Protected endpoint: clears JWT cookie by setting Max-Age=0.
 * Requires valid JWT in Cookie header or Authorization header.
 *
 * Request body: none (empty or omitted)
 *
 * Response:
 *   200 { ok: true }
 *   (with Set-Cookie: firefly_token=; Max-Age=0; ...)
 *
 * Errors:
 *   401 - missing or invalid token
 *   500 - database error
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth, clearCookieHeader } from '../../lib/vercel-auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check authentication (requireAuth returns null if invalid/missing)
  const auth = requireAuth(req);
  if (!auth) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Clear cookie by setting Max-Age=0
  res.setHeader('Set-Cookie', clearCookieHeader());
  return res.status(200).json({ ok: true });
}
